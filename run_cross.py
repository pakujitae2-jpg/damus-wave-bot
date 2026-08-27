"""교차 방식 검증: BTC 시그널 → SOL/ETH/XRP 체결. python run_cross.py [days]"""
import sys
from dataclasses import replace
from multiprocessing import Pool

import pandas as pd

from damus.backtest.backtester import report, run_backtest
from damus.config import StrategyParams
from damus.data.binance import add_session, load_klines
from damus.engine.cross import run_cross

ALTS = ["SOLUSDT", "ETHUSDT", "XRPUSDT"]
SIZINGS = {"risk0.5%": dict(sizing_mode="risk", conf_risk=0.005),
           "10x20%": dict(sizing_mode="margin", leverage=10, margin_fraction=0.2),
           "10x50%": dict(sizing_mode="margin", leverage=10, margin_fraction=0.5)}
MODES = {"SWING48": dict(hold_mode="swing", max_hold_hours=48), "DAY": dict(hold_mode="day")}
BETAS = [1.0, 1.5, 2.0]


def one(a):
    kind, sym, btc, alt, beta, mname, mkw, sname, skw = a
    p = replace(StrategyParams(symbol=sym), **mkw, **skw)
    if kind == "cross":
        _, tr, eq = run_cross(btc, alt, p, 10_000, beta)
    else:  # 알트 자체 시그널 (대조군)
        _, tr, _, eq, _ = run_backtest(alt, p, 10_000)
    r = report(tr, eq, 10_000)
    out = {"symbol": sym, "kind": kind, "beta": beta if kind == "cross" else "", "mode": mname, "sizing": sname,
           "trades": r.get("trades", 0), "pf": r.get("profit_factor"), "ret%": r.get("return_pct"),
           "dd%": r.get("max_dd_pct"), "wr": r.get("win_rate")}
    if len(tr):
        tr = tr.copy(); tr["m"] = tr.entry_time.dt.tz_localize(None).dt.to_period("M")
        mm = tr.groupby("m").pnl.sum(); out["pos_months"] = f"{(mm > 0).sum()}/{len(mm)}"
        out["hold_h"] = round(((tr.exit_time - tr.entry_time).dt.total_seconds() / 3600).mean(), 1)
        for k, v in r.get("by_exit", {}).items(): out["x_" + k] = f"{v['count']}/{v['sum']:+.0f}"
    return out


if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 365
    btc = add_session(load_klines("BTCUSDT", "3m", days=days))
    alts = {s: add_session(load_klines(s, "3m", days=days)) for s in ALTS}
    jobs = []
    for s in ALTS:
        for mn, mk in MODES.items():
            for sn, sk in SIZINGS.items():
                jobs.append(("own", s, btc, alts[s], None, mn, mk, sn, sk))
                for b in BETAS:
                    jobs.append(("cross", s, btc, alts[s], b, mn, mk, sn, sk))
    # BTC 자체 (참고)
    for mn, mk in MODES.items():
        for sn, sk in SIZINGS.items():
            jobs.append(("own", "BTCUSDT", btc, btc, None, mn, mk, sn, sk))
    with Pool() as pool:
        res = pd.DataFrame(pool.map(one, jobs))
    pd.set_option("display.width", 300); pd.set_option("display.max_rows", 300); pd.set_option("display.max_columns", 30)
    for s in ALTS + ["BTCUSDT"]:
        print(); print("== " + s + " =="); print(res[res.symbol == s].drop(columns="symbol").fillna("").to_string(index=False))
    res.to_csv(f"output/cross_{days}d.csv", index=False)
