"""레버리지 10배 고정, 시드 50/70/90% 증거금 진입. 종목별 × 단타/보유형 비교.
python compare_margin.py [days]"""
import sys
from dataclasses import replace
from multiprocessing import Pool
import pandas as pd
from damus.backtest.backtester import report, run_backtest
from damus.config import StrategyParams
from damus.data.binance import add_session, load_klines

SYMBOLS = ["SOLUSDT", "ETHUSDT", "XRPUSDT", "BTCUSDT"]
FRACTIONS = [0.5, 0.7, 0.9]
MODES = {"DAY": dict(hold_mode="day"), "SWING48": dict(hold_mode="swing", max_hold_hours=48)}

def one(a):
    sym, df, frac, mname, mkw = a
    p = replace(StrategyParams(), symbol=sym, sizing_mode="margin", leverage=10, margin_fraction=frac, **mkw)
    _, tr, _, eq, _ = run_backtest(df, p, 10_000)
    r = report(tr, eq, 10_000)
    out = {"symbol": sym, "mode": mname, "margin%": int(frac*100), "trades": r.get("trades", 0),
           "pf": r.get("profit_factor"), "ret%": r.get("return_pct"), "final": r.get("final_balance"),
           "dd%": r.get("max_dd_pct"), "wr": r.get("win_rate"), "liq": r.get("liquidations", 0)}
    if len(tr):
        tr = tr.copy(); tr["m"] = tr.entry_time.dt.tz_localize(None).dt.to_period("M")
        mm = tr.groupby("m").pnl.sum()
        out["pos_months"] = f"{(mm>0).sum()}/{len(mm)}"
        out["worst_trade"] = round(tr.pnl.min(), 0)
    for k, v in r.get("by_exit", {}).items():
        out["x_" + k] = f"{v['count']}/{v['sum']:+.0f}"
    return out

if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 365
    data = {s: add_session(load_klines(s, "3m", days=days)) for s in SYMBOLS}
    jobs = [(s, data[s], f, mn, mk) for s in SYMBOLS for mn, mk in MODES.items() for f in FRACTIONS]
    with Pool() as pool:
        res = pd.DataFrame(pool.map(one, jobs))
    pd.set_option("display.width", 320); pd.set_option("display.max_columns", 40)
    for s in SYMBOLS:
        d = data[s]
        print(); print(f"== {s}  {d.index[0].date()} ~ {d.index[-1].date()}  가격 {d.close.iloc[0]:.2f} → {d.close.iloc[-1]:.2f} ({(d.close.iloc[-1]/d.close.iloc[0]-1)*100:+.0f}%) ==")
        print(res[res.symbol == s].drop(columns="symbol").fillna("").to_string(index=False))
    res.to_csv("output/compare_margin.csv", index=False)
