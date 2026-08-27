"""봉 단위 백테스터 + 성과 리포트."""
from __future__ import annotations

from dataclasses import asdict

import numpy as np
import pandas as pd

from damus.config import StrategyParams
from damus.engine.strategy import Strategy


def run_backtest(df: pd.DataFrame, params: StrategyParams, balance: float = 10_000.0):
    st = Strategy(params, balance)
    labels = []
    equity = []
    for ts, r in df.iterrows():
        res = st.on_bar(ts, r.open, r.high, r.low, r.close, r.session)
        labels.append(res.label)
        equity.append(st.balance)
    trades = pd.DataFrame([asdict(t) for t in st.trades])
    sigs = pd.DataFrame([{"ts": s.ts, "side": s.side, "kind": s.kind, "price": s.price,
                          "stop": s.stop, "reason": s.reason} for s in st.signal_log])
    if len(sigs):
        sigs = sigs.set_index("ts")
    eq = pd.Series(equity, index=df.index, name="equity")
    return st, trades, sigs, eq, pd.Series(labels, index=df.index, name="pattern")


def report(trades: pd.DataFrame, eq: pd.Series, balance0: float) -> dict:
    if trades.empty:
        return {"trades": 0}
    pnl = trades.pnl
    wins = pnl[pnl > 0]
    losses = pnl[pnl <= 0]
    dd = (eq / eq.cummax() - 1).min()
    days = (eq.index[-1] - eq.index[0]).days or 1
    out = {
        "trades": len(trades),
        "win_rate": round(len(wins) / len(trades), 3),
        "net_pnl": round(pnl.sum(), 2),
        "return_pct": round(pnl.sum() / balance0 * 100, 2),
        "profit_factor": round(wins.sum() / -losses.sum(), 2) if losses.sum() < 0 else float("inf"),
        "avg_win": round(wins.mean(), 2) if len(wins) else 0,
        "avg_loss": round(losses.mean(), 2) if len(losses) else 0,
        "max_dd_pct": round(dd * 100, 2),
        "trades_per_day": round(len(trades) / days, 2),
        "liquidations": int((trades.reason_out == "LIQ").sum()),
        "final_balance": round(eq.iloc[-1], 2),
        "by_kind": {f"{k[0]}_{k[1]}": v for k, v in trades.groupby(["side", "kind"]).pnl.agg(["count", "sum", "mean"]).round(2).to_dict("index").items()},
        "by_exit": trades.groupby("reason_out").pnl.agg(["count", "sum"]).round(2).to_dict("index"),
    }
    return out
