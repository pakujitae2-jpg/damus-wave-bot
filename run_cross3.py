"""교차 β1.75 / 손절상한 7% 를 10배 증거금 비중별로. python run_cross3.py [days]"""
import sys
from dataclasses import replace
from multiprocessing import Pool

import pandas as pd

from damus.backtest.backtester import report
from damus.config import StrategyParams
from damus.data.binance import add_session, load_klines
from damus.engine.cross import run_cross

ALTS = ["SOLUSDT", "ETHUSDT", "XRPUSDT"]


def one(a):
    sym, btc, alt, fr = a
    p = replace(StrategyParams(symbol=sym, signal_symbol="BTCUSDT"), hold_mode="swing", max_hold_hours=48,
                max_sl_pct=0.07, sizing_mode="margin", leverage=10, margin_fraction=fr)
    _, tr, eq = run_cross(btc, alt, p, 10_000, 1.75)
    r = report(tr, eq, 10_000)
    tr = tr.copy(); tr["m"] = tr.entry_time.dt.tz_localize(None).dt.to_period("M"); mm = tr.groupby("m").pnl.sum()
    return {"symbol": sym, "margin%": int(fr * 100), "trades": r["trades"], "pf": r["profit_factor"],
            "ret%": r["return_pct"], "final": r["final_balance"], "dd%": r["max_dd_pct"], "liq": r["liquidations"],
            "worst": round(tr.pnl.min()), "pos_months": f"{(mm > 0).sum()}/{len(mm)}"}


if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 365
    btc = add_session(load_klines("BTCUSDT", "3m", days=days))
    alts = {s: add_session(load_klines(s, "3m", days=days)) for s in ALTS}
    with Pool() as pool:
        res = pd.DataFrame(pool.map(one, [(s, btc, alts[s], fr) for s in ALTS for fr in (0.1, 0.2, 0.3, 0.5, 0.7, 0.9)]))
    pd.set_option("display.width", 200)
    print(res.to_string(index=False))
    res.to_csv(f"output/cross3_{days}d.csv", index=False)
