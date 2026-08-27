"""백테스트 실행: python run_backtest.py [days] [--chart YYYY-MM-DD]"""
import argparse
import json

from damus.backtest.backtester import report, run_backtest
from damus.chart.plot import plot_session
from damus.config import StrategyParams
from damus.data.binance import add_session, load_klines
from damus.engine.waves import compute_waves


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("days", type=int, nargs="?", default=60)
    ap.add_argument("--symbol", default="BTCUSDT")
    ap.add_argument("--chart", default=None, help="세션 날짜 (YYYY-MM-DD) 차트 출력")
    ap.add_argument("--balance", type=float, default=10_000)
    args = ap.parse_args()

    p = StrategyParams(symbol=args.symbol)
    df = add_session(load_klines(args.symbol, p.timeframe, days=args.days))
    st, trades, sigs, eq, labels = run_backtest(df, p, args.balance)
    rep = report(trades, eq, args.balance)
    print(json.dumps(rep, ensure_ascii=False, indent=2, default=str))
    if len(trades):
        trades.to_csv("output/trades.csv", index=False)
        print(trades.tail(10).to_string())
    if args.chart:
        w = compute_waves(df, p)
        path = plot_session(w, args.chart, trades if len(trades) else None, sigs if len(sigs) else None)
        print("chart:", path)


if __name__ == "__main__":
    main()
