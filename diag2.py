import sys
from dataclasses import replace
from multiprocessing import Pool
import pandas as pd
from damus.backtest.backtester import report, run_backtest
from damus.config import StrategyParams
from damus.data.binance import add_session, load_klines

BASE = dict(entry_mode="confluence")
VARIANTS = {
 "conf3":                 dict(),
 "be2":                   dict(be_after_tp=2),
 "be0":                   dict(be_after_tp=0),
 "sl5_be2":               dict(conf_sl_pct=0.05, be_after_tp=2),
 "sl5_be0":               dict(conf_sl_pct=0.05, be_after_tp=0),
 "noY_be2":               dict(conf_require_y_break=False, be_after_tp=2),
 "noY_sl5_be2":           dict(conf_require_y_break=False, conf_sl_pct=0.05, be_after_tp=2),
 "noY_sl5_be0":           dict(conf_require_y_break=False, conf_sl_pct=0.05, be_after_tp=0),
 "noY_sl5_be2_intraday":  dict(conf_require_y_break=False, conf_sl_pct=0.05, be_after_tp=2, intraday_only=True),
 "noY_sl5_be2_risk1":     dict(conf_require_y_break=False, conf_sl_pct=0.05, be_after_tp=2, conf_risk=0.01),
}
def one(a):
    df, name, kw, tag = a
    p = replace(StrategyParams(), **BASE, **kw)
    _, tr, _, eq, _ = run_backtest(df, p, 10_000)
    r = report(tr, eq, 10_000)
    out = {"set": tag, "name": name, "trades": r.get("trades",0), "pf": r.get("profit_factor"), "ret%": r.get("return_pct"),
           "dd%": r.get("max_dd_pct"), "wr": r.get("win_rate")}
    if len(tr):
        out["avg_hold_h"] = round(((tr.exit_time-tr.entry_time).dt.total_seconds()/3600).mean(),1)
    for k,v in r.get("by_exit",{}).items(): out["x_"+k]=f"{v['count']}/{v['sum']:+.0f}"
    return out
if __name__=="__main__":
    df = add_session(load_klines("BTCUSDT","3m",days=180))
    split = df.index[-1] - pd.Timedelta(days=60)
    jobs = [(df,n,k,"ALL") for n,k in VARIANTS.items()]
    jobs += [(df[df.index<split],n,k,"IS") for n,k in VARIANTS.items()]
    jobs += [(df[df.index>=split],n,k,"OOS") for n,k in VARIANTS.items()]
    with Pool() as pool:
        res = pd.DataFrame(pool.map(one, jobs))
    pd.set_option("display.width", 250)
    for tag in ("ALL","IS","OOS"):
        print(f"\n== {tag} =="); print(res[res.set==tag].drop(columns="set").to_string(index=False))
