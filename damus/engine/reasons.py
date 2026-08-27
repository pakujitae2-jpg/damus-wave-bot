"""봉별 다무스 미해소 레벨 수 (n_long: 현재가 위 밴드 내 레벨 수, n_short: 아래). 결합안 B 용."""
import numpy as np
import pandas as pd
from damus.config import StrategyParams
from damus.engine.tracker import LevelTracker
from damus.engine.waves import WaveEngine


def compute_reasons(df: pd.DataFrame, params: StrategyParams) -> pd.DataFrame:
    we = WaveEngine(params); tr = LevelTracker()
    band = params.conf_band_pct
    out = np.zeros((len(df), 2), dtype=np.int16)
    for i, (ts, r) in enumerate(df.iterrows()):
        ws = we.update(ts, r.open, r.high, r.low, r.close, r.session)
        tr.update(ts, r.open, r.high, r.low, r.close, ws)
        c = r.close; b = c * band
        na = ns = 0
        for lv in tr.levels:
            if lv.resolved is None:
                if c < lv.price <= c + b: na += 1
                elif c - b <= lv.price < c: ns += 1
        out[i] = (na, ns)
    return pd.DataFrame(out, index=df.index, columns=["n_long", "n_short"])
