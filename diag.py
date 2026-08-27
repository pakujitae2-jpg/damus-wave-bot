import sys, json
from dataclasses import replace
from multiprocessing import Pool
import pandas as pd
from damus.backtest.backtester import report, run_backtest
from damus.config import StrategyParams
from damus.data.binance import add_session, load_klines

VARIANTS = {
 "retest_prev":        dict(entry_mode="retest"),
 "conf3_hold":         dict(),
 "conf3_intraday":     dict(intraday_only=True),
 "conf2_hold":         dict(conf_min_reasons=2),
 "conf3_noYbreak":     dict(conf_require_y_break=False),
 "conf3_band6":        dict(conf_band_pct=0.06),
 "conf3_sl2":          dict(conf_sl_pct=0.02),
 "conf3_sl5":          dict(conf_sl_pct=0.05),
 "conf3_noR":          dict(conf_use_r_line=False),
 "conf4_hold":         dict(conf_min_reasons=4),
}
def one(a):
    df, name, kw = a
    p = replace(StrategyParams(), **kw)
    _, tr, _, eq, _ = run_backtest(df, p, 10_000)
    r = report(tr, eq, 10_000)
    out = {"name": name, "trades": r.get("trades",0), "pf": r.get("profit_factor"), "ret": r.get("return_pct"),
           "dd": r.get("max_dd_pct"), "wr": r.get("win_rate")}
    for k,v in r.get("by_kind",{}).items(): out[k]=f"{v['count']}/{v['sum']:+.0f}"
    for k,v in r.get("by_exit",{}).items(): out["x_"+k]=f"{v['count']}/{v['sum']:+.0f}"
    return out
if __name__=="__main__":
    df = add_session(load_klines("BTCUSDT","3m",days=int(sys.argv[1]) if len(sys.argv)>1 else 180))
    with Pool() as pool:
        res = pool.map(one, [(df,n,k) for n,k in VARIANTS.items()])
    pd.set_option("display.width", 250)
    print(pd.DataFrame(res).to_string(index=False))
