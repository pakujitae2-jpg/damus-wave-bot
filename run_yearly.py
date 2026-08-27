"""3년 연도별 시그널 품질 (리스크 0.5% 사이징, 레버리지 무관) — 교차 SOL/ETH/XRP + BTC 자체.
python run_yearly.py [days=1100]"""
import sys
from dataclasses import replace
from multiprocessing import Pool

import pandas as pd

from damus.backtest.backtester import run_backtest
from damus.config import StrategyParams
from damus.data.binance import add_session, load_klines
from damus.engine.cross import run_cross


def stats(tr: pd.DataFrame) -> dict:
    if tr.empty:
        return {"n": 0}
    w, l = tr[tr.pnl > 0], tr[tr.pnl <= 0]
    return {"n": len(tr), "pf": round(w.pnl.sum() / -l.pnl.sum(), 2) if l.pnl.sum() < 0 else float("inf"),
            "wr": round(len(w) / len(tr), 2), "pnl": round(tr.pnl.sum(), 0),
            "avgR": round(tr.pnl.mean() / 50, 3)}  # 50 = 1만 × 0.5%


def one(a):
    kind, sym, btc, alt = a
    p = replace(StrategyParams(symbol=sym, signal_symbol="BTCUSDT" if kind == "cross" else ""), hold_mode="swing",
                max_hold_hours=48, max_sl_pct=0.07 if kind == "cross" else 0.02, sizing_mode="risk", conf_risk=0.005)
    if kind == "cross":
        _, tr, _ = run_cross(btc, alt, p, 10_000, 1.75)
    else:
        _, tr, _, _, _ = run_backtest(alt, p, 10_000)
    tr["year"] = tr.entry_time.dt.year
    rows = [{"symbol": f"{sym} ({kind})", "year": "ALL", **stats(tr)}]
    rows += [{"symbol": f"{sym} ({kind})", "year": y, **stats(g)} for y, g in tr.groupby("year")]
    return rows


if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 1100
    btc = add_session(load_klines("BTCUSDT", "3m", days=days))
    alts = {s: add_session(load_klines(s, "3m", days=days)) for s in ("SOLUSDT", "ETHUSDT", "XRPUSDT")}
    jobs = [("cross", s, btc, alts[s]) for s in alts] + [("own", "BTCUSDT", btc, btc)]
    with Pool(4) as pool:
        res = pd.DataFrame([r for rows in pool.map(one, jobs) for r in rows])
    pd.set_option("display.width", 200)
    print(res.to_string(index=False))
    res.to_csv("output/yearly_quality.csv", index=False)
