"""바이낸스 USDT-M 선물 캔들 데이터 (REST 히스토리 + 파케 캐시 + WS 실시간)."""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Iterator

import pandas as pd
import requests

from damus.config import KST, SESSION_OPEN_HOUR_KST

FAPI = "https://fapi.binance.com"
FAPI_TEST = "https://testnet.binancefuture.com"
WS = "wss://fstream.binance.com/ws"

COLS = ["open_time", "open", "high", "low", "close", "volume", "close_time",
        "qav", "trades", "tbav", "tbqav", "ignore"]

CACHE_DIR = Path(__file__).resolve().parents[2] / "data_cache"


def _to_df(rows: list) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=COLS)
    df = df[["open_time", "open", "high", "low", "close", "volume"]].astype(
        {"open": float, "high": float, "low": float, "close": float, "volume": float})
    df["ts"] = pd.to_datetime(df["open_time"], unit="ms", utc=True).dt.tz_convert(KST)
    df = df.drop(columns="open_time").set_index("ts")
    return df


def fetch_klines(symbol: str, interval: str, start: datetime, end: datetime | None = None,
                 base: str = FAPI) -> pd.DataFrame:
    """[start, end) 구간 캔들 전부 페이징으로 수집."""
    end = end or datetime.now(KST)
    start_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)
    out = []
    while start_ms < end_ms:
        r = requests.get(f"{base}/fapi/v1/klines", params={
            "symbol": symbol, "interval": interval, "startTime": start_ms,
            "endTime": end_ms, "limit": 1500}, timeout=15)
        r.raise_for_status()
        rows = r.json()
        if not rows:
            break
        out.extend(rows)
        start_ms = rows[-1][0] + 1
        if len(rows) < 1500:
            break
        time.sleep(0.15)
    if not out:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    df = _to_df(out)
    return df[~df.index.duplicated(keep="last")]


def load_klines(symbol: str, interval: str, days: int, refresh: bool = False) -> pd.DataFrame:
    """캐시 우선 로드. 캐시가 있으면 마지막 시점 이후만 증분 수집."""
    CACHE_DIR.mkdir(exist_ok=True)
    path = CACHE_DIR / f"{symbol}_{interval}.parquet"
    start = datetime.now(KST) - timedelta(days=days)
    df = pd.DataFrame()
    if path.exists() and not refresh:
        df = pd.read_parquet(path)
        if df.index.tz is None:
            df.index = df.index.tz_localize("UTC").tz_convert(KST)
        last = df.index[-1]
        new = fetch_klines(symbol, interval, last.to_pydatetime())
        parts = [df, new]
        first = df.index[0]
        if first > pd.Timestamp(start) + pd.Timedelta(hours=1):
            parts.insert(0, fetch_klines(symbol, interval, start, first.to_pydatetime()))
        df = pd.concat(parts)
        df = df[~df.index.duplicated(keep="last")].sort_index()
    else:
        df = fetch_klines(symbol, interval, start)
    df.to_parquet(path)
    return df[df.index >= start]


def session_date(ts: pd.Timestamp) -> pd.Timestamp:
    """09:00 KST 기준 세션 날짜 (그 세션이 시작한 날)."""
    t = ts.tz_convert(KST)
    if t.hour < SESSION_OPEN_HOUR_KST:
        t = t - pd.Timedelta(days=1)
    return t.normalize()


def add_session(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["session"] = [session_date(t) for t in df.index]
    return df


def stream_klines(symbol: str, interval: str, on_bar: Callable[[dict], None]) -> None:
    """WS 실시간 캔들. on_bar(dict) — dict 에 'closed' 플래그 포함."""
    import websocket  # websocket-client

    url = f"{WS}/{symbol.lower()}@kline_{interval}"

    def _on_message(_, msg):
        k = json.loads(msg)["k"]
        on_bar({
            "ts": pd.Timestamp(k["t"], unit="ms", tz="UTC").tz_convert(KST),
            "open": float(k["o"]), "high": float(k["h"]), "low": float(k["l"]),
            "close": float(k["c"]), "volume": float(k["v"]), "closed": bool(k["x"]),
        })

    while True:
        ws = websocket.WebSocketApp(url, on_message=_on_message)
        ws.run_forever(ping_interval=60)
        time.sleep(3)  # reconnect


def poll_klines(symbol: str, interval: str, on_bar: Callable[[dict], None],
                poll_sec: float = 5.0, base: str = FAPI) -> None:
    """REST 폴링 피드: 마감된 봉이 새로 생길 때마다 on_bar(closed=True). WS 가 막힌 환경용."""
    last_open = None
    while True:
        try:
            r = requests.get(f"{base}/fapi/v1/klines", params={
                "symbol": symbol, "interval": interval, "limit": 3}, timeout=10)
            r.raise_for_status()
            rows = r.json()
            # rows[-1] 은 진행 중 봉, rows[-2] 는 마지막 마감 봉
            for k in rows[:-1]:
                if last_open is None or k[0] > last_open:
                    last_open = k[0]
                    on_bar({
                        "ts": pd.Timestamp(k[0], unit="ms", tz="UTC").tz_convert(KST),
                        "open": float(k[1]), "high": float(k[2]), "low": float(k[3]),
                        "close": float(k[4]), "volume": float(k[5]), "closed": True,
                    })
        except Exception as ex:  # 네트워크 오류는 로그 후 재시도
            print("poll error:", ex)
        time.sleep(poll_sec)
