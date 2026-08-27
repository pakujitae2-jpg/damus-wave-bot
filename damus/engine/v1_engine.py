"""Bot_v1 (Kstudy101/Bot_v1) 잠긴 규칙 엔진 v1.0 의 Python 이식.

원본: src/lib/engine/{spec,simulate,inherit,pnl,clock}.ts — 상태 전이는 simulate.ts 와 1:1 대응.
  - 레인지: 09:00 ~ 21:00 KST (inclusive) 봉의 L/H 잠금
  - 매매창: 21:03 ~ 익일 08:57 KST (inclusive)
  - 게이트: 21:03 시가 >= P(61.8) → 무효_61.8
  - inherit: t_L(저가==L 마지막 봉)부터 레인지 재생 → bounce(>=38.2)/zone(<=23.6) 선행 여부
  - 진입(롱): 21:03 시가가 존[L, P(23.6)] 안이면 즉시. 아니면 WAIT_BOUNCE → WAIT_ZONE → PENDING_NEXT_OPEN
             (다음 봉 시가가 존 안이면 그 시가 진입). 진입 전 low<L → 무효_저점, high>H → 무효_고점
  - 청산: SL low<L (체결 = L 또는 갭이면 시가, TP 와 같은 봉이면 SL 우선) / TP high>=P(76.4) / 08:57 종가
  - 하루 1세팅, 롱 전용.
확장(원본에 없음, 파라미터로 on/off): 수수료, 숏 미러, 증거금 사이징 모드.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

R_ZONE, R_BOUNCE, R_GATE, R_TP = 0.236, 0.382, 0.618, 0.764
EPS = 1e-12
T_L_EPS = 1e-10
LIQ_MAINT = 0.995


@dataclass
class V1Params:
    leverage: int = 10
    margin_usdt: float = 100.0          # sizing='fixed' 일 때 증거금
    sizing: str = "fixed"               # 'fixed' | 'fraction' (현재 시드 × margin_fraction)
    margin_fraction: float = 0.5
    fee_rate: float = 0.0               # 원본 = 0. 바이낸스 taker 0.0004
    slippage: float = 0.0
    allow_short: bool = False           # 숏 미러 (원본에 없음)
    symbol: str = "SOLUSDT"
    min_reasons: int = 0                # >0 이면 진입 시점 다무스 미해소 레벨 수가 이 값 이상이어야 체결 (결합안 B)


@dataclass
class DayResult:
    session: str
    outcome: str
    side: str = "LONG"
    L: float | None = None
    H: float | None = None
    range_pct: float | None = None
    bounce_inherit: int = 0
    zone_inherit: int = 0
    px_2103: float | None = None
    pct_2103: float | None = None
    entry_time: pd.Timestamp | None = None
    entry_px: float | None = None
    exit_time: pd.Timestamp | None = None
    exit_px: float | None = None
    qty: float = 0.0
    margin: float = 0.0
    pnl: float = 0.0
    ret_on_margin: float = 0.0
    would_liq: int = 0
    notes: str = ""


FILLED = ("TP", "SL", "시간만료")


def level(L: float, H: float, r: float) -> float:
    return L + (H - L) * r


def in_zone(px: float, L: float, H: float) -> bool:
    return px >= L and px <= level(L, H, R_ZONE) + EPS


def compute_inherit(rb: np.ndarray, L: float, H: float) -> tuple[int, int]:
    """rb: (n,4) open/high/low/close. t_L 부터 재생."""
    lows = rb[:, 2]
    idx = np.where(np.abs(lows - L) < T_L_EPS)[0]
    t_l = int(idx[-1]) if len(idx) else 0
    bounce_px, zone_px = level(L, H, R_BOUNCE), level(L, H, R_ZONE)
    bounce = zone = False
    for i in range(t_l, len(rb)):
        h, l = rb[i, 1], rb[i, 2]
        if not bounce and h >= bounce_px:
            bounce = True
        if bounce and not zone and l <= zone_px:
            zone = True
    return int(bounce), int(zone)


class V1Engine:
    def __init__(self, p: V1Params):
        self.p = p

    # ------------------------------------------------------------------
    def _fill(self, entry: float, exit_: float, side: int, margin: float) -> tuple[float, float, float]:
        p = self.p
        notional = margin * p.leverage
        qty = notional / entry
        gross = qty * (exit_ - entry) * side
        fees = (qty * entry + qty * exit_) * p.fee_rate
        pnl = gross - fees
        return qty, pnl, pnl / margin

    def simulate_session(self, session: str, rb: np.ndarray, tb: np.ndarray, tb_times: pd.DatetimeIndex,
                         equity: float, reasons: np.ndarray | None = None) -> DayResult:
        self._reasons = reasons  # (m,2) [n_long, n_short] per trade bar, or None
        """rb: 레인지 봉 (n,4), tb: 매매창 봉 (m,4), 둘 다 완전한 세션이라고 가정 (호출자가 검사)."""
        p = self.p
        L, H = float(rb[:, 2].min()), float(rb[:, 1].max())
        if H <= L:
            return DayResult(session, "무매매_레인지0", L=L, H=H)
        range_pct = (H - L) / L * 100
        b_inh, z_inh = compute_inherit(rb, L, H)
        base = dict(L=L, H=H, range_pct=range_pct, bounce_inherit=b_inh, zone_inherit=z_inh)
        px0 = float(tb[0, 0])
        pct0 = (px0 - L) / (H - L) * 100
        base.update(px_2103=px0, pct_2103=pct0)
        margin = p.margin_usdt if p.sizing == "fixed" else equity * p.margin_fraction

        # ---- 롱 (원본) ----
        res = self._run_side(session, tb, tb_times, L, H, b_inh, base, margin, side=1)
        if res is not None:
            return res
        # ---- 숏 미러 (옵션): L↔H 대칭 ----
        if p.allow_short:
            res = self._run_side(session, tb, tb_times, L, H, b_inh, base, margin, side=-1)
            if res is not None:
                return res
        return DayResult(session, "무매매", **base, notes="매매창 종료까지 미체결")

    # ------------------------------------------------------------------
    def _run_side(self, session, tb, tb_times, L, H, b_inh, base, margin, side) -> DayResult | None:
        """side=1: 원본 롱. side=-1: 가격을 (L+H)-px 로 반사해 동일 로직 적용."""
        p = self.p
        if side == -1:
            tb = tb.copy()
            o, h, l, c = tb[:, 0], tb[:, 1], tb[:, 2], tb[:, 3]
            tb = np.column_stack([(L + H) - o, (L + H) - l, (L + H) - h, (L + H) - c])
            # inherit 는 반사 계산 생략 (보수적으로 bounce 미상속)
            b_inh = 0
        px0 = float(tb[0, 0])
        gate_px = level(L, H, R_GATE)
        if px0 >= gate_px:
            if side == 1 and not p.allow_short:
                return DayResult(session, "무효_61.8", **base, notes=f"21:03 시가 {px0:.4f} >= 게이트 {gate_px:.4f}")
            return None if side == 1 else DayResult(session, "무효_61.8", side="SHORT", **base)
        tp_px, bounce_px, zone_px = level(L, H, R_TP), level(L, H, R_BOUNCE), level(L, H, R_ZONE)
        sname = "LONG" if side == 1 else "SHORT"

        def unreflect(px):
            return px if side == 1 else (L + H) - px

        def reasons_ok(i: int) -> bool:
            if p.min_reasons <= 0 or self._reasons is None:
                return True
            col = 0 if side == 1 else 1
            return self._reasons[i, col] >= p.min_reasons

        def in_position(i0: int, entry_px: float) -> DayResult:
            last = len(tb) - 1
            for i in range(i0, last + 1):
                o, h, l, c = tb[i]
                sl_hit = l < L
                tp_hit = h >= tp_px
                if sl_hit:
                    fill = o if o < L else L
                    fill_r = unreflect(fill) * (1 - p.slippage * side)
                    qty, pnl, rom = self._fill(unreflect(entry_px), fill_r, side, margin)
                    return DayResult(session, "SL", side=sname, **base, entry_time=tb_times[i0],
                                     entry_px=unreflect(entry_px), exit_time=tb_times[i], exit_px=fill_r,
                                     qty=qty, margin=margin, pnl=pnl, ret_on_margin=rom,
                                     would_liq=int(L < entry_px * (1 - 1 / p.leverage) * LIQ_MAINT))
                if tp_hit:
                    fill = o if o >= tp_px else tp_px
                    qty, pnl, rom = self._fill(unreflect(entry_px), unreflect(fill), side, margin)
                    return DayResult(session, "TP", side=sname, **base, entry_time=tb_times[i0],
                                     entry_px=unreflect(entry_px), exit_time=tb_times[i], exit_px=unreflect(fill),
                                     qty=qty, margin=margin, pnl=pnl, ret_on_margin=rom)
                if i == last:
                    qty, pnl, rom = self._fill(unreflect(entry_px), unreflect(c), side, margin)
                    return DayResult(session, "시간만료", side=sname, **base, entry_time=tb_times[i0],
                                     entry_px=unreflect(entry_px), exit_time=tb_times[i], exit_px=unreflect(c),
                                     qty=qty, margin=margin, pnl=pnl, ret_on_margin=rom)
            raise RuntimeError("unreachable")

        if in_zone(px0, L, H) and reasons_ok(0):
            return in_position(0, px0)
        state = "WAIT_ZONE" if b_inh == 1 else "WAIT_BOUNCE"
        for i in range(len(tb)):
            o, h, l, c = tb[i]
            if state == "WAIT_BOUNCE":
                if l < L: return DayResult(session, "무효_저점", side=sname, **base)
                if h > H: return DayResult(session, "무효_고점", side=sname, **base)
                if h >= bounce_px: state = "WAIT_ZONE"
                continue
            if state == "WAIT_ZONE":
                if l < L: return DayResult(session, "무효_저점", side=sname, **base)
                if h > H: return DayResult(session, "무효_고점", side=sname, **base)
                if l <= zone_px + EPS: state = "PENDING_NEXT_OPEN"
                continue
            # PENDING_NEXT_OPEN
            if l < L: return DayResult(session, "무효_저점", side=sname, **base)
            if h > H: return DayResult(session, "무효_고점", side=sname, **base)
            if in_zone(o, L, H):
                if reasons_ok(i):
                    return in_position(i, o)
                state = "WAIT_ZONE"   # 필터 미충족 → 다시 존 대기
                continue
            if in_zone(c, L, H):
                continue
            state = "WAIT_ZONE"
        return None  # 무매매 (호출자가 처리)


def run_v1(df: pd.DataFrame, p: V1Params, initial_equity: float = 10_000.0,
           reasons: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.Series]:
    """df: KST tz-aware index, open/high/low/close. 세션별로 잘라 엔진 실행. 복리 잔고 곡선 반환."""
    eng = V1Engine(p)
    idx = df.index
    dates = sorted(set(pd.DatetimeIndex(idx[(idx.hour >= 9)]).normalize()))
    ohlc = df[["open", "high", "low", "close"]].to_numpy()
    results: list[DayResult] = []
    equity = initial_equity
    eq_curve = []
    pos = pd.Series(np.arange(len(idx)), index=idx)
    for d in dates:
        r0, r1 = d + pd.Timedelta(hours=9), d + pd.Timedelta(hours=21)
        t0, t1 = d + pd.Timedelta(hours=21, minutes=3), d + pd.Timedelta(days=1, hours=8, minutes=57)
        if r1 not in pos.index or t1 not in pos.index or t0 not in pos.index:
            results.append(DayResult(str(d.date()), "데이터공백"))
            continue
        rb = ohlc[pos[r0]:pos[r1] + 1] if r0 in pos.index else ohlc[pos.index.searchsorted(r0):pos[r1] + 1]
        tb_slice = slice(pos[t0], pos[t1] + 1)
        tb = ohlc[tb_slice]
        rs = reasons.to_numpy()[tb_slice] if reasons is not None else None
        res = eng.simulate_session(str(d.date()), rb, tb, idx[tb_slice], equity, rs)
        if res.outcome in FILLED:
            equity += res.pnl
            if equity <= 0:
                equity = 0
        eq_curve.append((d, equity))
        results.append(res)
        if equity <= 0:
            break
    out = pd.DataFrame([r.__dict__ for r in results])
    eq = pd.Series([e for _, e in eq_curve], index=[d for d, _ in eq_curve], name="equity")
    return out, eq


def summarize(res: pd.DataFrame, eq: pd.Series, initial: float) -> dict:
    f = res[res.outcome.isin(FILLED)]
    tp, sl = f[f.outcome == "TP"], f[f.outcome == "SL"]
    wins, losses = f[f.pnl > 0], f[f.pnl <= 0]
    dd = (eq / eq.cummax() - 1).min() if len(eq) else 0
    return {
        "sessions": len(res), "filled": len(f), "TP": len(tp), "SL": len(sl),
        "expired": int((f.outcome == "시간만료").sum()),
        "win_rate%": round(len(wins) / len(f) * 100, 1) if len(f) else 0,
        "avg_ret_on_margin%": round(f.ret_on_margin.mean() * 100, 2) if len(f) else 0,
        "PF": round(wins.pnl.sum() / -losses.pnl.sum(), 2) if losses.pnl.sum() < 0 else float("inf"),
        "net_pnl": round(f.pnl.sum(), 2),
        "final_equity": round(eq.iloc[-1], 2) if len(eq) else initial,
        "return%": round((eq.iloc[-1] / initial - 1) * 100, 1) if len(eq) else 0,
        "max_dd%": round(dd * 100, 1),
        "ruin": bool(len(eq) and eq.iloc[-1] <= 0),
        "by_outcome": res.outcome.value_counts().to_dict(),
        "would_liq": int(f.would_liq.sum()),
    }
