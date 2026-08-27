"""페이퍼 트레이딩 러너 — SOL·ETH 교차 보유형, 시드 $1,000 공유(복리), 증거금 20%.

- 시그널: BTCUSDT 3분봉 (파동·패턴·레벨·겹침), 체결: SOLUSDT / ETHUSDT 3분봉
- 세 심볼을 REST 폴링, 같은 시각 봉이 모두 마감되면 처리 (백테스트와 동일한 CrossStrategy)
- 잔고는 PaperAccount 하나를 두 전략이 공유 → 복리. 주문 전송 없음.
- 상태는 output/paper/state.json 에 매 봉 저장 (프론트엔드가 읽음), 거래는 trades.csv 에 추가.
- 재시작 시 state.json 의 잔고·거래·시그널을 복원하고, 파동 상태는 최근 5일 히스토리로 워밍업.
  (보유 중이던 포지션은 복원하지 않고 기록만 남김 — 페이퍼이므로 손실 없음)
python run_paper.py
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

from damus.config import KST, StrategyParams
from damus.data.binance import FAPI, add_session, fetch_klines, session_date
from damus.engine.cross import CrossStrategy

SEED = float(os.getenv("PAPER_SEED", "1000"))
SIGNAL = "BTCUSDT"
EXEC_SYMS = os.getenv("PAPER_SYMBOLS", "SOLUSDT,ETHUSDT").split(",")
MARGIN_FRACTION = float(os.getenv("PAPER_MARGIN", "0.2"))
POLL_SEC = 5.0
STATE_DIR = Path("output/paper"); STATE_DIR.mkdir(parents=True, exist_ok=True)
STATE = STATE_DIR / "state.json"
TRADES_CSV = STATE_DIR / "trades.csv"
LOG = STATE_DIR / "paper.log"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(LOG, encoding="utf-8")])
log = logging.getLogger("paper")


def make_params(sym: str) -> StrategyParams:
    return replace(StrategyParams(symbol=sym, signal_symbol=SIGNAL, cross_beta=1.75), hold_mode="swing",
                   max_hold_hours=48, max_sl_pct=0.07, sizing_mode="margin", leverage=10,
                   margin_fraction=MARGIN_FRACTION)


class PaperAccount:
    """두 전략이 공유하는 잔고. CrossStrategy.balance 를 프로퍼티로 이 객체에 연결한다."""
    def __init__(self, balance: float):
        self.balance = balance


class SharedBalanceStrategy(CrossStrategy):
    def __init__(self, params, account: PaperAccount, beta: float):
        self._acct = account
        super().__init__(params, account.balance, beta)

    @property
    def balance(self) -> float:          # type: ignore[override]
        return self._acct.balance

    @balance.setter
    def balance(self, v: float) -> None:
        self._acct.balance = v


class PaperRunner:
    def __init__(self):
        self.acct = PaperAccount(SEED)
        self.strats: dict[str, SharedBalanceStrategy] = {
            s: SharedBalanceStrategy(make_params(s), self.acct, 1.75) for s in EXEC_SYMS}
        self.state = {"seed": SEED, "started": None, "balance": SEED, "equity_curve": [], "trades": [],
                      "signals": [], "bars": [], "positions": {}, "last_bar": None, "restarts": 0,
                      "config": {"signal": SIGNAL, "symbols": EXEC_SYMS, "beta": 1.75, "leverage": 10,
                                 "margin_fraction": MARGIN_FRACTION, "hold": "swing 48h", "max_sl_pct": 0.07,
                                 "fee": 0.0004, "compounding": True}}
        self._load_state()
        self._pending: dict[pd.Timestamp, dict] = {}
        self._last_ts: pd.Timestamp | None = None
        self._lock = threading.Lock()
        self._warmup(days=5)

    # ------------------------------------------------------------------
    def _load_state(self) -> None:
        if STATE.exists():
            try:
                st = json.loads(STATE.read_text(encoding="utf-8"))
                self.state.update({k: st[k] for k in ("started", "balance", "equity_curve", "trades", "signals", "restarts") if k in st})
                self.state["restarts"] = self.state.get("restarts", 0) + 1
                self.acct.balance = float(self.state["balance"])
                for s in self.strats.values():
                    s.trades = []  # 기록은 state 에만 (재시작 후 엔진 내부 trades 는 비움)
                log.info(f"state restored: balance={self.acct.balance:.2f} trades={len(self.state['trades'])} restarts={self.state['restarts']}")
            except Exception as ex:
                log.warning(f"state load failed: {ex}")
        if not self.state["started"]:
            self.state["started"] = datetime.now(KST).isoformat()

    def _save_state(self) -> None:
        st = self.state
        st["balance"] = round(self.acct.balance, 4)
        st["updated"] = datetime.now(KST).isoformat()
        st["positions"] = {}
        for sym, s in self.strats.items():
            if s.pos is not None:
                p = s.pos
                st["positions"][sym] = {"side": p.side, "kind": p.kind, "entry_time": str(p.entry_time),
                                        "entry_price": p.entry_price, "qty": p.qty, "init_qty": p.init_qty,
                                        "stop": p.stop, "tps": [(l, pr, q) for l, pr, q in p.tps],
                                        "reason": p.reason_in, "adds": p.adds}
        st["engine"] = {sym: {"pattern": s.pattern.s.label(),
                              "t_low": s.waves.s.t.low if s.waves.s.t else None,
                              "t_high": s.waves.s.t.high if s.waves.s.t else None,
                              "y_low": s.waves.s.y.low if s.waves.s.y else None,
                              "y_high": s.waves.s.y.high if s.waves.s.y else None,
                              "open_levels": [{"kind": lv.kind, "price": lv.price, "note": lv.note, "created": str(lv.created)}
                                              for lv in s.tracker.open_levels()][-30:]}
                        for sym, s in self.strats.items()}
        tmp = STATE.with_suffix(".tmp")
        tmp.write_text(json.dumps(st, ensure_ascii=False, default=str), encoding="utf-8")
        tmp.replace(STATE)

    # ------------------------------------------------------------------
    def _warmup(self, days: int) -> None:
        start = datetime.now(KST) - timedelta(days=days)
        sig = add_session(fetch_klines(SIGNAL, "3m", start)).iloc[:-1]
        for sym, s in self.strats.items():
            exe = fetch_klines(sym, "3m", start).iloc[:-1]
            j = sig[["open", "high", "low", "close", "session"]].join(exe[["open", "high", "low", "close"]], how="inner", rsuffix="_x")
            bal = self.acct.balance
            for ts, r in j.iterrows():
                s.on_bar(ts, (r.open, r.high, r.low, r.close), (r.open_x, r.high_x, r.low_x, r.close_x), r.session)
            s.pos = None; s.trades = []; s.signal_log = []
            self.acct.balance = bal          # 워밍업 손익은 무시
            self._last_ts = j.index[-1]
            log.info(f"warmup {sym}: {len(j)} bars, last={self._last_ts}, pattern={s.pattern.s.label()}")
        self._save_state()

    # ------------------------------------------------------------------
    def _poll(self, symbol: str) -> None:
        last_open = None
        while True:
            try:
                r = requests.get(f"{FAPI}/fapi/v1/klines", params={"symbol": symbol, "interval": "3m", "limit": 3}, timeout=10)
                r.raise_for_status()
                for k in r.json()[:-1]:
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
                self._process(ts, slot)

    def _process(self, ts: pd.Timestamp, slot: dict) -> None:
        b = slot[SIGNAL]
        sig_bar = (b["open"], b["high"], b["low"], b["close"])
        sess = session_date(ts)
        line = {"ts": str(ts)[:16], "btc": b["close"]}
        for sym in EXEC_SYMS:
            e = slot[sym]; s = self.strats[sym]
            res = s.on_bar(ts, sig_bar, (e["open"], e["high"], e["low"], e["close"]), sess)
            line[sym] = e["close"]
            line[f"{sym}_state"] = res.label
            if res.opened is not None:
                p = res.opened
                ev = {"ts": str(ts)[:16], "symbol": sym, "side": p.side, "price": p.entry_price, "qty": p.qty,
                      "stop": p.stop, "margin": round(p.qty * p.entry_price / 10, 2), "reason": p.reason_in}
                self.state["signals"].append(ev)
                log.info(f"ENTRY {sym} {p.side} qty={p.qty:.4f} @ {p.entry_price:.4f} stop={p.stop:.4f} margin=${ev['margin']} | {p.reason_in}")
            for f in res.fills:
                log.info(f"  {sym} fill {f.reason} qty={f.qty:.4f} @ {f.price:.4f}")
            if res.closed is not None:
                t = res.closed
                row = {**asdict(t), "symbol": sym, "balance_after": round(self.acct.balance, 2)}
                row["entry_time"] = str(t.entry_time); row["exit_time"] = str(t.exit_time)
                self.state["trades"].append(row)
                pd.DataFrame([row]).to_csv(TRADES_CSV, mode="a", header=not TRADES_CSV.exists(), index=False)
                log.info(f"EXIT {sym} {t.side} {t.reason_out} pnl={t.pnl:+.2f} balance={self.acct.balance:.2f}")
        # 평가 잔고 (미실현 포함)
        unreal = 0.0
        for sym in EXEC_SYMS:
            p = self.strats[sym].pos
            if p is not None:
                unreal += (slot[sym]["close"] - p.entry_price) * p.dir * p.qty
        self.state["equity_curve"].append({"ts": str(ts)[:16], "balance": round(self.acct.balance, 2),
                                           "equity": round(self.acct.balance + unreal, 2)})
        self.state["equity_curve"] = self.state["equity_curve"][-20000:]
        self.state["bars"].append(line); self.state["bars"] = self.state["bars"][-300:]
        self.state["last_bar"] = str(ts)
        self._save_state()
        st = " | ".join(f"{s}={line[s]:.4f} {line[s+'_state']}" for s in EXEC_SYMS)
        log.info(f"{ts:%m-%d %H:%M} BTC={b['close']:.1f} | {st} | bal={self.acct.balance:.2f} eq={self.acct.balance + unreal:.2f}")

    def run(self) -> None:
        threads = [threading.Thread(target=self._poll, args=(s,), daemon=True) for s in [SIGNAL] + EXEC_SYMS]
        for t in threads: t.start()
        log.info(f"paper running: seed={SEED} symbols={EXEC_SYMS} margin={MARGIN_FRACTION}")
        while True:
            time.sleep(60)


if __name__ == "__main__":
    PaperRunner().run()
