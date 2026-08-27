"""반자동 라이브 러너 — BTC 시그널 → SOL·ETH 체결 (paper / testnet / LIVE 공통).

규칙
  진입  : 자동 (겹침 로직, 지갑잔고×20% 증거금, 1% 불리 시 분할 1회) + STOP_MARKET 손절 + TP 지정가 사다리
  익절  : 사용자가 판단 — 거래소 앱에서 직접 청산/부분청산 OK. 봇은 봉마다 거래소 포지션과 대조해 따라간다.
  48h   : 진입 후 48시간 내 포지션이 남아 있으면 시장가 청산 (기존 설계)
  반대전환 자동청산 : AUTO_REV_EXIT=true 일 때만
  외부 포지션 : 봇이 모르는 포지션이 있으면 건드리지 않고 그 종목 진입만 보류
  명령  : output/live/commands.json  {"close": ["SOLUSDT"], "pause": true}  (대시보드 버튼)
상태  : output/live/state.json (대시보드), trades.csv, live.log
.env  : PAPER / BINANCE_TESTNET / BINANCE_API_KEY / SECRET / INITIAL_BALANCE / LIVE_CONFIRM=YES
"""
from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from dataclasses import asdict, replace
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

from damus.config import KST, StrategyParams, load_exec_params
from damus.data.binance import FAPI, add_session, fetch_klines, session_date
from damus.engine.cross import CrossStrategy
from damus.engine.risk import Fill, Trade
from damus.exec.binance_exec import BinanceFutures

load_dotenv()
SIGNAL = "BTCUSDT"
EXEC_SYMS = os.getenv("LIVE_SYMBOLS", "SOLUSDT,ETHUSDT").split(",")
MARGIN_FRACTION = float(os.getenv("LIVE_MARGIN", "0.2"))
LEVERAGE = int(os.getenv("LIVE_LEVERAGE", "10"))
AUTO_REV_EXIT = os.getenv("AUTO_REV_EXIT", "false").lower() == "true"
MAX_TOTAL_MARGIN = float(os.getenv("LIVE_MAX_TOTAL_MARGIN", "0.6"))   # 지갑 대비 전체 증거금 상한
RESERVE = float(os.getenv("LIVE_RESERVE", "0.1"))                     # 가용잔고에서 남겨둘 여유
POLL_SEC = 5.0
DIR = Path("output/live"); DIR.mkdir(parents=True, exist_ok=True)
STATE, CMD, TRADES_CSV, LOG = DIR / "state.json", DIR / "commands.json", DIR / "trades.csv", DIR / "live.log"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(LOG, encoding="utf-8")])
log = logging.getLogger("live")


def make_params(sym: str) -> StrategyParams:
    return replace(StrategyParams(symbol=sym, signal_symbol=SIGNAL, cross_beta=1.75), hold_mode="swing",
                   max_hold_hours=48, max_sl_pct=0.07, sizing_mode="margin", leverage=LEVERAGE,
                   margin_fraction=MARGIN_FRACTION, rev_exit=AUTO_REV_EXIT)


class Runner:
    def __init__(self):
        self.ep = load_exec_params()
        self.ex = BinanceFutures(self.ep)
        if not self.ex.ping():
            raise SystemExit("거래소 연결/인증 실패 — .env 확인")
        if self.ex.mode == "LIVE" and os.getenv("LIVE_CONFIRM") != "YES":
            raise SystemExit("실계좌 모드입니다. .env 에 LIVE_CONFIRM=YES 를 넣어야 시작합니다.")
        for s in EXEC_SYMS:
            self.ex.setup_symbol(s, LEVERAGE)
        self.ex.leverage = LEVERAGE
        wallet, _ = self.ex.wallet_usdt()
        self.strats: dict[str, CrossStrategy] = {s: CrossStrategy(make_params(s), wallet, 1.75) for s in EXEC_SYMS}
        self.state = {"mode": self.ex.mode, "seed": wallet, "started": None, "wallet": wallet, "equity": wallet,
                      "trades": [], "signals": [], "bars": [], "positions": {}, "external": [], "paused": False,
                      "last_bar": None, "restarts": 0, "logs": [], "equity_curve": [],
                      "config": {"signal": SIGNAL, "symbols": EXEC_SYMS, "beta": 1.75, "leverage": LEVERAGE,
                                 "margin_fraction": MARGIN_FRACTION, "hold": "swing 48h", "max_sl_pct": 0.07,
                                 "auto_rev_exit": AUTO_REV_EXIT, "semi_auto": True}}
        self._load_state()
        self._pending: dict[pd.Timestamp, dict] = {}
        self._last_ts: pd.Timestamp | None = None
        self._lock = threading.Lock()
        self._last_px: dict[str, float] = {}
        self._warmup(days=5)
        self._adopt_exchange_positions()
        log.info(f"mode={self.ex.mode} wallet={wallet:.2f} symbols={EXEC_SYMS} margin={MARGIN_FRACTION} lev={LEVERAGE} auto_rev_exit={AUTO_REV_EXIT}")

    # ------------------------------------------------------------------ state
    def _load_state(self) -> None:
        if STATE.exists():
            try:
                st = json.loads(STATE.read_text(encoding="utf-8"))
                if st.get("mode") == self.ex.mode:
                    for k in ("started", "seed", "trades", "signals", "restarts", "equity_curve", "paused"):
                        if k in st: self.state[k] = st[k]
                    self.state["restarts"] += 1
                    if self.ex.book:
                        self.ex.book.balance = float(st.get("wallet", self.ex.book.balance))
                    log.info(f"state restored ({self.ex.mode}): trades={len(self.state['trades'])} restarts={self.state['restarts']}")
            except Exception as ex:
                log.warning(f"state load failed: {ex}")
        self.state["started"] = self.state["started"] or datetime.now(KST).isoformat()

    def _log(self, msg: str) -> None:
        log.info(msg)
        self.state["logs"].append(f"[{datetime.now(KST):%m-%d %H:%M:%S}] {msg}")
        self.state["logs"] = self.state["logs"][-40:]

    def _save_state(self) -> None:
        st = self.state
        wallet, equity = self.ex.wallet_usdt()
        st["wallet"], st["equity"] = round(wallet, 4), round(equity, 4)
        st["updated"] = datetime.now(KST).isoformat()
        st["positions"] = {}
        for sym, s in self.strats.items():
            if s.pos is None:
                continue
            p = s.pos
            xp = self._safe_position(sym)
            last = self._last_px.get(sym, p.entry_price)
            unreal = xp["unrealized"] if xp and not self.ex.book else (last - p.entry_price) * p.dir * p.qty
            deadline = p.entry_time + pd.Timedelta(hours=s.p.max_hold_hours)
            st["positions"][sym] = {
                "side": p.side, "entry_time": str(p.entry_time), "entry_price": p.entry_price, "qty": p.qty,
                "init_qty": p.init_qty, "stop": p.stop, "tps": [(l, pr, q) for l, pr, q in p.tps],
                "reason": p.reason_in, "adds": p.adds, "unrealized": round(unreal, 4),
                "margin": round(p.qty * p.entry_price / LEVERAGE, 2),
                "deadline": str(deadline), "hours_left": round((deadline - datetime.now(KST)).total_seconds() / 3600, 1),
                "liq": xp["liq"] if xp else 0.0, "exchange_qty": xp["qty"] if xp else None,
            }
        st["engine"] = {sym: {"pattern": s.pattern.s.label(),
                              "t_low": s.waves.s.t.low if s.waves.s.t else None,
                              "t_high": s.waves.s.t.high if s.waves.s.t else None,
                              "y_low": s.waves.s.y.low if s.waves.s.y else None,
                              "y_high": s.waves.s.y.high if s.waves.s.y else None,
                              "n_long": 0, "n_short": 0,
                              "open_levels": [{"kind": lv.kind, "price": lv.price, "note": lv.note} for lv in s.tracker.open_levels()][-30:]}
                        for sym, s in self.strats.items()}
        # 겹침 카운트 (대시보드용)
        for sym, s in self.strats.items():
            c = self._last_px.get(SIGNAL)
            if c:
                band = c * s.p.conf_band_pct
                lv = s.tracker.open_levels()
                st["engine"][sym]["n_long"] = sum(1 for x in lv if c < x.price <= c + band)
                st["engine"][sym]["n_short"] = sum(1 for x in lv if c - band <= x.price < c)
        st["prices"] = dict(self._last_px)
        try:
            m = self.ex.account_margin()
            st["margin"] = {**{k: round(v, 2) for k, v in m.items()},
                            "cap": round(m["wallet"] * MAX_TOTAL_MARGIN, 2),
                            "max_total_margin": MAX_TOTAL_MARGIN, "reserve": RESERVE,
                            "per_symbol": MARGIN_FRACTION}
        except Exception:
            pass
        tmp = STATE.with_suffix(".tmp")
        tmp.write_text(json.dumps(st, ensure_ascii=False, default=str), encoding="utf-8")
        tmp.replace(STATE)

    # ------------------------------------------------------------------ warmup
    def _warmup(self, days: int) -> None:
        start = datetime.now(KST) - timedelta(days=days)
        sig = add_session(fetch_klines(SIGNAL, "3m", start)).iloc[:-1]
        for sym, s in self.strats.items():
            exe = fetch_klines(sym, "3m", start).iloc[:-1]
            j = sig[["open", "high", "low", "close", "session"]].join(exe[["open", "high", "low", "close"]], how="inner", rsuffix="_x")
            bal = s.balance
            for ts, r in j.iterrows():
                s.on_bar(ts, (r.open, r.high, r.low, r.close), (r.open_x, r.high_x, r.low_x, r.close_x), r.session)
            s.pos = None; s.trades = []; s.signal_log = []; s.balance = bal
            self._last_ts = j.index[-1]
            self._last_px[sym] = float(j.close_x.iloc[-1]); self._last_px[SIGNAL] = float(j.close.iloc[-1])
            log.info(f"warmup {sym}: {len(j)} bars, last={self._last_ts}, pattern={s.pattern.s.label()}")

    def _adopt_exchange_positions(self) -> None:
        """시작 시 거래소에 이미 있는 포지션 = 외부(사용자) 포지션으로 등록."""
        self.state["external"] = []
        for sym in EXEC_SYMS:
            xp = self._safe_position(sym)
            if xp and abs(xp["qty"]) > 0:
                self.state["external"].append(sym)
                self._log(f"{sym}: 거래소에 봇이 모르는 포지션 {xp['qty']} @ {xp['entry']} — 건드리지 않고 진입 보류")
        self._save_state()

    def _safe_position(self, sym: str) -> dict | None:
        try:
            return self.ex.position(sym)
        except Exception as ex:
            log.warning(f"position {sym}: {ex}")
            return None

    # ------------------------------------------------------------------ feeds
    def _poll(self, symbol: str) -> None:
        last_open = None
        while True:
            try:
                r = requests.get(f"{FAPI}/fapi/v1/klines", params={"symbol": symbol, "interval": "3m", "limit": 3}, timeout=10)
                r.raise_for_status()
                rows = r.json()
                self._last_px[symbol] = float(rows[-1][4])
                for k in rows[:-1]:
                    if last_open is None or k[0] > last_open:
                        last_open = k[0]
                        self._on_bar(symbol, {"ts": pd.Timestamp(k[0], unit="ms", tz="UTC").tz_convert(KST),
                                              "open": float(k[1]), "high": float(k[2]), "low": float(k[3]), "close": float(k[4])})
            except Exception as ex:
                log.warning(f"poll {symbol}: {ex}")
            time.sleep(POLL_SEC)

    def _on_bar(self, symbol: str, k: dict) -> None:
        with self._lock:
            ts = k["ts"]
            if self._last_ts is not None and ts <= self._last_ts:
                return
            slot = self._pending.setdefault(ts, {})
            slot[symbol] = k
            if SIGNAL in slot and all(s in slot for s in EXEC_SYMS):
                self._pending.pop(ts)
                for old in [t for t in self._pending if t < ts]:
                    self._pending.pop(old)
                self._last_ts = ts
                try:
                    self._process(ts, slot)
                except Exception as ex:
                    log.exception(f"process error: {ex}")

    # ------------------------------------------------------------------ core
    def _process(self, ts: pd.Timestamp, slot: dict) -> None:
        b = slot[SIGNAL]
        sig_bar = (b["open"], b["high"], b["low"], b["close"])
        sess = session_date(ts)
        line = {"ts": str(ts)[:16], "btc": b["close"]}
        wallet, _ = self.ex.wallet_usdt()
        for sym in EXEC_SYMS:
            e = slot[sym]; s = self.strats[sym]
            self._last_px[sym] = e["close"]
            s.balance = wallet                                   # 사이징 기준 = 지갑 잔고 (복리)
            self._reconcile_before(sym, s, ts)
            blocked = self.state["paused"] or sym in self.state["external"]
            had_pos = s.pos is not None
            res = s.on_bar(ts, sig_bar, (e["open"], e["high"], e["low"], e["close"]), sess)
            line[sym] = e["close"]; line[f"{sym}_state"] = res.label
            if res.opened is not None:
                reason = None
                if blocked:
                    reason = "일시정지" if self.state["paused"] else "외부 포지션"
                else:
                    reason = self._margin_block(sym, res.opened)
                if reason:
                    self._log(f"{sym}: 시그널 발생했지만 진입 안 함 ({reason}) | {res.opened.reason_in}")
                    s.pos = None; res.opened = None
            self._apply(sym, s, res, e["close"], had_pos, ts)
        self.state["bars"].append(line); self.state["bars"] = self.state["bars"][-300:]
        self.state["last_bar"] = str(ts)
        wallet, equity = self.ex.wallet_usdt()
        self.state["equity_curve"].append({"ts": str(ts)[:16], "balance": round(wallet, 2), "equity": round(equity, 2)})
        self.state["equity_curve"] = self.state["equity_curve"][-20000:]
        self._save_state()
        st = " | ".join(f"{s}={line[s]:.4f} {line[s+'_state']}" for s in EXEC_SYMS)
        log.info(f"{ts:%m-%d %H:%M} BTC={b['close']:.1f} | {st} | wallet={wallet:.2f} eq={equity:.2f}")

    def _reconcile_before(self, sym: str, s: CrossStrategy, ts: pd.Timestamp) -> None:
        """봉 처리 전 거래소 포지션과 대조 — 사용자가 손댄 것을 반영."""
        xp = self._safe_position(sym)
        if xp is None:
            return
        xq = abs(xp["qty"])
        if s.pos is not None:
            p = s.pos
            if xq < 1e-9:
                # 봇 포지션이 거래소에서 사라짐: SL/TP 체결 또는 사용자 수동 청산
                start_ms = int(p.entry_time.timestamp() * 1000)
                pnl = self.ex.realized_since(sym, start_ms)
                reason = "EXCHANGE_CLOSED(SL/TP or 수동)"
                self._record_trade(sym, p, ts, self._last_px.get(sym, p.entry_price), pnl, reason)
                self.ex.cancel_all(sym)
                s.pos = None
                self._log(f"{sym}: 포지션이 거래소에서 종료됨 → 수동/체결로 인식, 실현손익 {pnl:+.2f}. 다시 진입 자리 탐색")
            elif abs(xq - p.qty) / max(p.qty, 1e-9) > 0.02:
                self._log(f"{sym}: 수량 변경 감지 {p.qty:.4f} → {xq:.4f} (부분 익절/수동)")
                p.qty = xq
                # TP 사다리 수량 초과분 정리
                tot = sum(q for _, _, q in p.tps)
                if tot > xq and tot > 0:
                    p.tps = [(l, pr, q * xq / tot) for l, pr, q in p.tps]
        else:
            if xq > 1e-9 and sym not in self.state["external"]:
                self.state["external"].append(sym)
                self._log(f"{sym}: 거래소에 봇이 모르는 포지션 {xp['qty']} 발견 → 외부 포지션, 진입 보류")
            elif xq < 1e-9 and sym in self.state["external"]:
                self.state["external"].remove(sym)
                self._log(f"{sym}: 외부 포지션 종료 → 진입 탐색 재개")

    def _margin_block(self, sym: str, pos) -> str | None:
        """증거금 안전장치. 진입 불가면 사유 문자열, 가능하면 None.

        교차 전략은 BTC 시그널 하나로 전 종목이 동시에 발동하므로, 전체 증거금 상한이 없으면
        (종목수 × 20%) 가 지갑을 넘겨 주문 거부·청산 위험이 커진다.
        """
        try:
            m = self.ex.account_margin()
        except Exception as ex:
            log.warning(f"account_margin: {ex}")
            return None
        need = pos.qty * pos.entry_price / LEVERAGE
        usable = m["available"] * (1 - RESERVE)
        if need > usable:
            return f"가용잔고 부족 (필요 {need:.2f} > 가용×{1-RESERVE:.0%} {usable:.2f})"
        cap = m["wallet"] * MAX_TOTAL_MARGIN
        if m["used_margin"] + need > cap:
            return f"전체 증거금 상한 초과 (사용 {m['used_margin']:.2f} + 필요 {need:.2f} > 상한 {cap:.2f})"
        return None

    def _apply(self, sym: str, s: CrossStrategy, res, px: float, had_pos: bool, ts: pd.Timestamp) -> None:
        """엔진 이벤트를 거래소 주문으로."""
        if res.opened is not None:
            p = res.opened
            side = "BUY" if p.side == "LONG" else "SELL"
            close_side = "SELL" if p.side == "LONG" else "BUY"
            notional = p.qty * px
            if notional < self.ex.min_notional(sym):
                self._log(f"{sym}: 명목 {notional:.2f} < 최소 주문금액 → 진입 취소"); s.pos = None; return
            o = self.ex.market(sym, side, p.qty, ref_price=px)
            if not o:
                self._log(f"{sym}: 진입 주문 실패"); s.pos = None; return
            p.qty = p.init_qty = o.get("qty", p.qty)
            p.entry_price = float(o.get("avgPrice") or px)
            self.ex.stop_market(sym, close_side, p.stop)
            for label, price, q in p.tps:
                self._tp(sym, close_side, q, price)
            ev = {"ts": str(ts)[:16], "symbol": sym, "side": p.side, "price": p.entry_price, "qty": p.qty,
                  "stop": p.stop, "margin": round(p.qty * p.entry_price / LEVERAGE, 2), "reason": p.reason_in,
                  "tps": [(l, pr) for l, pr, _ in p.tps]}
            self.state["signals"].append(ev)
            self._log(f"ENTRY {sym} {p.side} qty={p.qty} @ {p.entry_price:.4f} stop={p.stop:.4f} margin=${ev['margin']} | {p.reason_in}")
            return
        p = s.pos
        if res.closed is not None:
            t = res.closed
            if t.reason_out in ("TIME", "REV_EXIT", "EOD"):
                xp = self._safe_position(sym)
                if xp and abs(xp["qty"]) > 1e-9:
                    side = "SELL" if t.side == "LONG" else "BUY"
                    self.ex.market(sym, side, abs(xp["qty"]), reduce_only=True, ref_price=px)
                self.ex.cancel_all(sym)
                pnl = self.ex.realized_since(sym, int(t.entry_time.timestamp() * 1000)) if not self.ex.book else t.pnl
                label = "48h 시간만료 시장가" if t.reason_out == "TIME" else t.reason_out
                self._record_trade_row(sym, t, pnl, label)
                self._log(f"EXIT {sym} {t.side} {label} pnl={pnl:+.2f}")
            else:
                # SL / TP_ALL: 거래소 주문이 체결됐어야 함. 남아 있으면 강제 정리
                xp = self._safe_position(sym)
                if xp and abs(xp["qty"]) > 1e-9:
                    side = "SELL" if t.side == "LONG" else "BUY"
                    self.ex.market(sym, side, abs(xp["qty"]), reduce_only=True, ref_price=px)
                self.ex.cancel_all(sym)
                pnl = self.ex.realized_since(sym, int(t.entry_time.timestamp() * 1000)) if not self.ex.book else t.pnl
                self._record_trade_row(sym, t, pnl, t.reason_out)
                self._log(f"EXIT {sym} {t.side} {t.reason_out} pnl={pnl:+.2f}")
            return
        if p is not None and res.fills:
            added = False
            for f in res.fills:
                if f.reason == "ADD":
                    o = self.ex.market(sym, "BUY" if p.side == "LONG" else "SELL", -f.qty, ref_price=px)
                    added = bool(o)
                    self._log(f"{sym}: 분할 추가 진입 qty={-f.qty:.4f} @ {px:.4f}")
                elif f.reason.startswith("TP"):
                    self._log(f"{sym}: 엔진 기준 {f.reason} 도달 (거래소 체결은 대조로 확인)")
            if added:
                close_side = "SELL" if p.side == "LONG" else "BUY"
                self.ex.cancel_all(sym)
                self.ex.stop_market(sym, close_side, p.stop)
                for label, price, q in p.tps:
                    self._tp(sym, close_side, q, price)

    def _tp(self, sym: str, side: str, qty: float, price: float) -> None:
        if self.ex.book:
            return
        try:
            self.ex._signed("POST", "/fapi/v1/order", symbol=sym, side=side, type="LIMIT",
                            quantity=self.ex.round_qty(sym, qty), price=self.ex.round_price(sym, price),
                            timeInForce="GTC", reduceOnly="true")
        except Exception as ex:
            log.warning(f"TP {sym} {price}: {ex}")

    # ------------------------------------------------------------------ records
    def _record_trade(self, sym, p, ts, exit_px, pnl, reason):
        t = Trade(p.side, p.kind, p.entry_time, ts, p.entry_price, exit_px, p.init_qty, pnl, p.reason_in, reason,
                  len(p.fills))
        self._record_trade_row(sym, t, pnl, reason)

    def _record_trade_row(self, sym, t: Trade, pnl: float, reason: str) -> None:
        wallet, _ = self.ex.wallet_usdt()
        row = {**asdict(t), "symbol": sym, "pnl": round(pnl, 4), "reason_out": reason, "balance_after": round(wallet, 2)}
        row["entry_time"], row["exit_time"] = str(t.entry_time), str(t.exit_time)
        self.state["trades"].append(row)
        pd.DataFrame([row]).to_csv(TRADES_CSV, mode="a", header=not TRADES_CSV.exists(), index=False)

    # ------------------------------------------------------------------ commands (dashboard)
    def _commands(self) -> None:
        if not CMD.exists():
            return
        try:
            cmd = json.loads(CMD.read_text(encoding="utf-8")); CMD.unlink()
        except Exception:
            return
        with self._lock:
            if "pause" in cmd:
                self.state["paused"] = bool(cmd["pause"])
                self._log(f"진입 {'일시정지' if self.state['paused'] else '재개'} (대시보드)")
            for sym in cmd.get("close", []):
                s = self.strats.get(sym)
                xp = self._safe_position(sym)
                if xp and abs(xp["qty"]) > 1e-9:
                    side = "SELL" if xp["qty"] > 0 else "BUY"
                    px = self._last_px.get(sym, xp["entry"])
                    self.ex.market(sym, side, abs(xp["qty"]), reduce_only=True, ref_price=px)
                    self.ex.cancel_all(sym)
                    if s and s.pos is not None:
                        pnl = self.ex.realized_since(sym, int(s.pos.entry_time.timestamp() * 1000)) if not self.ex.book else \
                            (px - s.pos.entry_price) * s.pos.dir * s.pos.qty
                        self._record_trade(sym, s.pos, pd.Timestamp.now(tz=KST), px, pnl, "MANUAL_DASH 시장가")
                        s.pos = None
                    self._log(f"{sym}: 대시보드 명령으로 시장가 청산")
                else:
                    self._log(f"{sym}: 청산 명령 — 포지션 없음")
            self._save_state()

    def run(self) -> None:
        for sym in [SIGNAL] + EXEC_SYMS:
            threading.Thread(target=self._poll, args=(sym,), daemon=True).start()
        self._log(f"라이브 러너 시작 mode={self.ex.mode} symbols={EXEC_SYMS} margin={MARGIN_FRACTION} lev={LEVERAGE}")
        self._save_state()
        while True:
            self._commands()
            time.sleep(POLL_SEC)


if __name__ == "__main__":
    Runner().run()
