"""모든 엔진을 묶는 전략 러너 — 백테스트와 실시간이 공유."""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from damus.config import StrategyParams
from damus.engine.pattern import PatternEngine
from damus.engine.risk import Position, RiskManager, Trade
from damus.engine.signals import Signal, SignalEngine
from damus.engine.tracker import LevelTracker
from damus.engine.waves import WaveEngine


@dataclass
class BarResult:
    signal: Signal | None = None
    opened: Position | None = None
    closed: Trade | None = None
    fills: list = field(default_factory=list)
    label: str = ""


class Strategy:
    def __init__(self, params: StrategyParams, balance: float):
        self.p = params
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

    def on_bar(self, ts: pd.Timestamp, o: float, h: float, l: float, c: float,
               session: pd.Timestamp) -> BarResult:
        self.bar_idx += 1
        res = BarResult()
        ws = self.waves.update(ts, o, h, l, c, session)
        ps = self.pattern.update(ts, o, h, l, c, ws)
        self.tracker.update(ts, o, h, l, c, ws)
        res.label = ps.label()

        # 기존 포지션 관리
        if self.pos is not None:
            fills, done = self.risk.manage(self.pos, ts, o, h, l, c, ws, ps)
            self.pos.fills.extend(fills)
            res.fills = fills
            if done:
                tr = self.risk.close_trade(self.pos, ts, done, self.p.fee_rate)
                self.balance += tr.pnl
                self.trades.append(tr)
                res.closed = tr
                if done == "SL" and self.pos.kind == "N":
                    self.pattern.mark_v()
                    self.signals.set_cooldown(self.bar_idx)
                self.pos = None

        # 신규 진입 (같은 봉에서 청산 후 재진입은 허용하지 않음)
        if self.pos is None and res.closed is None:
            sig = self.signals.evaluate(self.bar_idx, ts, o, h, l, c, ws, ps, False,
                                        self.tracker.open_levels())
            if sig is not None:
                # 진입 체결가: 종가 + 슬리피지
                sig.price = c * (1 + self.p.slippage) if sig.side == "LONG" else c * (1 - self.p.slippage)
                pos = self.risk.build_position(sig, self.balance, ws)
                if pos.qty > 0:
                    self.pos = pos
                    res.signal = sig
                    res.opened = pos
                    self.signal_log.append(sig)
        return res
