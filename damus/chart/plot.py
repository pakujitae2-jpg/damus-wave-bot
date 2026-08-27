"""Plotly 차트: 캔들 + Y/T/R 오버레이 + 시그널/트레이드 마커."""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import plotly.graph_objects as go

OUT = Path(__file__).resolve().parents[2] / "output"


def plot_session(w: pd.DataFrame, session: pd.Timestamp | str, trades: pd.DataFrame | None = None,
                 signals: pd.DataFrame | None = None, title: str = "", show_prev: bool = True) -> Path:
    session = pd.Timestamp(session).tz_localize("Asia/Seoul") if pd.Timestamp(session).tz is None else pd.Timestamp(session)
    d = w[w.session == session]
    if show_prev:
        prev = w[w.session < session]
        if len(prev):
            d = pd.concat([prev[prev.session == prev.session.iloc[-1]], d])
    fig = go.Figure()
    fig.add_trace(go.Candlestick(x=d.index, open=d.open, high=d.high, low=d.low, close=d.close,
                                 name="3m", increasing_line_color="#e74c3c", decreasing_line_color="#3498db"))

    def line(col, color, name, width=1, dash=None):
        if col in d and d[col].notna().any():
            fig.add_trace(go.Scatter(x=d.index, y=d[col], mode="lines", name=name,
                                     line=dict(color=color, width=width, dash=dash), connectgaps=False))

    # Y (전일) — 고정 수평선
    line("y_high", "#f39c12", "Y 고가", 1.5)
    line("y_low", "#f39c12", "Y 저가", 1.5)
    line("y_blue", "#2980b9", "Y 76.4", 1, "dot")
    line("y_red", "#c0392b", "Y 23.6", 1, "dot")
    line("y_1_1_up", "#f39c12", "Y #1-1↑", 1, "dash")
    line("y_1_1_dn", "#f39c12", "Y #1-1↓", 1, "dash")
    # T (오늘)
    line("t_high", "#8e44ad", "T 고가", 1.5)
    line("t_low", "#8e44ad", "T 저가", 1.5)
    line("t_76", "#2980b9", "T 76.4", 1)
    line("t_61", "#e67e22", "T 61.8", 1, "dot")
    line("t_50", "#27ae60", "T 50", 1, "dot")
    line("t_38", "#e67e22", "T 38.2", 1, "dot")
    line("t_23", "#c0392b", "T 23.6", 1)
    # R (현재)
    line("r_high", "#7f8c8d", "R 100", 1)
    line("r_low", "#7f8c8d", "R 0", 1)
    line("r_blue", "#00bfff", "R 블루", 2)
    line("r_red", "#ff1744", "R 레드", 2)
    line("r_38", "#95a5a6", "R 38.2", 1, "dot")
    line("r_61", "#95a5a6", "R 61.8", 1, "dot")

    if signals is not None and len(signals):
        sg = signals[(signals.index >= d.index[0]) & (signals.index <= d.index[-1])]
        for side, sym, col in (("LONG", "triangle-up", "#ff1744"), ("SHORT", "triangle-down", "#00bfff")):
            x = sg[sg.side == side]
            if len(x):
                fig.add_trace(go.Scatter(x=x.index, y=x.price, mode="markers", name=f"sig {side}",
                                         marker=dict(symbol=sym, size=12, color=col, line=dict(width=1, color="black")),
                                         text=x.reason, hoverinfo="text+y"))
    if trades is not None and len(trades):
        tr = trades[(trades.entry_time >= d.index[0]) & (trades.entry_time <= d.index[-1])]
        for _, t in tr.iterrows():
            color = "#2ecc71" if t.pnl > 0 else "#e74c3c"
            fig.add_trace(go.Scatter(x=[t.entry_time, t.exit_time], y=[t.entry_price, t.exit_price],
                                     mode="lines+markers", line=dict(color=color, width=2),
                                     name=f"{t.side} {t.pnl:+.1f}", showlegend=False,
                                     hovertext=f"{t.side} {t.reason_in} → {t.reason_out} pnl={t.pnl:+.2f}"))
    fig.update_layout(title=title or f"{session.date()} 세션", xaxis_rangeslider_visible=False,
                      height=800, template="plotly_dark", legend=dict(orientation="h"))
    OUT.mkdir(exist_ok=True)
    path = OUT / f"chart_{session.date()}.html"
    fig.write_html(path)
    return path
