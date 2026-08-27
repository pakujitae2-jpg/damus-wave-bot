"""교차 방식 강건성: β 세분화 + 손절 상한 + 전반/후반 분할. python run_cross2.py [days]"""
import sys
from dataclasses import replace
from multiprocessing import Pool

import pandas as pd

from damus.backtest.backtester import report
from damus.config import StrategyParams
from damus.data.binance import add_session, load_klines
from damus.engine.cross import run_cross

ALTS = ["SOLUSDT", "ETHUSDT", "XRPUSDT"]
BETAS = [1.25, 1.5, 1.75, 2.0]
SL_CAPS = {"cap없음": 0.20, "cap7%": 0.07, "cap5%": 0.05}


def one(a):
    sym, btc, alt, beta, cap_name, cap, tag = a
    p = replace(StrategyParams(symbol=sym), hold_mode="swing", max_hold_hours=48,
                sizing_mode="risk", conf_risk=0.005, max_sl_pct=cap)
    _, tr, eq = run_cross(btc, alt, p, 10_000, beta)
    r = report(tr, eq, 10_000)
    out = {"symbol": sym, "set": tag, "beta": beta, "sl_cap": cap_name, "trades": r.get("trades", 0),
           "pf": r.get("profit_factor"), "ret%": r.get("return_pct"), "dd%": r.get("max_dd_pct"),
           "wr": r.get("win_rate"), "liq": r.get("liquidations", 0)}
    if len(tr):
        tr = tr.copy(); tr["m"] = tr.entry_time.dt.tz_localize(None).dt.to_period("M")
        mm = tr.groupby("m").pnl.sum(); out["pos_months"] = f"{(mm > 0).sum()}/{len(mm)}"
    return out


if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 365
    btc = add_session(load_klines("BTCUSDT", "3m", days=days))
    alts = {s: add_session(load_klines(s, "3m", days=days)) for s in ALTS}
    split = btc.index[0] + (btc.index[-1] - btc.index[0]) / 2
    jobs = []
    for s in ALTS:
        for b in BETAS:
            for cn, cv in SL_CAPS.items():
                jobs.append((s, btc, alts[s], b, cn, cv, "ALL"))
                jobs.append((s, btc[btc.index < split], alts[s][alts[s].index < split], b, cn, cv, "전반"))
                jobs.append((s, btc[btc.index >= split], alts[s][alts[s].index >= split], b, cn, cv, "후반"))
    with Pool() as pool:
        res = pd.DataFrame(pool.map(one, jobs))
    pd.set_option("display.width", 250); pd.set_option("display.max_rows", 300)
    piv = res.pivot_table(index=["symbol", "beta", "sl_cap"], columns="set", values=["pf", "ret%", "dd%", "trades"], aggfunc="first")
    piv = piv.reindex(columns=["ALL", "전반", "후반"], level=1)
    print(piv.round(2).to_string())
    res.to_csv(f"output/cross2_{days}d.csv", index=False)
