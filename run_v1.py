"""Bot_v1 엔진 이식 검증 + 조건 적용 비교.
python run_v1.py validate          # SOL 3년, 수수료 0, 증거금 $100 고정 → 원본 골든(backtest-meta.v1.json) 대조
python run_v1.py compare [days]    # SOL/ETH/XRP/BTC × 10배 × 시드 50/70/90% × 수수료 on/off × 롱/롱+숏
"""
import json
import sys
from dataclasses import replace
from multiprocessing import Pool

import pandas as pd

from damus.data.binance import load_klines
from damus.engine.v1_engine import V1Params, run_v1, summarize

GOLDEN = {"sessions": 1095, "filled": 487, "TP": 89, "SL": 363, "expired": 35, "win_rate%": 19.69,
          "PF": 1.038, "net_pnl": 386.68, "by_outcome": {"무효_61.8": 461, "무효_고점": 103, "TP": 89, "SL": 363,
                                                          "시간만료": 35, "무매매": 17, "무효_저점": 27}}


def validate():
    df = load_klines("SOLUSDT", "3m", days=1100)
    df = df[(df.index >= "2023-08-27 09:00:00+09:00") & (df.index < "2026-08-26 09:00:00+09:00")]
    p = V1Params(fee_rate=0.0, sizing="fixed", margin_usdt=100)
    res, eq = run_v1(df, p, initial_equity=100)
    s = summarize(res, eq, 100)
    print("데이터:", df.index[0], "~", df.index[-1], len(df), "bars")
    print("\n== 이식 결과 vs 원본 골든 ==")
    for k in ("sessions", "filled", "TP", "SL", "expired", "win_rate%", "PF", "net_pnl"):
        print(f"{k:14s} 이식={s[k]!s:>10}  골든={GOLDEN[k]!s:>10}")
    print("by_outcome 이식:", s["by_outcome"])
    print("by_outcome 골든:", GOLDEN["by_outcome"])
    res.to_csv("output/v1_validate_sol3y.csv", index=False)


def _one(a):
    sym, df, label, kw = a
    p = replace(V1Params(symbol=sym), **kw)
    res, eq = run_v1(df, p, initial_equity=10_000)
    s = summarize(res, eq, 10_000)
    f = res[res.outcome.isin(("TP", "SL", "시간만료"))]
    out = {"symbol": sym, "cfg": label, "filled": s["filled"], "TP": s["TP"], "SL": s["SL"], "exp": s["expired"],
           "wr%": s["win_rate%"], "PF": s["PF"], "ret%": s["return%"], "final": s["final_equity"],
           "dd%": s["max_dd%"], "ruin": s["ruin"], "liq": s["would_liq"]}
    if len(f):
        f = f.copy(); f["m"] = pd.to_datetime(f.session).dt.to_period("M")
        mm = f.groupby("m").pnl.sum(); out["pos_months"] = f"{(mm > 0).sum()}/{len(mm)}"
    return out


def compare(days: int):
    syms = ["SOLUSDT", "ETHUSDT", "XRPUSDT", "BTCUSDT"]
    data = {s: load_klines(s, "3m", days=days) for s in syms}
    cfgs = {}
    for fee, ftag in ((0.0, "fee0"), (0.0004, "fee")):
        for short, stag in ((False, "L"), (True, "L+S")):
            cfgs[f"고정$100 {ftag} {stag}"] = dict(sizing="fixed", margin_usdt=100, fee_rate=fee, allow_short=short)
            for fr in (0.5, 0.7, 0.9):
                cfgs[f"시드{int(fr*100)}% {ftag} {stag}"] = dict(sizing="fraction", margin_fraction=fr, fee_rate=fee, allow_short=short)
    jobs = [(s, data[s], l, k) for s in syms for l, k in cfgs.items()]
    with Pool() as pool:
        res = pd.DataFrame(pool.map(_one, jobs))
    pd.set_option("display.width", 250); pd.set_option("display.max_rows", 200)
    for s in syms:
        d = data[s]
        print(f"\n== {s}  {d.index[0].date()} ~ {d.index[-1].date()}  가격 {d.close.iloc[0]:.2f} → {d.close.iloc[-1]:.2f} ({(d.close.iloc[-1]/d.close.iloc[0]-1)*100:+.0f}%) ==")
        print(res[res.symbol == s].drop(columns="symbol").fillna("").to_string(index=False))
    res.to_csv(f"output/v1_compare_{days}d.csv", index=False)


if __name__ == "__main__":
    if sys.argv[1] == "validate":
        validate()
    else:
        compare(int(sys.argv[2]) if len(sys.argv) > 2 else 365)
