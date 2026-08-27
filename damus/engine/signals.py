"""진입 시그널 판정.

LONG_N  : T up 모드, 첫(또는 둘째) 눌림 성립, 가격이 R(down) 레드 라인 근접, V 플래그/쿨다운 없음
SHORT_N : T down 모드, 첫(또는 둘째) 반등 성립, 가격이 R(up) 블루 라인 근접
LONG_REV / SHORT_REV : T 전환 발생 봉에서 진입
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from damus.config import FIB, StrategyParams
from damus.engine.pattern import PatternState
from damus.engine.waves import WaveState


@dataclass
class Signal:
    ts: pd.Timestamp
    side: str            # LONG / SHORT
    kind: str            # N / REV
    price: float
    stop: float
    size_mult: float     # 1.0 / 0.5
    reason: str
    targets: list | None = None   # (label, price) — confluence 모드의 목표 레벨
    risk_override: float | None = None


class SignalEngine:
    def __init__(self, params: StrategyParams):
        self.p = params
        self.cooldown_until: int = -1   # bar index
        self._last_r_signal: tuple[int, str] | None = None  # 같은 R 에서 중복 진입 방지

    def set_cooldown(self, bar_idx: int) -> None:
        self.cooldown_until = bar_idx + self.p.v_cooldown_bars

    def evaluate(self, bar_idx: int, ts: pd.Timestamp, o: float, h: float, l: float, c: float,
                 ws: WaveState, ps: PatternState, has_position: bool, levels: list | None = None) -> Signal | None:
        if has_position or ws.t is None or ws.y is None or ws.t.range <= 0:
            return None
        if bar_idx < self.cooldown_until:
            return None
        p = self.p
        if p.hold_mode == "day" and (ts.hour >= p.day_entry_cutoff_hour and ts.hour < 9):
            return None
        if p.entry_mode == "confluence":
            return self._confluence(ts, h, l, c, ws, ps, levels or [])

        # ---------- 전환 진입 ----------
        if p.allow_reversal_entry and ps.ev_reversal and ps.reversal:
            if ps.reversal == "UP":
                stop = ws.t.low
                return self._mk(ts, "LONG", "REV", c, stop, 1.0, "T 상방 전환 (첫 반등 고점 돌파)")
            else:
                stop = ws.t.high
                return self._mk(ts, "SHORT", "REV", c, stop, 1.0, "T 하방 전환 (첫 눌림 저점 이탈)")

        # ---------- N자 기본 진입 ----------
        r = ws.r
        if r is None or r.range <= 0 or ps.v_flag or ps.reversal:
            return None
        if not ps.in_retrace or ps.retrace_count == 0:
            return None
        if ps.retrace_count >= 3:
            return None
        if ps.retrace_count == 2 and p.second_retrace_mode == "skip":
            return None
        mult = 0.5 if ps.retrace_count == 2 else 1.0
        if self._last_r_signal == (r.id, ps.mode):
            return None
        tol = r.range * p.line_tolerance

        need_confirm = p.entry_mode == "retest"
        if ps.mode == "up" and r.direction == "down":
            # 눌림 중. 가격이 R 레드 라인(저점+23.6%) 근처 & 저점 위
            red = r.red_line
            if need_confirm and not r.confirmed:
                return None
            if l <= red + tol and c >= red - tol and c > r.low:
                self._last_r_signal = (r.id, ps.mode)
                return self._mk(ts, "LONG", "N", c, r.low - r.range * p.sl_buffer_ratio, mult,
                                f"눌림#{ps.retrace_count} R레드라인 {red:.1f}")
        elif ps.mode == "down" and r.direction == "up":
            blue = r.blue_line
            if need_confirm and not r.confirmed:
                return None
            if h >= blue - tol and c <= blue + tol and c < r.high:
                self._last_r_signal = (r.id, ps.mode)
                return self._mk(ts, "SHORT", "N", c, r.high + r.range * p.sl_buffer_ratio, mult,
                                f"반등#{ps.retrace_count} R블루라인 {blue:.1f}")
        return None

    def _mk(self, ts, side, kind, price, stop, mult, reason) -> Signal | None:
        p = self.p
        dist = abs(price - stop) / price
        if dist < p.min_sl_pct:
            stop = price * (1 - p.min_sl_pct) if side == "LONG" else price * (1 + p.min_sl_pct)
        elif dist > p.max_sl_pct:
            stop = price * (1 - p.max_sl_pct) if side == "LONG" else price * (1 + p.max_sl_pct)
        return Signal(ts, side, kind, price, stop, mult, reason)

    # ------------------------------------------------------------------
    def _confluence(self, ts, h, l, c, ws, ps, levels) -> Signal | None:
        """미해소 레벨(SOP/리테스트/9번)이 현재가 한쪽에 N개 이상 몰려 있을 때 그 방향으로 진입."""
        p = self.p
        y, r = ws.y, ws.r
        band = c * p.conf_band_pct
        above = [(lv.kind, lv.price) for lv in levels if c < lv.price <= c + band]
        below = [(lv.kind, lv.price) for lv in levels if c - band <= lv.price < c]
        # R 라인 근접 (이유 1개)
        r_long = r_short = False
        if p.conf_use_r_line and r is not None and r.range > 0:
            tol = r.range * p.line_tolerance
            r_long = r.direction == "down" and abs(c - r.red_line) <= tol
            r_short = r.direction == "up" and abs(c - r.blue_line) <= tol
        n_long = len(above) + int(r_long)
        n_short = len(below) + int(r_short)
        if p.v1_zone_filter:
            t = ws.t
            pos_t = t.pos(c)
            long_ok = pos_t <= p.v1_zone_r and (not p.v1_need_bounce or (ps.mode == "down" and ps.retrace_count >= 1))
            short_ok = pos_t >= 1 - p.v1_zone_r and (not p.v1_need_bounce or (ps.mode == "up" and ps.retrace_count >= 1))
            if not long_ok: n_long = 0
            if not short_ok: n_short = 0
        y_break_dn = c < y.low
        y_break_up = c > y.high
        if n_long >= p.conf_min_reasons and (y_break_dn or not p.conf_require_y_break) and n_long >= n_short:
            if self._last_r_signal == ("conf", ws.t.session, "LONG"):
                return None
            self._last_r_signal = ("conf", ws.t.session, "LONG")
            tg = sorted(above, key=lambda x: x[1])
            reason = "confluence LONG " + ",".join(f"{k}@{v:.0f}" for k, v in tg) + (" +R레드" if r_long else "")
            return Signal(ts, "LONG", "CONF", c, c * (1 - p.conf_sl_pct), 1.0, reason,
                          targets=[(k, v) for k, v in tg], risk_override=p.conf_risk)
        if n_short >= p.conf_min_reasons and (y_break_up or not p.conf_require_y_break) and n_short > n_long:
            if self._last_r_signal == ("conf", ws.t.session, "SHORT"):
                return None
            self._last_r_signal = ("conf", ws.t.session, "SHORT")
            tg = sorted(below, key=lambda x: -x[1])
            reason = "confluence SHORT " + ",".join(f"{k}@{v:.0f}" for k, v in tg) + (" +R블루" if r_short else "")
            return Signal(ts, "SHORT", "CONF", c, c * (1 + p.conf_sl_pct), 1.0, reason,
                          targets=[(k, v) for k, v in tg], risk_override=p.conf_risk)
        return None
