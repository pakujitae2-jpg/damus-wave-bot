"""Y / T / R 파동 엔진 (봉 단위 증분 계산).

- Y (전일): 전 세션 저~고, 고정. 목표가(#n-k) 산출.
- T (오늘): 현 세션 누적 저~고, 갱신될 때마다 이동. 추세/전환 판단 기준.
- R (현재): 마지막 T 극점(고 or 저) 이후 반대 방향으로 가장 멀리 간 지점까지의 스윙.
           T 극점 갱신 시 새 R 생성. 최소 크기 미만이면 '진행형' (R 없음).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from damus.config import EXT, FIB, StrategyParams


@dataclass
class Wave:
    low: float
    high: float

    @property
    def range(self) -> float:
        return self.high - self.low

    def level(self, ratio: float) -> float:
        return self.low + self.range * ratio

    def pos(self, price: float) -> float:
        """0~1 위치 (범위 밖이면 <0 or >1)."""
        return (price - self.low) / self.range if self.range > 0 else 0.5

    def levels(self) -> dict[str, float]:
        d = {"0": self.low, "100": self.high}
        for k, r in FIB.items():
            d[k] = self.level(r)
        return d


@dataclass
class YWave(Wave):
    session: pd.Timestamp | None = None

    def ext_up(self, n: int, k: int) -> float:
        """#n-k 상방 목표 (n층, k=1/2/3/6)."""
        return self.high + self.range * ((n - 1) + EXT[k])

    def ext_down(self, n: int, k: int) -> float:
        return self.low - self.range * ((n - 1) + EXT[k])

    def targets_up(self) -> dict[str, float]:
        return {f"#{n}-{k}": self.ext_up(n, k) for n in (1, 2) for k in (1, 2, 3, 6)}

    def targets_down(self) -> dict[str, float]:
        return {f"#{n}-{k}": self.ext_down(n, k) for n in (1, 2) for k in (1, 2, 3, 6)}


@dataclass
class TWave(Wave):
    session: pd.Timestamp | None = None
    high_time: pd.Timestamp | None = None
    low_time: pd.Timestamp | None = None
    open: float = 0.0

    @property
    def mode(self) -> str:
        """'up' = 마지막 극점이 고가 (상승 임펄스 후), 'down' = 마지막 극점이 저가."""
        if self.high_time is None or self.low_time is None:
            return "flat"
        if self.high_time > self.low_time:
            return "up"
        if self.low_time > self.high_time:
            return "down"
        return "flat"

    # 레드/블루 포인트
    @property
    def red_point(self) -> float:
        return self.level(FIB["l23"])

    @property
    def blue_point(self) -> float:
        return self.level(FIB["l76"])


@dataclass
class RWave(Wave):
    """direction: 'down' = T 고가에서 눌리는 중(R 저가 갱신), 'up' = T 저가에서 반등 중."""
    direction: str = "down"
    anchor_time: pd.Timestamp | None = None
    id: int = 0
    confirmed: bool = False     # R 끝점 이후 38.2% 되돌림(R 반등/눌림) 발생 → R 확정
    confirm_extreme: float | None = None  # 확정 후 되돌림 극점

    @property
    def red_line(self) -> float:
        return self.level(FIB["l23"])

    @property
    def blue_line(self) -> float:
        return self.level(FIB["l76"])

    @property
    def extreme(self) -> float:
        """R 이 진행하며 갱신 중인 끝점 (down 이면 low, up 이면 high)."""
        return self.low if self.direction == "down" else self.high

    @property
    def anchor(self) -> float:
        return self.high if self.direction == "down" else self.low


@dataclass
class WaveState:
    y: YWave | None = None
    t: TWave | None = None
    r: RWave | None = None          # 유효(최소 크기 통과) R
    r_raw: RWave | None = None      # 크기 무관 현재 스윙
    r_counter: int = 0
    new_session: bool = False
    new_t_high: bool = False
    new_t_low: bool = False
    new_r: bool = False


class WaveEngine:
    def __init__(self, params: StrategyParams):
        self.p = params
        self.s = WaveState()
        self._cur_session: pd.Timestamp | None = None

    # ---------------------------------------------------------------
    def update(self, ts: pd.Timestamp, o: float, h: float, l: float, c: float,
               session: pd.Timestamp) -> WaveState:
        s = self.s
        s.new_session = s.new_t_high = s.new_t_low = s.new_r = False

        # --- 세션 롤오버 → Y 확정, T 리셋 ---
        if session != self._cur_session:
            if s.t is not None:
                s.y = YWave(low=s.t.low, high=s.t.high, session=s.t.session)
            s.t = TWave(low=l, high=h, session=session, high_time=ts, low_time=ts, open=o)
            self._cur_session = session
            s.new_session = True
            # 첫 봉: 방향은 봉 색으로
            if c >= o:
                s.t.low_time = ts - pd.Timedelta(seconds=1)
            else:
                s.t.high_time = ts - pd.Timedelta(seconds=1)
            s.r_raw = s.r = None
            self._start_r(ts, s.t)
            return s

        t = s.t
        # --- T 갱신 ---
        hit_high = h > t.high
        hit_low = l < t.low
        if hit_high and hit_low:
            # 양쪽 다 갱신 (큰 봉): 봉 색으로 순서 결정
            if c >= o:
                t.low, t.low_time = l, ts
                t.high, t.high_time = h, ts + pd.Timedelta(seconds=1)
            else:
                t.high, t.high_time = h, ts
                t.low, t.low_time = l, ts + pd.Timedelta(seconds=1)
            s.new_t_high = s.new_t_low = True
        elif hit_high:
            t.high, t.high_time = h, ts
            s.new_t_high = True
        elif hit_low:
            t.low, t.low_time = l, ts
            s.new_t_low = True

        # --- R 갱신 ---
        if s.new_t_high or s.new_t_low:
            self._start_r(ts, t)
        else:
            r = s.r_raw
            if r is not None:
                if r.direction == "down" and l < r.low:
                    r.low = l
                    r.confirmed, r.confirm_extreme = False, None
                elif r.direction == "up" and h > r.high:
                    r.high = h
                    r.confirmed, r.confirm_extreme = False, None
                if r.range > 0:
                    probe = c if self.p.retrace_basis == "close" else (h if r.direction == "down" else l)
                    if r.direction == "down":
                        if probe >= r.level(FIB["l38"]):
                            r.confirmed = True
                        if r.confirmed:
                            r.confirm_extreme = h if r.confirm_extreme is None else max(r.confirm_extreme, h)
                    else:
                        if probe <= r.level(FIB["l61"]):
                            r.confirmed = True
                        if r.confirmed:
                            r.confirm_extreme = l if r.confirm_extreme is None else min(r.confirm_extreme, l)
        self._validate_r()
        return s

    # ---------------------------------------------------------------
    def _start_r(self, ts: pd.Timestamp, t: TWave) -> None:
        s = self.s
        s.r_counter += 1
        if t.mode == "up":
            r = RWave(low=t.high, high=t.high, direction="down", anchor_time=ts, id=s.r_counter)
        else:
            r = RWave(low=t.low, high=t.low, direction="up", anchor_time=ts, id=s.r_counter)
        s.r_raw = r
        s.r = None
        s.new_r = True

    def _validate_r(self) -> None:
        s = self.s
        r = s.r_raw
        if r is None or s.y is None or s.y.range <= 0:
            s.r = None
            return
        if r.range >= s.y.range * self.p.r_min_ratio_of_y:
            s.r = r
        else:
            s.r = None


def compute_waves(df: pd.DataFrame, params: StrategyParams) -> pd.DataFrame:
    """전체 DataFrame 에 대해 Y/T/R 레벨 컬럼 생성 (차트/검증용)."""
    eng = WaveEngine(params)
    rows = []
    for ts, row in df.iterrows():
        s = eng.update(ts, row.open, row.high, row.low, row.close, row.session)
        rec = {"ts": ts}
        if s.y:
            rec.update({"y_low": s.y.low, "y_high": s.y.high,
                        "y_red": s.y.level(FIB["l23"]), "y_blue": s.y.level(FIB["l76"]),
                        "y_1_1_up": s.y.ext_up(1, 1), "y_1_1_dn": s.y.ext_down(1, 1),
                        "y_1_6_up": s.y.ext_up(1, 6), "y_1_6_dn": s.y.ext_down(1, 6)})
        if s.t:
            rec.update({"t_low": s.t.low, "t_high": s.t.high, "t_mode": s.t.mode,
                        "t_23": s.t.level(FIB["l23"]), "t_38": s.t.level(FIB["l38"]),
                        "t_50": s.t.level(FIB["l50"]), "t_61": s.t.level(FIB["l61"]),
                        "t_76": s.t.level(FIB["l76"])})
        if s.r:
            rec.update({"r_id": s.r.id, "r_dir": s.r.direction, "r_low": s.r.low,
                        "r_high": s.r.high, "r_red": s.r.red_line, "r_blue": s.r.blue_line,
                        "r_38": s.r.level(FIB["l38"]), "r_61": s.r.level(FIB["l61"])})
        rows.append(rec)
    out = pd.DataFrame(rows).set_index("ts")
    return df.join(out)
