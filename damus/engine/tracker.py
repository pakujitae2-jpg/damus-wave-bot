"""9번(숙제) / SOP / 리테스트 레벨 트래커. 시그널에 직접 쓰이진 않고 목표·참고 레벨로 기록."""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from damus.engine.waves import RWave, WaveState


@dataclass
class Level:
    kind: str          # HW_RED / HW_BLUE / SOP / RETEST_UP / RETEST_DN
    price: float
    created: pd.Timestamp
    note: str = ""
    resolved: pd.Timestamp | None = None


class LevelTracker:
    def __init__(self):
        self.levels: list[Level] = []
        self._last_r: RWave | None = None
        self._touched_red = False
        self._touched_blue = False
        self._hour_open: float | None = None
        self._hour_ts: pd.Timestamp | None = None
        self._hour_high = self._hour_low = None
        self._y_high_broken = False
        self._y_low_broken = False

    def update(self, ts: pd.Timestamp, o: float, h: float, l: float, c: float, ws: WaveState) -> None:
        # ---- 9번 (R 파동 종료 시 레드/블루 라인 미터치) ----
        r = ws.r_raw
        if ws.new_r and self._last_r is not None and self._last_r.range > 0:
            lr = self._last_r
            if not self._touched_red:
                self.levels.append(Level("HW_RED", lr.red_line, ts, f"R{lr.id} 레드 미터치"))
            if not self._touched_blue:
                self.levels.append(Level("HW_BLUE", lr.blue_line, ts, f"R{lr.id} 블루 미터치"))
            self._touched_red = self._touched_blue = False
        if r is not None and r.range > 0:
            if l <= r.red_line <= h: self._touched_red = True
            if l <= r.blue_line <= h: self._touched_blue = True
        self._last_r = r if r is None else RWave(low=r.low, high=r.high, direction=r.direction,
                                                 anchor_time=r.anchor_time, id=r.id)

        # ---- SOP (60분봉 시가 = 고가 or 저가) ----
        hour = ts.floor("h")
        if hour != self._hour_ts:
            if self._hour_ts is not None and self._hour_open is not None:
                if abs(self._hour_open - self._hour_low) < 1e-9 or abs(self._hour_open - self._hour_high) < 1e-9:
                    self.levels.append(Level("SOP", self._hour_open, self._hour_ts, "60분 시가=극값"))
            self._hour_ts, self._hour_open = hour, o
            self._hour_high, self._hour_low = h, l
        else:
            self._hour_high = max(self._hour_high, h)
            self._hour_low = min(self._hour_low, l)

        # ---- 리테스트 (전일 고가 돌파 → -14.6%) ----
        y = ws.y
        if ws.new_session:
            self._y_high_broken = self._y_low_broken = False
        if y is not None and y.range > 0:
            if not self._y_high_broken and h > y.high:
                self._y_high_broken = True
                self.levels.append(Level("RETEST_UP", y.high - y.range * 0.146, ts, "전일고가 돌파 리테스트"))
            if not self._y_low_broken and l < y.low:
                self._y_low_broken = True
                self.levels.append(Level("RETEST_DN", y.low + y.range * 0.146, ts, "전일저가 이탈 리테스트"))

        # ---- 해소 ----
        for lv in self.levels:
            if lv.resolved is None and lv.created < ts and l <= lv.price <= h:
                lv.resolved = ts

    def open_levels(self) -> list[Level]:
        return [lv for lv in self.levels if lv.resolved is None]
