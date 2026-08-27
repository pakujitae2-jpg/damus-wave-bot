"""T 파동 패턴 상태머신: 눌림/반등 카운트, N/V 판정, 전환 감지.

down 모드 (마지막 T 극점 = 저가, 고점에서 밀린 상황):
  - 저점 대비 +38.2% (T range 기준) 도달 → 반등 카운트 ++ ("샷다 닫기")
  - 첫 반등의 고점을 저장 (first_bounce_high)
  - 두 번째 이후 반등이 first_bounce_high 돌파 → REVERSAL_UP
  - 반등 후 다시 저점 갱신 → 계단식 하락 (카운트 유지)
up 모드는 대칭 (눌림 = 고점 대비 -38.2%, first_dip_low 이탈 → REVERSAL_DOWN).

T 극점 갱신으로 모드가 바뀌면 카운트 리셋.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from damus.config import FIB, StrategyParams
from damus.engine.waves import WaveState


@dataclass
class PatternState:
    mode: str = "flat"                 # up / down / flat
    retrace_count: int = 0             # 현재 모드에서 38.2 되돌림 횟수 (눌림 or 반등)
    in_retrace: bool = False           # 현재 되돌림이 38.2 를 이미 달성했는지
    first_extreme: float | None = None # 첫 되돌림 극점 (up: first_dip_low / down: first_bounce_high)
    cur_extreme: float | None = None   # 현재 되돌림 극점
    reversal: str | None = None        # 'UP' / 'DOWN' — 전환 발생 후 유지
    reversal_time: pd.Timestamp | None = None
    staircase: bool = False            # 계단식 (되돌림 후 극점 재갱신)
    v_flag: bool = False               # 직전 패턴이 V자였음
    # 이벤트 (해당 봉에서만 True)
    ev_retrace: bool = False           # 이번 봉에서 새 되돌림 성립
    ev_reversal: bool = False          # 이번 봉에서 전환 발생
    ev_staircase: bool = False

    def label(self) -> str:
        if self.reversal:
            return f"REV_{self.reversal}"
        if self.mode == "up":
            return f"UP dip#{self.retrace_count}{'*' if self.in_retrace else ''}"
        if self.mode == "down":
            return f"DOWN bounce#{self.retrace_count}{'*' if self.in_retrace else ''}"
        return "FLAT"


class PatternEngine:
    def __init__(self, params: StrategyParams):
        self.p = params
        self.s = PatternState()

    def _reset(self, mode: str) -> None:
        self.s = PatternState(mode=mode)

    def update(self, ts: pd.Timestamp, o: float, h: float, l: float, c: float,
               ws: WaveState) -> PatternState:
        s = self.s
        s.ev_retrace = s.ev_reversal = s.ev_staircase = False
        t = ws.t
        if t is None or t.range <= 0:
            return s

        if ws.new_session:
            self._reset(t.mode)
            return self.s

        # T 범위가 너무 작으면 (장 초반) 되돌림 카운트 보류 — 노이즈 방지
        if ws.y is None or t.range < ws.y.range * self.p.t_min_ratio_of_y:
            if ws.new_t_high or ws.new_t_low:
                if t.mode != s.mode:
                    self._reset(t.mode)
            return self.s

        # --- T 극점 갱신 처리 ---
        if ws.new_t_high or ws.new_t_low:
            new_mode = t.mode
            if new_mode != s.mode:
                # 모드 전환 (예: down 에서 오늘 고가 돌파 → up). 전환 후 목표 달성이면 v_flag 해제
                prev_rev = s.reversal
                self._reset(new_mode)
                s = self.s
                s.v_flag = False if prev_rev else False
            else:
                # 같은 방향 극점 재갱신
                if s.retrace_count >= 1:
                    s.staircase = True
                    s.ev_staircase = True
                s.in_retrace = False
                s.cur_extreme = None
            return s

        # --- 되돌림 측정 (T range 기준) ---
        thr = FIB["l38"] * t.range
        if s.mode == "down":
            probe = c if self.p.retrace_basis == "close" else h
            reached = probe >= t.low + thr
            s.cur_extreme = h if s.cur_extreme is None else max(s.cur_extreme, h)
            if reached and not s.in_retrace:
                s.in_retrace = True
                s.retrace_count += 1
                s.ev_retrace = True
                if s.retrace_count == 1:
                    s.first_extreme = s.cur_extreme
            if s.in_retrace and s.retrace_count == 1:
                s.first_extreme = max(s.first_extreme or 0, h)
            # 전환: 두 번째 이후 반등이 첫 반등 고점 돌파
            if (s.retrace_count >= 2 and s.first_extreme is not None
                    and probe > s.first_extreme and s.reversal is None):
                s.reversal, s.reversal_time, s.ev_reversal = "UP", ts, True
        elif s.mode == "up":
            probe = c if self.p.retrace_basis == "close" else l
            reached = probe <= t.high - thr
            s.cur_extreme = l if s.cur_extreme is None else min(s.cur_extreme, l)
            if reached and not s.in_retrace:
                s.in_retrace = True
                s.retrace_count += 1
                s.ev_retrace = True
                if s.retrace_count == 1:
                    s.first_extreme = s.cur_extreme
            if s.in_retrace and s.retrace_count == 1:
                s.first_extreme = min(s.first_extreme or 1e18, l)
            if (s.retrace_count >= 2 and s.first_extreme is not None
                    and probe < s.first_extreme and s.reversal is None):
                s.reversal, s.reversal_time, s.ev_reversal = "DOWN", ts, True
        return s

    def mark_v(self) -> None:
        """N자 기대 진입이 손절됐을 때 호출 → V자 플래그."""
        self.s.v_flag = True
