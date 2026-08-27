"""바이낸스 USDT-M 선물 주문 실행기 (paper / testnet / live).

paper=True 면 주문을 보내지 않고 내부 장부(PaperBook)로 포지션·잔고를 흉내낸다 — 라이브 러너가
paper/testnet/live 모두 같은 코드 경로를 타도록 하기 위함.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import math
import time
from urllib.parse import urlencode

import requests

from damus.config import ExecParams

log = logging.getLogger("exec")


class PaperBook:
    """paper 모드 내부 장부. 심볼별 (qty, entry). 시장가 체결은 호출자가 넘긴 가격."""
    def __init__(self, balance: float):
        self.balance = balance
        self.pos: dict[str, dict] = {}       # symbol -> {qty(signed), entry}
        self.stops: dict[str, float] = {}
        self.realized: list[dict] = []

    def fill(self, symbol: str, side: str, qty: float, price: float, fee_rate: float) -> float:
        sgn = 1 if side == "BUY" else -1
        p = self.pos.get(symbol, {"qty": 0.0, "entry": 0.0})
        fee = qty * price * fee_rate
        pnl = 0.0
        new_qty = p["qty"] + sgn * qty
        if p["qty"] == 0 or (p["qty"] > 0) == (sgn > 0):          # 신규/증가
            tot = abs(p["qty"]) + qty
            p["entry"] = (p["entry"] * abs(p["qty"]) + price * qty) / tot if tot else price
        else:                                                    # 감소/청산
            closed = min(abs(p["qty"]), qty)
            pnl = (price - p["entry"]) * (1 if p["qty"] > 0 else -1) * closed
        p["qty"] = new_qty
        if abs(p["qty"]) < 1e-12:
            p = {"qty": 0.0, "entry": 0.0}
            self.stops.pop(symbol, None)
        self.pos[symbol] = p
        self.balance += pnl - fee
        if pnl or fee:
            self.realized.append({"time": int(time.time() * 1000), "symbol": symbol, "income": pnl - fee})
        return pnl - fee


class BinanceFutures:
    def __init__(self, ep: ExecParams):
        self.ep = ep
        self.base = "https://testnet.binancefuture.com" if ep.testnet else "https://fapi.binance.com"
        self.sess = requests.Session()
        self.sess.headers["X-MBX-APIKEY"] = ep.api_key
        self._filters: dict[str, dict] = {}
        self.book = PaperBook(ep.initial_balance) if ep.paper else None
        self.fee_rate = 0.0004
        self.leverage = 10          # paper 장부의 증거금 환산용 (러너가 설정)

    @property
    def mode(self) -> str:
        return "paper" if self.ep.paper else ("testnet" if self.ep.testnet else "LIVE")

    # ---------------- low level ----------------
    def _signed(self, method: str, path: str, **params):
        params["timestamp"] = int(time.time() * 1000)
        params["recvWindow"] = 5000
        q = urlencode(params)
        sig = hmac.new(self.ep.api_secret.encode(), q.encode(), hashlib.sha256).hexdigest()
        url = f"{self.base}{path}?{q}&signature={sig}"
        r = self.sess.request(method, url, timeout=10)
        if r.status_code != 200:
            raise RuntimeError(f"{method} {path} {r.status_code}: {r.text}")
        return r.json()

    def _public(self, path: str, **params):
        r = self.sess.get(f"{self.base}{path}", params=params, timeout=10)
        r.raise_for_status()
        return r.json()

    # ---------------- filters ----------------
    def load_filters(self, symbol: str) -> dict:
        if symbol in self._filters:
            return self._filters[symbol]
        try:
            info = self._public("/fapi/v1/exchangeInfo")
            s = next(x for x in info["symbols"] if x["symbol"] == symbol)
            f = {x["filterType"]: x for x in s["filters"]}
            self._filters[symbol] = {
                "tick": float(f["PRICE_FILTER"]["tickSize"]),
                "step": float(f["LOT_SIZE"]["stepSize"]),
                "min_qty": float(f["LOT_SIZE"]["minQty"]),
                "min_notional": float(f.get("MIN_NOTIONAL", {}).get("notional", 5)),
            }
        except Exception as ex:                       # testnet exchangeInfo 실패 대비
            log.warning(f"exchangeInfo {symbol}: {ex} → 기본 필터 사용")
            self._filters[symbol] = {"tick": 0.0001, "step": 0.001, "min_qty": 0.001, "min_notional": 5}
        return self._filters[symbol]

    def round_qty(self, symbol: str, qty: float) -> float:
        f = self.load_filters(symbol)
        return math.floor(qty / f["step"] + 1e-9) * f["step"]

    def round_price(self, symbol: str, px: float) -> float:
        f = self.load_filters(symbol)
        return round(round(px / f["tick"]) * f["tick"], 8)

    def min_notional(self, symbol: str) -> float:
        return self.load_filters(symbol)["min_notional"]

    # ---------------- account ----------------
    def balance_usdt(self) -> float:
        """가용 잔고 (paper: 장부 잔고)."""
        if self.book:
            return self.book.balance
        for a in self._signed("GET", "/fapi/v2/balance"):
            if a["asset"] == "USDT":
                return float(a["availableBalance"])
        return 0.0

    def wallet_usdt(self) -> tuple[float, float]:
        """(지갑 잔고, 미실현 포함 평가)."""
        if self.book:
            return self.book.balance, self.book.balance
        for a in self._signed("GET", "/fapi/v2/balance"):
            if a["asset"] == "USDT":
                return float(a["balance"]), float(a["balance"]) + float(a["crossUnPnl"])
        return 0.0, 0.0

    def account_margin(self) -> dict:
        """{wallet, equity, available, used_margin} — 사이징 안전장치용."""
        if self.book:
            used = sum(abs(p["qty"]) * p["entry"] / max(1, self.leverage) for p in self.book.pos.values())
            return {"wallet": self.book.balance, "equity": self.book.balance,
                    "available": max(0.0, self.book.balance - used), "used_margin": used}
        a = self._signed("GET", "/fapi/v2/account")
        return {"wallet": float(a["totalWalletBalance"]), "equity": float(a["totalMarginBalance"]),
                "available": float(a["availableBalance"]),
                "used_margin": float(a["totalPositionInitialMargin"]) + float(a["totalOpenOrderInitialMargin"])}

    def setup_symbol(self, symbol: str, lev: int) -> None:
        """격리 + 레버리지 + 원웨이 확인. paper 면 무시."""
        if self.book:
            return
        try:
            self._signed("POST", "/fapi/v1/marginType", symbol=symbol, marginType="ISOLATED")
        except RuntimeError as ex:
            if "-4046" not in str(ex):   # 이미 격리
                log.warning(f"marginType {symbol}: {ex}")
        self._signed("POST", "/fapi/v1/leverage", symbol=symbol, leverage=lev)
        mode = self._signed("GET", "/fapi/v1/positionSide/dual")
        if mode.get("dualSidePosition"):
            raise RuntimeError("헤지 모드가 켜져 있습니다. 바이낸스에서 원웨이(단방향) 모드로 바꿔 주세요.")

    def position(self, symbol: str) -> dict:
        """{qty(signed), entry, unrealized, liq, mark}. 없으면 qty=0."""
        if self.book:
            p = self.book.pos.get(symbol, {"qty": 0.0, "entry": 0.0})
            return {"qty": p["qty"], "entry": p["entry"], "unrealized": 0.0, "liq": 0.0, "mark": 0.0}
        for p in self._signed("GET", "/fapi/v2/positionRisk", symbol=symbol):
            if p["symbol"] == symbol:
                return {"qty": float(p["positionAmt"]), "entry": float(p["entryPrice"]),
                        "unrealized": float(p["unRealizedProfit"]), "liq": float(p["liquidationPrice"]),
                        "mark": float(p["markPrice"])}
        return {"qty": 0.0, "entry": 0.0, "unrealized": 0.0, "liq": 0.0, "mark": 0.0}

    def realized_since(self, symbol: str, start_ms: int) -> float:
        """start_ms 이후 실현손익 + 수수료 + 펀딩 합 (USDT)."""
        if self.book:
            return sum(r["income"] for r in self.book.realized if r["symbol"] == symbol and r["time"] >= start_ms)
        rows = self._signed("GET", "/fapi/v1/income", symbol=symbol, startTime=start_ms, limit=1000)
        return sum(float(r["income"]) for r in rows
                   if r["incomeType"] in ("REALIZED_PNL", "COMMISSION", "FUNDING_FEE"))

    def open_orders(self, symbol: str) -> list[dict]:
        if self.book:
            return [{"type": "STOP_MARKET", "stopPrice": self.book.stops[symbol]}] if symbol in self.book.stops else []
        return self._signed("GET", "/fapi/v1/openOrders", symbol=symbol)

    # ---------------- orders ----------------
    def market(self, symbol: str, side: str, qty: float, reduce_only: bool = False, ref_price: float = 0.0) -> dict:
        qty = self.round_qty(symbol, qty)
        if qty <= 0:
            return {}
        if self.book:
            self.book.fill(symbol, side, qty, ref_price, self.fee_rate)
            log.info(f"[PAPER] MARKET {side} {symbol} qty={qty} @~{ref_price} reduceOnly={reduce_only}")
            return {"paper": True, "qty": qty, "avgPrice": ref_price}
        o = self._signed("POST", "/fapi/v1/order", symbol=symbol, side=side, type="MARKET",
                         quantity=qty, reduceOnly="true" if reduce_only else "false")
        # 체결가 확인
        try:
            od = self._signed("GET", "/fapi/v1/order", symbol=symbol, orderId=o["orderId"])
            o["avgPrice"] = float(od.get("avgPrice") or 0) or ref_price
        except Exception:
            o["avgPrice"] = ref_price
        log.info(f"[{self.mode}] MARKET {side} {symbol} qty={qty} avg={o.get('avgPrice')}")
        return o

    def stop_market(self, symbol: str, side: str, stop_price: float) -> dict:
        """전량 손절 (closePosition)."""
        sp = self.round_price(symbol, stop_price)
        if self.book:
            self.book.stops[symbol] = sp
            log.info(f"[PAPER] STOP_MARKET {side} {symbol} stop={sp}")
            return {"paper": True}
        o = self._signed("POST", "/fapi/v1/order", symbol=symbol, side=side, type="STOP_MARKET",
                         stopPrice=sp, closePosition="true", workingType="MARK_PRICE")
        log.info(f"[{self.mode}] STOP_MARKET {side} {symbol} stop={sp}")
        return o

    def cancel_all(self, symbol: str) -> None:
        if self.book:
            self.book.stops.pop(symbol, None)
            return
        try:
            self._signed("DELETE", "/fapi/v1/allOpenOrders", symbol=symbol)
        except RuntimeError as ex:
            log.warning(f"cancel_all {symbol}: {ex}")

    def ping(self) -> bool:
        try:
            self._public("/fapi/v1/ping")
            if not self.book:
                self._signed("GET", "/fapi/v2/balance")
            return True
        except Exception as ex:
            log.error(f"exchange ping failed: {ex}")
            return False
