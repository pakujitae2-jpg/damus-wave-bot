"""교차 전략: 시그널은 BTC(신호 차트), 체결은 알트(실행 차트).

- WaveEngine / PatternEngine / LevelTracker / SignalEngine 은 신호 차트(BTC) 봉으로 갱신
- 시그널 발생 시 목표 레벨·손절을 BTC 기준 %거리로 환산 × beta 로 알트 가격에 적용
- 포지션 관리(손절/분할익절/분할진입/시간만료/T 반대전환)는 알트 봉 + BTC 패턴 상태로 수행
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from damus.config import StrategyParams
from damus.engine.pattern import PatternEngine
from damus.engine.risk import Position, RiskManager, Trade
from damus.engine.signals import Signal, SignalEngine
from damus.engine.strategy import BarResult
from damus.engine.tracker import LevelTracker
from damus.engine.waves import WaveEngine


class CrossStrategy:
    def __init__(self, params: StrategyParams, balance: float, beta: float = 1.0):
        self.p = params
        self.beta = beta
        self.balance = balance
        self.waves = WaveEngine(params)
        self.pattern = PatternEngine(params)
        self.signals = SignalEngine(params)
        self.risk = RiskManager(params)
        self.tracker = LevelTracker()
        self.pos: Position | None = None
        self.trades: list[Trade] = []
        self.signal_log: list[Signal] = []
        self.bar_idx = -1

    def on_bar(self, ts: pd.Timestamp, sig_bar, exe_bar, session: pd.Timestamp) -> BarResult:
        """sig_bar / exe_bar: (open, high, low, close) — 각각 BTC / 알트."""
        self.bar_idx += 1
        res = BarResult()
        so, sh, sl, sc = sig_bar
        eo, eh, el, ec = exe_bar
        ws = self.waves.update(ts, so, sh, sl, sc, session)
        ps = self.pattern.update(ts, so, sh, sl, sc, ws)
        self.tracker.update(ts, so, sh, sl, sc, ws)
        res.label = ps.label()

        if self.pos is not None:
            fills, done = self.risk.manage(self.pos, ts, eo, eh, el, ec, ws, ps)
            self.pos.fills.extend(fills)
            res.fills = fills
            if done:
                tr = self.risk.close_trade(self.pos, ts, done, self.p.fee_rate)
                self.balance += tr.pnl
                self.trades.append(tr)
                res.closed = tr
                self.pos = None

        if self.pos is None and res.closed is None:
            sig = self.signals.evaluate(self.bar_idx, ts, so, sh, sl, sc, ws, ps, False,
                                        self.tracker.open_levels())
            if sig is not None:
                sig = self._translate(sig, sc, ec)
                pos = self.risk.build_position(sig, self.balance, ws)
                if pos.qty > 0:
                    self.pos = pos
                    res.signal = sig
                    res.opened = pos
                    self.signal_log.append(sig)
        return res

    def _translate(self, sig: Signal, btc_px: float, alt_px: float) -> Signal:
        """BTC 기준 목표/손절을 %거리 × beta 로 알트 가격에 매핑."""
        b = self.beta
        d = 1 if sig.side == "LONG" else -1
        entry = alt_px * (1 + self.p.slippage * d)
        stop_pct = abs(sig.stop - btc_px) / btc_px * b
        stop_pct = min(max(stop_pct, self.p.min_sl_pct), self.p.max_sl_pct)   # 환산 후 상·하한
        stop = entry * (1 - stop_pct * d)
        targets = None
        if sig.targets:
            targets = [(k, entry * (1 + (v - btc_px) / btc_px * b)) for k, v in sig.targets]
        return Signal(sig.ts, sig.side, sig.kind, entry, stop, sig.size_mult,
                      f"[BTC→alt β{b}] " + sig.reason, targets=targets, risk_override=sig.risk_override)


def run_cross(sig_df: pd.DataFrame, exe_df: pd.DataFrame, params: StrategyParams,
              balance: float = 10_000.0, beta: float = 1.0):
    """두 DataFrame 을 시각으로 inner-join 하여 봉 단위 실행."""
    j = sig_df[["open", "high", "low", "close", "session"]].join(
        exe_df[["open", "high", "low", "close"]], how="inner", rsuffix="_x")
    st = CrossStrategy(params, balance, beta)
    equity = []
    for ts, r in j.iterrows():
        st.on_bar(ts, (r.open, r.high, r.low, r.close), (r.open_x, r.high_x, r.low_x, r.close_x), r.session)
        equity.append(st.balance)
    from dataclasses import asdict
    trades = pd.DataFrame([asdict(t) for t in st.trades])
    eq = pd.Series(equity, index=j.index, name="equity")
    return st, trades, eq
