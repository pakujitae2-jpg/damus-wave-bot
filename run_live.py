"""실시간 실행. .env 에 BINANCE_API_KEY / BINANCE_API_SECRET / BINANCE_TESTNET / PAPER 설정.
python run_live.py            # .env 기준 (기본 paper)
"""
import logging
import os
import sys

from damus.config import StrategyParams, load_exec_params
from damus.exec.live import LiveRunner

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout),
                              logging.FileHandler("output/live.log", encoding="utf-8")])

if __name__ == "__main__":
    ep = load_exec_params()
    sp = StrategyParams(symbol=os.getenv("SYMBOL", "BTCUSDT"), signal_symbol=os.getenv("SIGNAL_SYMBOL", ""),
                        cross_beta=float(os.getenv("CROSS_BETA", "1.75")), max_sl_pct=float(os.getenv("MAX_SL_PCT", "0.07")))
    if not ep.paper and not ep.testnet:
        ans = input("⚠ 실계좌 LIVE 주문 모드입니다. 계속하려면 'LIVE' 입력: ")
        if ans.strip() != "LIVE":
            sys.exit(0)
    LiveRunner(sp, ep).run(feed=os.getenv("DATA_FEED", "rest"))
