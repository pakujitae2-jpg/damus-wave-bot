"""1일 단타 vs 1~2일 보유형 비교. python compare_modes.py [days]"""
import sys
from dataclasses import replace
from multiprocessing import Pool
import pandas as pd
from damus.backtest.backtester import report, run_backtest
from damus.config import StrategyParams
from damus.data.binance import add_session, load_klines

VARIANTS = {
 "DAY 기본":            dict(hold_mode="day"),
 "DAY 분할X":           dict(hold_mode="day", scale_in=False),
 "DAY 컷오프없음":       dict(hold_mode="day", day_entry_cutoff_hour=9),
 "DAY 이유2개":          dict(hold_mode="day", conf_min_reasons=2),
 "DAY 손절3%":           dict(hold_mode="day", conf_sl_pct=0.03),
 "SWING 48h":           dict(hold_mode="swing", max_hold_hours=48),
 "SWING 24h":           dict(hold_mode="swing", max_hold_hours=24),
 "SWING 72h":           dict(hold_mode="swing", max_hold_hours=72),
 "SWING 무제한":         dict(hold_mode="swing", max_hold_hours=0),
 "SWING 48h 분할X":      dict(hold_mode="swing", max_hold_hours=48, scale_in=False),
 "SWING 48h 이유4개":    dict(hold_mode="swing", max_hold_hours=48, conf_min_reasons=4),
 "SWING 48h 본절없음":   dict(hold_mode="swing", max_hold_hours=48, be_after_tp=0),
}
def one(a):
    df, name, kw, tag = a
    p = replace(StrategyParams(), **kw)
    _, tr, _, eq, _ = run_backtest(df, p, 10_000)
    r = report(tr, eq, 10_000)
    out = {"set": tag, "name": name, "trades": r.get("trades",0), "pf": r.get("profit_factor"), "ret%": r.get("return_pct"),
           "dd%": r.get("max_dd_pct"), "wr": r.get("win_rate")}
    if len(tr):
        out["hold_h"] = round(((tr.exit_time-tr.entry_time).dt.total_seconds()/3600).mean(),1)
        out["/month"] = round(len(tr) / max(1,(df.index[-1]-df.index[0]).days) * 30, 1)
        tr = tr.copy(); tr["m"] = tr.entry_time.dt.tz_localize(None).dt.to_period("M")
        mm = tr.groupby("m").pnl.sum()
        out["pos_months"] = f"{(mm>0).sum()}/{len(mm)}"
    for k,v in r.get("by_exit",{}).items(): out["x_"+k]=f"{v['count']}/{v['sum']:+.0f}"
    return out, (name, tag, tr if len(tr) else None)
if __name__=="__main__":
    days = int(sys.argv[1]) if len(sys.argv)>1 else 365
    df = add_session(load_klines("BTCUSDT","3m",days=days))
    split = df.index[0] + (df.index[-1]-df.index[0]) / 2
    jobs = [(df,n,k,"ALL") for n,k in VARIANTS.items()]
    jobs += [(df[df.index<split],n,k,"전반") for n,k in VARIANTS.items()]
    jobs += [(df[df.index>=split],n,k,"후반") for n,k in VARIANTS.items()]
    with Pool() as pool:
        out = pool.map(one, jobs)
    res = pd.DataFrame([o for o,_ in out])
    pd.set_option("display.width", 300); pd.set_option("display.max_columns", 30)
    print(f"데이터: {df.index[0]} ~ {df.index[-1]}  ({len(df)} bars)  분할점 {split}")
    for tag in ("ALL","전반","후반"):
        print(); print("== " + tag + " =="); print(res[res.set==tag].drop(columns="set").fillna("").to_string(index=False))
    res.to_csv("output/compare_modes.csv", index=False)
    # 월별 손익: DAY 기본 vs SWING 48h
    for name in ("DAY 기본","SWING 48h"):
        tr = next(t for o,(n,tag,t) in out if n==name and tag=="ALL")
        if tr is not None:
            tr = tr.copy(); tr["m"] = tr.entry_time.dt.tz_localize(None).dt.to_period("M")
            print(); print("월별 손익 [" + name + "]"); print(tr.groupby("m").pnl.agg(["count","sum"]).round(0).T.to_string())
