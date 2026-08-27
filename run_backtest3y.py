"""3년 교차 백테스트 (복리, 10배, 증거금 20%, 시드 $1,000) → output/backtest3y/*.csv + frontend/src/data/backtest.json
python run_backtest3y.py [days=1100]
"""
import json
import sys
from dataclasses import replace
from multiprocessing import Pool
from pathlib import Path

import pandas as pd

from damus.backtest.backtester import report
from damus.config import StrategyParams
from damus.data.binance import add_session, load_klines
from damus.engine.cross import run_cross

SEED = 1_000.0
SYMS = ["SOLUSDT", "ETHUSDT", "XRPUSDT"]   # XRP 는 참고
OUT = Path("output/backtest3y"); OUT.mkdir(parents=True, exist_ok=True)
FE = Path("frontend/src/data"); FE.mkdir(parents=True, exist_ok=True)


def params(sym: str) -> StrategyParams:
    return replace(StrategyParams(symbol=sym, signal_symbol="BTCUSDT", cross_beta=1.75), hold_mode="swing",
                   max_hold_hours=48, max_sl_pct=0.07, sizing_mode="margin", leverage=10, margin_fraction=0.2)


def one(a):
    sym, btc, alt = a
    p = params(sym)
    _, tr, eq = run_cross(btc, alt, p, SEED, p.cross_beta)
    r = report(tr, eq, SEED)
    tr.to_csv(OUT / f"trades_{sym}.csv", index=False)
    daily = eq.groupby(eq.index.tz_localize(None).normalize()).last()
    daily.to_csv(OUT / f"equity_{sym}.csv")
    tr2 = tr.copy(); tr2["m"] = tr2.entry_time.dt.tz_localize(None).dt.to_period("M")
    monthly = tr2.groupby("m").pnl.agg(["count", "sum"])
    yearly = tr2.assign(y=tr2.entry_time.dt.year).groupby("y").pnl.agg(["count", "sum"])
    hold_h = (tr.exit_time - tr.entry_time).dt.total_seconds() / 3600
    summary = {
        "symbol": sym, "seed": SEED, "start": str(alt.index[0].date()), "end": str(alt.index[-1].date()),
        "trades": int(r["trades"]), "win_rate": r["win_rate"], "pf": float(r["profit_factor"]),
        "return_pct": float(r["return_pct"]), "final": float(r["final_balance"]), "max_dd_pct": float(r["max_dd_pct"]),
        "liquidations": int(r["liquidations"]), "avg_hold_h": round(float(hold_h.mean()), 1),
        "worst_trade": round(float(tr.pnl.min()), 2), "best_trade": round(float(tr.pnl.max()), 2),
        "pos_months": f"{int((monthly['sum'] > 0).sum())}/{len(monthly)}",
        "by_exit": {k: {"count": int(v["count"]), "sum": float(v["sum"])} for k, v in r["by_exit"].items()},
        "by_side": {s: {"count": int((tr.side == s).sum()), "sum": round(float(tr[tr.side == s].pnl.sum()), 2)} for s in ("LONG", "SHORT")},
        "yearly": [{"year": int(y), "count": int(c), "pnl": round(float(s), 2)} for y, (c, s) in yearly.iterrows()],
        "monthly": [{"month": str(m), "count": int(c), "pnl": round(float(s), 2)} for m, (c, s) in monthly.iterrows()],
        "equity": [{"date": str(d.date()), "equity": round(float(v), 2)} for d, v in daily.items()],
        "trades_tail": [
            {"side": t.side, "entry_time": str(t.entry_time)[:16], "exit_time": str(t.exit_time)[:16],
             "entry": round(float(t.entry_price), 4), "exit": round(float(t.exit_price), 4),
             "pnl": round(float(t.pnl), 2), "reason_out": t.reason_out, "reason_in": t.reason_in[:80]}
            for t in tr.tail(60).itertuples()],
    }
    return summary


if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 1100
    btc = add_session(load_klines("BTCUSDT", "3m", days=days))
    alts = {s: add_session(load_klines(s, "3m", days=days)) for s in SYMS}
    with Pool(3) as pool:
        res = pool.map(one, [(s, btc, alts[s]) for s in SYMS])
    out = {"generated": pd.Timestamp.now(tz="Asia/Seoul").isoformat(), "config": {
        "signal": "BTCUSDT", "beta": 1.75, "leverage": 10, "margin_fraction": 0.2, "hold": "swing 48h",
        "max_sl_pct": 0.07, "fee": 0.0004, "slippage": 0.0002, "compounding": True, "seed": SEED},
        "symbols": {r["symbol"]: r for r in res}}
    (FE / "backtest.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    (OUT / "summary.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    rows = [{k: r[k] for k in ("symbol", "trades", "win_rate", "pf", "return_pct", "final", "max_dd_pct", "liquidations", "avg_hold_h", "worst_trade", "pos_months")} for r in res]
    print(pd.DataFrame(rows).to_string(index=False))
    for r in res:
        print(f"\n{r['symbol']} 연도별:", r["yearly"])
