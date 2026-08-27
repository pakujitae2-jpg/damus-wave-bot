"""파라미터 그리드 탐색 (IS/OOS 분리). python tune.py [days] [oos_days]"""
import itertools, json, sys
from dataclasses import replace
from multiprocessing import Pool

import pandas as pd

from damus.backtest.backtester import report, run_backtest
from damus.config import StrategyParams
from damus.data.binance import add_session, load_klines

GRID = {
    "r_min_ratio_of_y": [0.1, 0.2, 0.3],
    "t_min_ratio_of_y": [0.25, 0.4],
    "retrace_basis": ["close", "touch"],
    "line_tolerance": [0.04, 0.08, 0.12],
    "second_retrace_mode": ["skip", "half"],
    "v_cooldown_bars": [5, 20],
    "allow_reversal_entry": [True, False],
    "max_sl_pct": [0.008, 0.02],
}

def _one(args):
    df, kw = args
    p = replace(StrategyParams(), **kw)
    _, tr, _, eq, _ = run_backtest(df, p, 10_000)
    r = report(tr, eq, 10_000)
    return {**kw, "trades": r.get("trades", 0), "pf": r.get("profit_factor", 0),
            "ret": r.get("return_pct", 0), "dd": r.get("max_dd_pct", 0), "wr": r.get("win_rate", 0)}

def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 180
    oos_days = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    df = add_session(load_klines("BTCUSDT", "3m", days=days))
    split = df.index[-1] - pd.Timedelta(days=oos_days)
    is_df, oos_df = df[df.index < split], df[df.index >= split]
    print(f"IS {is_df.index[0].date()}~{split.date()}  OOS ~{df.index[-1].date()}  bars={len(is_df)}/{len(oos_df)}")
    keys = list(GRID)
    combos = [dict(zip(keys, v)) for v in itertools.product(*GRID.values())]
    print("combos:", len(combos))
    with Pool() as pool:
        res = pd.DataFrame(pool.map(_one, [(is_df, c) for c in combos], chunksize=4))
    res = res[res.trades >= 30].sort_values("pf", ascending=False)
    res.to_csv("output/tune_is.csv", index=False)
    print("\n== IS top 15 ==\n", res.head(15).to_string(index=False))
    top = res.head(10)[keys].to_dict("records")
    with Pool() as pool:
        oos = pd.DataFrame(pool.map(_one, [(oos_df, c) for c in top]))
    oos.to_csv("output/tune_oos.csv", index=False)
    print("\n== OOS of IS top 10 ==\n", oos.to_string(index=False))

if __name__ == "__main__":
    main()
