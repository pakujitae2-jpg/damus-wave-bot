"""실시간 러너: 히스토리로 상태 워밍업 → WS 로 봉 마감마다 Strategy.on_bar → 주문 동기화.

전략 로직(Strategy)은 백테스트와 동일. 이 모듈은 전략이 낸 결과를 거래소 주문으로 옮기는 역할만 한다.
  - 진입: 시장가 + STOP_MARKET(closePosition) + TP LIMIT 사다리 (reduceOnly)
  - 본절 이동: 기존 스탑 취소 후 재발주
  - T 반대 전환 청산: 전량 시장가 + 잔여 주문 취소
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

import pandas as pd

from damus.config import KST, ExecParams, StrategyParams
from damus.data.binance import add_session, fetch_klines, poll_klines, session_date, stream_klines
from damus.engine.cross import CrossStrategy
from damus.engine.strategy import Strategy
from damus.exec.binance_exec import BinanceFutures

log = logging.getLogger("live")


class LiveRunner:
    def __init__(self, sp: StrategyParams, ep: ExecParams, warmup_days: int = 5):
        self.sp, self.ep = sp, ep
        self.ex = BinanceFutures(ep)
        self.ex.set_leverage(sp.symbol, sp.leverage)
        bal = self.ex.balance_usdt()
        self.cross = bool(sp.signal_symbol) and sp.signal_symbol != sp.symbol
        self.st = CrossStrategy(sp, bal, sp.cross_beta) if self.cross else Strategy(sp, bal)
        self._pending: dict[pd.Timestamp, dict] = {}   # 교차 모드: 두 심볼 봉 동기화 버퍼
        self._last_ts: pd.Timestamp | None = None
        self._stop_placed: float | None = None
        log.info(f"balance={bal:.2f} paper={ep.paper} testnet={ep.testnet}")
        self._warmup(warmup_days)

    def _warmup(self, days: int) -> None:
        start = datetime.now(KST) - timedelta(days=days)
        df = add_session(fetch_klines(self.sp.symbol, self.sp.timeframe, start)).iloc[:-1]
        if self.cross:
            sig = add_session(fetch_klines(self.sp.signal_symbol, self.sp.timeframe, start)).iloc[:-1]
            j = sig[["open", "high", "low", "close", "session"]].join(df[["open", "high", "low", "close"]], how="inner", rsuffix="_x")
            for ts, r in j.iterrows():
                self.st.on_bar(ts, (r.open, r.high, r.low, r.close), (r.open_x, r.high_x, r.low_x, r.close_x), r.session)
            df = j
        else:
            for ts, r in df.iterrows():
                self.st.on_bar(ts, r.open, r.high, r.low, r.close, r.session)
        self._last_ts = df.index[-1]
        # 워밍업 중 생긴 가상 포지션은 버림 (실계좌와 불일치)
        self.st.pos = None
        log.info(f"warmup done: {len(df)} bars, last={self._last_ts}, pattern={self.st.pattern.s.label()}")

    # ------------------------------------------------------------------
    def run(self, feed: str = "rest") -> None:
        if self.cross:
            import threading
            t = threading.Thread(target=poll_klines, args=(self.sp.signal_symbol, self.sp.timeframe, self._on_sig_bar), daemon=True)
            t.start()
            poll_klines(self.sp.symbol, self.sp.timeframe, self._on_exe_bar)
            return
        if feed == "ws":
            stream_klines(self.sp.symbol, self.sp.timeframe, self._on_bar)
        else:
            poll_klines(self.sp.symbol, self.sp.timeframe, self._on_bar)

    # ---- 교차 모드: 같은 시각의 시그널/체결 봉이 모두 도착하면 처리 ----
    def _on_sig_bar(self, k: dict) -> None:
        self._pair(k, "sig")

    def _on_exe_bar(self, k: dict) -> None:
        self._pair(k, "exe")

    def _pair(self, k: dict, which: str) -> None:
        if not k["closed"]:
            return
        ts = k["ts"]
        if self._last_ts is not None and ts <= self._last_ts:
            return
        slot = self._pending.setdefault(ts, {})
        slot[which] = k
        if "sig" in slot and "exe" in slot:
            self._pending.pop(ts)
            s, e = slot["sig"], slot["exe"]
            self._last_ts = ts
            res = self.st.on_bar(ts, (s["open"], s["high"], s["low"], s["close"]),
                                 (e["open"], e["high"], e["low"], e["close"]), session_date(ts))
            ws, ps = self.st.waves.s, self.st.pattern.s
            log.info(f"{ts:%m-%d %H:%M} {self.sp.signal_symbol}={s['close']:.1f} {self.sp.symbol}={e['close']:.4f} "
                     f"T[{ws.t.low:.1f}~{ws.t.high:.1f}] {ps.label()}")
            self._sync(res)
            for old in [t for t in self._pending if t < ts]:
                self._pending.pop(old)

    def _on_bar(self, k: dict) -> None:
        if not k["closed"]:
            return
        ts = k["ts"]
        if self._last_ts is not None and ts <= self._last_ts:
            return
        self._last_ts = ts
        res = self.st.on_bar(ts, k["open"], k["high"], k["low"], k["close"], session_date(ts))
        ws, ps = self.st.waves.s, self.st.pattern.s
        r_txt = f"R{ws.r.id} {ws.r.direction} red={ws.r.red_line:.1f} blue={ws.r.blue_line:.1f}" if ws.r else "R none"
        log.info(f"{ts:%m-%d %H:%M} c={k['close']:.1f} T[{ws.t.low:.1f}~{ws.t.high:.1f}] {ps.label()} | {r_txt}")
        self._sync(res)

    # ------------------------------------------------------------------
    def _sync(self, res) -> None:
        sym = self.sp.symbol
        if res.opened is not None:
            pos = res.opened
            side = "BUY" if pos.side == "LONG" else "SELL"
            close_side = "SELL" if pos.side == "LONG" else "BUY"
            log.info(f"ENTRY {pos.side} {pos.kind} qty={pos.qty:.4f} @ {pos.entry_price:.1f} "
                     f"stop={pos.stop:.1f} | {pos.reason_in}")
            self.ex.market(sym, side, pos.qty)
            self.ex.stop_market(sym, close_side, pos.stop)
            self._stop_placed = pos.stop
            for label, price, q in pos.tps:
                self.ex.take_profit_limit(sym, close_side, q, price)
            return

        pos = self.st.pos
        if res.closed is not None:
            tr = res.closed
            log.info(f"EXIT {tr.side} {tr.reason_out} pnl={tr.pnl:+.2f} balance={self.st.balance:.2f}")
            # SL/TP_ALL 은 거래소 주문이 이미 체결됨. REV_EXIT 만 시장가 청산 필요.
            if tr.reason_out in ("REV_EXIT", "TIME", "EOD"):
                side = "SELL" if tr.side == "LONG" else "BUY"
                qty = abs(self.ex.position_qty(sym)) if not self.ep.paper else tr.qty
                self.ex.market(sym, side, qty, reduce_only=True)
            self.ex.cancel_all(sym)
            self._stop_placed = None
            return

        if pos is not None and res.fills:
            added = False
            for f in res.fills:
                log.info(f"  fill {f.reason} qty={f.qty:.4f} @ {f.price:.1f}")
                if f.reason == "ADD":
                    self.ex.market(sym, "BUY" if pos.side == "LONG" else "SELL", -f.qty)
                    added = True
            # 분할 추가 or 본절 이동 → 스탑/TP 재발주
            if added or (pos.be_moved and self._stop_placed != pos.stop):
                close_side = "SELL" if pos.side == "LONG" else "BUY"
                # 기존 스탑만 취소하려면 orderId 관리 필요; 단순화를 위해 전체 취소 후 스탑+남은 TP 재발주
                self.ex.cancel_all(sym)
                self.ex.stop_market(sym, close_side, pos.stop)
                for label, price, q in pos.tps:
                    self.ex.take_profit_limit(sym, close_side, q, price)
                self._stop_placed = pos.stop
