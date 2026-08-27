"""포지션/리스크 관리: 사이징, 분할 익절 사다리, 손절, T 반대 전환 청산, 본절 이동."""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from damus.config import StrategyParams
from damus.engine.pattern import PatternState
from damus.engine.signals import Signal
from damus.engine.waves import WaveState


@dataclass
class Fill:
    ts: pd.Timestamp
    price: float
    qty: float
    reason: str


@dataclass
class Position:
    side: str
    kind: str
    entry_time: pd.Timestamp
    entry_price: float
    qty: float                  # 남은 수량
    init_qty: float
    stop: float
    tps: list[tuple[str, float, float]]   # (label, price, qty)
    reason_in: str
    fills: list[Fill] = field(default_factory=list)
    realized: float = 0.0
    be_moved: bool = False
    tp_hits: int = 0
    adds: int = 0

    @property
    def dir(self) -> int:
        return 1 if self.side == "LONG" else -1


@dataclass
class Trade:
    side: str
    kind: str
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    entry_price: float
    exit_price: float     # 가중 평균 청산가
    qty: float
    pnl: float
    reason_in: str
    reason_out: str
    fills: int


class RiskManager:
    def __init__(self, params: StrategyParams):
        self.p = params

    # ------------------------------------------------------------------
    def build_position(self, sig: Signal, balance: float, ws: WaveState) -> Position:
        p = self.p
        if p.sizing_mode == "margin":
            margin = balance * p.margin_fraction * sig.size_mult
            if p.scale_in:
                margin /= 2          # 절반 먼저, 불리하면 나머지 절반 추가
            qty = margin * p.leverage / sig.price
        else:
            risk_amt = balance * (sig.risk_override or p.risk_per_trade) * sig.size_mult
            dist = abs(sig.price - sig.stop)
            qty = risk_amt / dist if dist > 0 else 0
            max_qty = balance * p.leverage / sig.price
            qty = min(qty, max_qty)
        if sig.targets:
            n = len(sig.targets)
            tps = [(k, v, qty / n) for k, v in sig.targets]
        else:
            tps = self._tp_ladder(sig, ws, qty)
        return Position(side=sig.side, kind=sig.kind, entry_time=sig.ts, entry_price=sig.price,
                        qty=qty, init_qty=qty, stop=sig.stop, tps=tps, reason_in=sig.reason)

    def _tp_ladder(self, sig: Signal, ws: WaveState, qty: float) -> list[tuple[str, float, float]]:
        """익절 후보: R끝 → T 고/저 → Y 전일 고/저 → #1-1 → #1-2 → #1-3 → #1-6 (진입가 기준 유리한 순)."""
        y, t, r = ws.y, ws.t, ws.r
        cands: list[tuple[str, float]] = []
        if sig.side == "LONG":
            if r: cands.append(("R100", r.high))
            cands.append(("T고가", t.high))
            cands.append(("Y고가", y.high))
            for k in (1, 2, 3, 6):
                cands.append((f"#1-{k}", y.ext_up(1, k)))
            cands = [(n, v) for n, v in cands if v > sig.price * 1.001]
            cands.sort(key=lambda x: x[1])
        else:
            if r: cands.append(("R0", r.low))
            cands.append(("T저가", t.low))
            cands.append(("Y저가", y.low))
            for k in (1, 2, 3, 6):
                cands.append((f"#1-{k}", y.ext_down(1, k)))
            cands = [(n, v) for n, v in cands if v < sig.price * 0.999]
            cands.sort(key=lambda x: -x[1])
        # 가격 중복 제거
        uniq: list[tuple[str, float]] = []
        for n, v in cands:
            if not uniq or abs(v - uniq[-1][1]) / v > 0.0005:
                uniq.append((n, v))
        fr = list(self.p.tp_fractions)
        ladder = []
        for i, (n, v) in enumerate(uniq[:len(fr)]):
            ladder.append((n, v, qty * fr[i]))
        # 사다리가 짧으면 마지막 단계에 잔량 몰아줌 (추적 청산 대상)
        return ladder

    # ------------------------------------------------------------------
    def manage(self, pos: Position, ts: pd.Timestamp, o: float, h: float, l: float, c: float,
               ws: WaveState, ps: PatternState) -> tuple[list[Fill], str | None]:
        """한 봉 처리. 반환: (체결 목록, 전량 종료 사유 or None). 보수적: 손절과 익절 동시 터치 시 손절."""
        p = self.p
        fills: list[Fill] = []
        d = pos.dir
        slip = p.slippage

        # 0) 강제청산 (격리): 진입가 대비 (1/lev − mm) 불리
        liq_dist = 1.0 / p.leverage - p.maint_margin
        liq = pos.entry_price * (1 - liq_dist) if d == 1 else pos.entry_price * (1 + liq_dist)
        if (d == 1 and l <= liq) or (d == -1 and h >= liq):
            fills.append(Fill(ts, liq, pos.qty, "LIQ"))
            return fills, "LIQ"

        # 1) 손절
        if (d == 1 and l <= pos.stop) or (d == -1 and h >= pos.stop):
            px = pos.stop * (1 - slip) if d == 1 else pos.stop * (1 + slip)
            if (d == 1 and o < pos.stop) or (d == -1 and o > pos.stop):
                px = o  # 갭
            fills.append(Fill(ts, px, pos.qty, "BE" if pos.be_moved else "SL"))
            return fills, "SL" if not pos.be_moved else "BE"

        # 2) 익절 사다리
        remaining = []
        for label, price, q in pos.tps:
            hit = (d == 1 and h >= price) or (d == -1 and l <= price)
            if hit and q > 0:
                q = min(q, pos.qty)
                fills.append(Fill(ts, price, q, f"TP {label}"))
                pos.qty -= q
                pos.tp_hits += 1
                if not pos.be_moved and p.be_after_tp and pos.tp_hits >= p.be_after_tp:
                    pos.stop = pos.entry_price
                    pos.be_moved = True
            else:
                remaining.append((label, price, q))
        pos.tps = remaining
        if pos.qty <= 1e-12:
            return fills, "TP_ALL"

        # 3) T 반대 전환 → 전량 청산 (추적 익절)
        if p.rev_exit and ps.ev_reversal and ps.reversal and (
                (d == 1 and ps.reversal == "DOWN") or (d == -1 and ps.reversal == "UP")):
            fills.append(Fill(ts, c, pos.qty, "T 반대전환"))
            pos.qty = 0
            return fills, "REV_EXIT"

        # 4) 분할 진입: 불리하게 adverse% 가면 동일 수량 1회 추가 (평단 갱신, TP 수량 비례 확대)
        if p.scale_in and pos.adds == 0 and not pos.be_moved:
            adverse = (pos.entry_price - c) / pos.entry_price if d == 1 else (c - pos.entry_price) / pos.entry_price
            if adverse >= p.scale_in_adverse_pct:
                q = pos.init_qty
                px = c * (1 + slip) if d == 1 else c * (1 - slip)
                pos.entry_price = (pos.entry_price * pos.qty + px * q) / (pos.qty + q)
                pos.qty += q
                pos.init_qty += q
                pos.adds = 1
                pos.tps = [(lb, pr, tq * 2) for lb, pr, tq in pos.tps]
                fills.append(Fill(ts, px, -q, "ADD"))  # 음수 = 추가 진입 표시

        # 5) 1일 단타: 세션 마지막 봉(08:57 KST)에 전량 청산
        if (p.intraday_only or p.hold_mode == "day") and ts.hour == 8 and ts.minute >= 57:
            fills.append(Fill(ts, c, pos.qty, "세션종료"))
            pos.qty = 0
            return fills, "EOD"
        # 6) 보유형: 시간 손절
        if p.hold_mode == "swing" and p.max_hold_hours > 0:
            if (ts - pos.entry_time).total_seconds() / 3600 >= p.max_hold_hours:
                fills.append(Fill(ts, c, pos.qty, "시간만료"))
                pos.qty = 0
                return fills, "TIME"
        return fills, None

    @staticmethod
    def close_trade(pos: Position, exit_time: pd.Timestamp, reason: str, fee_rate: float) -> Trade:
        if not pos.fills:
            raise ValueError("no fills")
        d = pos.dir
        exits = [f for f in pos.fills if f.qty > 0]
        gross = sum((f.price - pos.entry_price) * d * f.qty for f in exits)
        fees = pos.init_qty * pos.entry_price * fee_rate + sum(f.price * f.qty * fee_rate for f in exits)
        avg_exit = sum(f.price * f.qty for f in exits) / sum(f.qty for f in exits)
        return Trade(pos.side, pos.kind, pos.entry_time, exit_time, pos.entry_price, avg_exit,
                     pos.init_qty, gross - fees, pos.reason_in, reason, len(pos.fills))
