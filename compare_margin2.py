from dataclasses import replace
from multiprocessing import Pool
import pandas as pd
from damus.backtest.backtester import report, run_backtest
from damus.config import StrategyParams
from damus.data.binance import add_session, load_klines
SYMBOLS = ["SOLUSDT","ETHUSDT","XRPUSDT","BTCUSDT"]
def one(a):
    sym, df, label, kw = a
    p = replace(StrategyParams(), symbol=sym, hold_mode="swing", max_hold_hours=48, **kw)
    _, tr, _, eq, _ = run_backtest(df, p, 10_000)
    r = report(tr, eq, 10_000)
    out = {"symbol": sym, "sizing": label, "trades": r.get("trades",0), "pf": r.get("profit_factor"),
           "ret%": r.get("return_pct"), "dd%": r.get("max_dd_pct"), "wr": r.get("win_rate"), "liq": r.get("liquidations",0)}
    if len(tr):
        tr = tr.copy(); tr["m"] = tr.entry_time.dt.tz_localize(None).dt.to_period("M"); mm = tr.groupby("m").pnl.sum()
        out["pos_months"] = f"{(mm>0).sum()}/{len(mm)}"
        out["L/S pnl"] = f"{tr[tr.side=='LONG'].pnl.sum():+.0f}/{tr[tr.side=='SHORT'].pnl.sum():+.0f}"
    return out
if __name__ == "__main__":
    data = {s: add_session(load_klines(s,"3m",days=365)) for s in SYMBOLS}
    S = {"risk0.5%(레버리지무관)": dict(sizing_mode="risk", conf_risk=0.005),
         "10x 증거금10%": dict(sizing_mode="margin", margin_fraction=0.10),
         "10x 증거금20%": dict(sizing_mode="margin", margin_fraction=0.20),
         "10x 증거금30%": dict(sizing_mode="margin", margin_fraction=0.30)}
    jobs = [(s, data[s], l, k) for s in SYMBOLS for l, k in S.items()]
    with Pool() as pool: res = pd.DataFrame(pool.map(one, jobs))
    pd.set_option("display.width", 250)
    print(res.fillna("").to_string(index=False)); res.to_csv("output/compare_margin2.csv", index=False)
