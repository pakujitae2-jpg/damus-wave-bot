"""결합안 A/B 검증. python run_combo.py [days]
A: 다무스 겹침 진입 + V1 존 필터 (swing 48h)
B: V1 엔진 진입 + 다무스 겹침 필터 (V1 청산, 수수료 포함)
"""
import sys
from dataclasses import replace
from multiprocessing import Pool

import pandas as pd

from damus.backtest.backtester import report, run_backtest
from damus.config import StrategyParams
from damus.data.binance import add_session, load_klines
from damus.engine.reasons import compute_reasons
from damus.engine.v1_engine import V1Params, run_v1, summarize

SYMS = ["BTCUSDT", "SOLUSDT", "ETHUSDT", "XRPUSDT"]
A = {
    "A0 겹침 기준(필터X)": dict(),
    "A1 존23.6+반등선행": dict(v1_zone_filter=True, v1_zone_r=0.236, v1_need_bounce=True),
    "A2 존38.2+반등선행": dict(v1_zone_filter=True, v1_zone_r=0.382, v1_need_bounce=True),
    "A3 존23.6 반등불문": dict(v1_zone_filter=True, v1_zone_r=0.236, v1_need_bounce=False),
    "A4 존23.6+반등, 이유2개": dict(v1_zone_filter=True, v1_zone_r=0.236, conf_min_reasons=2),
    "A5 존23.6+반등, 1일단타": dict(v1_zone_filter=True, v1_zone_r=0.236, hold_mode="day"),
}
B = {
    "B0 V1 기준(필터X)": dict(min_reasons=0),
    "B1 이유>=1": dict(min_reasons=1),
    "B2 이유>=2": dict(min_reasons=2),
    "B3 이유>=3": dict(min_reasons=3),
    "B4 이유>=2 롱+숏": dict(min_reasons=2, allow_short=True),
}


def run_a(a):
    sym, df, name, kw, sizing = a
    base = dict(hold_mode="swing", max_hold_hours=48)
    base.update(dict(sizing_mode="risk", conf_risk=0.005) if sizing == "risk"
                else dict(sizing_mode="margin", leverage=10, margin_fraction=0.2))
    base.update(kw)
    p = replace(StrategyParams(symbol=sym), **base)
    _, tr, _, eq, _ = run_backtest(df, p, 10_000)
    r = report(tr, eq, 10_000)
    out = {"symbol": sym, "cfg": name, "sizing": sizing, "trades": r.get("trades", 0), "pf": r.get("profit_factor"),
           "ret%": r.get("return_pct"), "dd%": r.get("max_dd_pct"), "wr": r.get("win_rate")}
    if len(tr):
        tr = tr.copy(); tr["m"] = tr.entry_time.dt.tz_localize(None).dt.to_period("M")
        mm = tr.groupby("m").pnl.sum(); out["pos_months"] = f"{(mm > 0).sum()}/{len(mm)}"
    return out


def run_b(a):
    sym, df, reasons, name, kw, sizing = a
    base = dict(fee_rate=0.0004)
    base.update(dict(sizing="fixed", margin_usdt=100) if sizing == "fixed$100"
                else dict(sizing="fraction", margin_fraction=0.2))
    base.update(kw)
    res, eq = run_v1(df, V1Params(symbol=sym, **base), 10_000, reasons=reasons)
    s = summarize(res, eq, 10_000)
    return {"symbol": sym, "cfg": name, "sizing": sizing, "filled": s["filled"], "TP": s["TP"], "SL": s["SL"],
            "wr%": s["win_rate%"], "PF": s["PF"], "ret%": s["return%"], "dd%": s["max_dd%"]}


if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 365
    data = {s: add_session(load_klines(s, "3m", days=days)) for s in SYMS}
    with Pool() as pool:
        reasons = dict(zip(SYMS, pool.starmap(compute_reasons, [(data[s], StrategyParams()) for s in SYMS])))
        ja = [(s, data[s], n, k, sz) for s in SYMS for n, k in A.items() for sz in ("risk", "10x20%")]
        jb = [(s, data[s], reasons[s], n, k, sz) for s in SYMS for n, k in B.items() for sz in ("fixed$100", "10x20%")]
        ra = pd.DataFrame(pool.map(run_a, ja))
        rb = pd.DataFrame(pool.map(run_b, jb))
    pd.set_option("display.width", 250); pd.set_option("display.max_rows", 300)
    print("########## A. 다무스 겹침 + V1 존 필터 (swing 48h)")
    for s in SYMS:
        print(); print("== " + s + " =="); print(ra[ra.symbol == s].drop(columns="symbol").fillna("").to_string(index=False))
    print(); print("########## B. V1 진입 + 다무스 겹침 필터 (V1 청산, 수수료 포함)")
    for s in SYMS:
        print(); print("== " + s + " =="); print(rb[rb.symbol == s].drop(columns="symbol").fillna("").to_string(index=False))
    ra.to_csv(f"output/combo_A_{days}d.csv", index=False)
    rb.to_csv(f"output/combo_B_{days}d.csv", index=False)
