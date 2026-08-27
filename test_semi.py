"""반자동 로직 자체 검증 (거래소 호출 없음, paper 장부 사용).

시나리오
  1) 진입 → 시장가 + STOP_MARKET + TP 지정가가 걸리는가
  2) 사용자가 거래소에서 전량 청산 → 봇이 "수동 종료"로 인식하고 기록 후 다시 탐색 상태가 되는가
  3) 사용자가 절반만 익절 → 봇이 수량을 따라가고 TP 사다리를 비례 축소하는가
  4) 48시간 경과 → 시장가 청산이 나가는가
  5) 봇이 모르는 포지션이 있으면 진입을 보류하는가
python test_semi.py
"""
import os
import sys

os.environ.setdefault("PAPER", "true")
os.environ.setdefault("INITIAL_BALANCE", "1000")

import pandas as pd

from damus.config import KST
from damus.engine.risk import Position
import run_live_semi as R

OK = "✓"
FAIL = "✗"
fails = []


def check(cond: bool, msg: str) -> None:
    print(f"  {OK if cond else FAIL} {msg}")
    if not cond:
        fails.append(msg)


class FakeEx:
    """BinanceFutures 대역 — 거래소 포지션을 테스트가 직접 조작한다."""
    def __init__(self):
        self.mode = "paper"
        self.book = None                      # income API 경로를 타게 해서 실계좌 로직도 검증
        self.pos_map = {}                     # symbol -> qty(signed)
        self.entry_map = {}
        self.orders = []                      # (kind, symbol, side, ...)
        self.balance = 1000.0
        self.income = {}

    def ping(self): return True
    def setup_symbol(self, s, lev): pass
    def wallet_usdt(self): return self.balance, self.balance
    def min_notional(self, s): return 5.0
    def round_qty(self, s, q): return round(q, 3)
    def round_price(self, s, p): return round(p, 4)

    def position(self, sym):
        q = self.pos_map.get(sym, 0.0)
        return {"qty": q, "entry": self.entry_map.get(sym, 0.0), "unrealized": 0.0, "liq": 0.0, "mark": 0.0}

    def market(self, sym, side, qty, reduce_only=False, ref_price=0.0):
        qty = self.round_qty(sym, qty)
        if qty <= 0:
            return {}
        sgn = 1 if side == "BUY" else -1
        cur = self.pos_map.get(sym, 0.0)
        if cur == 0:
            self.entry_map[sym] = ref_price
        self.pos_map[sym] = cur + sgn * qty
        if abs(self.pos_map[sym]) < 1e-9:
            self.pos_map[sym] = 0.0
        self.orders.append(("MARKET", sym, side, qty, ref_price, reduce_only))
        return {"qty": qty, "avgPrice": ref_price, "orderId": len(self.orders)}

    def stop_market(self, sym, side, stop):
        self.orders.append(("STOP", sym, side, stop))
        return {}

    def cancel_all(self, sym):
        self.orders.append(("CANCEL", sym))

    def realized_since(self, sym, start_ms):
        return self.income.get(sym, 0.0)

    def _signed(self, method, path, **params):   # TP LIMIT 경로
        self.orders.append(("TP", params.get("symbol"), params.get("side"), params.get("quantity"), params.get("price")))
        return {"orderId": len(self.orders)}


def build_runner() -> R.Runner:
    r = R.Runner.__new__(R.Runner)          # __init__ 우회 (거래소 접속·워밍업 생략)
    r.ep = type("EP", (), {"paper": True})()
    r.ex = FakeEx()
    r.state = {"mode": "paper", "seed": 1000.0, "started": None, "wallet": 1000.0, "equity": 1000.0,
               "trades": [], "signals": [], "bars": [], "positions": {}, "external": [], "paused": False,
               "last_bar": None, "restarts": 0, "logs": [], "equity_curve": [],
               "config": {"symbols": ["SOLUSDT"]}}
    r._pending, r._last_ts, r._last_px = {}, None, {"SOLUSDT": 100.0, "BTCUSDT": 80000.0}
    import threading
    r._lock = threading.Lock()
    from damus.engine.cross import CrossStrategy
    r.strats = {"SOLUSDT": CrossStrategy(R.make_params("SOLUSDT"), 1000.0, 1.75)}
    r._save_state = lambda: None            # 파일 쓰기 생략
    return r


def make_pos(entry_time: pd.Timestamp) -> Position:
    return Position(side="LONG", kind="CONF", entry_time=entry_time, entry_price=100.0, qty=2.0, init_qty=2.0,
                    stop=95.0, tps=[("SOP", 104.0, 1.0), ("RETEST_UP", 108.0, 1.0)], reason_in="테스트 겹침 3개")


def main():
    ts = pd.Timestamp.now(tz=KST)

    print("\n[1] 진입 시 시장가 + 손절 + TP 지정가")
    r = build_runner(); s = r.strats["SOLUSDT"]
    pos = make_pos(ts); s.pos = pos
    res = type("Res", (), {"opened": pos, "closed": None, "fills": [], "label": ""})()
    r._apply("SOLUSDT", s, res, 100.0, False, ts)
    kinds = [o[0] for o in r.ex.orders]
    check("MARKET" in kinds, "시장가 진입 주문 전송")
    check("STOP" in kinds, "STOP_MARKET 손절 등록")
    check(kinds.count("TP") == 2, f"TP 지정가 2건 등록 (실제 {kinds.count('TP')})")
    check(abs(r.ex.pos_map["SOLUSDT"] - 2.0) < 1e-9, "거래소 포지션 2.0 반영")

    print("\n[2] 사용자가 거래소에서 전량 청산 → 수동 종료 인식")
    r.ex.pos_map["SOLUSDT"] = 0.0
    r.ex.income["SOLUSDT"] = 12.5
    r._reconcile_before("SOLUSDT", s, ts)
    check(s.pos is None, "봇 포지션 해제 (다시 진입 탐색 상태)")
    check(len(r.state["trades"]) == 1, "거래 1건 기록")
    if r.state["trades"]:
        t = r.state["trades"][0]
        check(abs(t["pnl"] - 12.5) < 1e-9, f"실현손익 income API 값 반영 ({t['pnl']})")
        check("EXCHANGE_CLOSED" in t["reason_out"], f"사유 = {t['reason_out']}")
    check("CANCEL" in [o[0] for o in r.ex.orders], "잔여 주문 취소")

    print("\n[3] 사용자가 절반 익절 → 수량 추종 + TP 비례 축소")
    r = build_runner(); s = r.strats["SOLUSDT"]
    s.pos = make_pos(ts)
    r.ex.pos_map["SOLUSDT"] = 1.0            # 2.0 → 1.0
    r._reconcile_before("SOLUSDT", s, ts)
    check(s.pos is not None and abs(s.pos.qty - 1.0) < 1e-9, "봇 수량 1.0 으로 축소")
    check(s.pos is not None and abs(sum(q for _, _, q in s.pos.tps) - 1.0) < 1e-9,
          f"TP 사다리 합 1.0 (실제 {sum(q for _, _, q in s.pos.tps) if s.pos else '-'})")

    print("\n[4] 48시간 경과 → 시장가 청산")
    r = build_runner(); s = r.strats["SOLUSDT"]
    old = ts - pd.Timedelta(hours=49)
    s.pos = make_pos(old)
    r.ex.pos_map["SOLUSDT"] = 2.0; r.ex.entry_map["SOLUSDT"] = 100.0
    ws = s.waves.update(ts, 80000, 80100, 79900, 80000, ts.normalize())
    ps = s.pattern.update(ts, 80000, 80100, 79900, 80000, ws)
    fills, done = s.risk.manage(s.pos, ts, 101, 102, 100, 101, ws, ps)
    check(done == "TIME", f"엔진이 시간만료 판정 (실제 {done})")
    if done == "TIME":
        s.pos.fills.extend(fills)          # 러너와 동일 순서: 체결 반영 후 청산 집계
        t = s.risk.close_trade(s.pos, ts, done, s.p.fee_rate)
        res = type("Res", (), {"opened": None, "closed": t, "fills": fills, "label": ""})()
        s.pos = None
        r._apply("SOLUSDT", s, res, 101.0, True, ts)
        closed = [o for o in r.ex.orders if o[0] == "MARKET" and o[5]]
        check(bool(closed), "reduceOnly 시장가 청산 주문 전송")
        check(abs(r.ex.pos_map["SOLUSDT"]) < 1e-9, "거래소 포지션 0")
        check(any("48h" in t2["reason_out"] for t2 in r.state["trades"]), "사유에 48h 시간만료 표기")

    print("\n[5] 봇이 모르는 외부 포지션 → 진입 보류")
    r = build_runner(); s = r.strats["SOLUSDT"]
    r.ex.pos_map["SOLUSDT"] = 5.0
    r._reconcile_before("SOLUSDT", s, ts)
    check("SOLUSDT" in r.state["external"], "외부 포지션으로 등록")
    n_before = len(r.ex.orders)
    check(n_before == 0, "외부 포지션에 주문을 보내지 않음")
    r.ex.pos_map["SOLUSDT"] = 0.0
    r._reconcile_before("SOLUSDT", s, ts)
    check("SOLUSDT" not in r.state["external"], "외부 포지션 종료 시 탐색 재개")

    print("\n" + ("=" * 46))
    if fails:
        print(f"{FAIL} 실패 {len(fails)}건:")
        for f in fails:
            print("   -", f)
        sys.exit(1)
    print(f"{OK} 반자동 로직 전체 통과")


if __name__ == "__main__":
    main()
