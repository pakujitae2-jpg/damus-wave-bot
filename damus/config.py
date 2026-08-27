"""전략/시스템 파라미터. 백테스트로 튜닝하는 값은 STRATEGY 에 모아둔다."""
from dataclasses import dataclass, field
from datetime import timedelta, timezone

KST = timezone(timedelta(hours=9))

# 피보나치 비율 (양방향)
FIB = {
    "l14": 0.146,
    "l23": 0.236,
    "l38": 0.382,
    "l50": 0.500,
    "l61": 0.618,
    "l76": 0.764,
    "l85": 0.854,
}
# Y 파동 확장 목표 (#n-k) 비율: k -> ratio
EXT = {1: 0.146, 2: 0.236, 3: 0.382, 6: 0.618}

SESSION_OPEN_HOUR_KST = 9  # 하루 = 09:00 ~ 익일 09:00


@dataclass
class StrategyParams:
    symbol: str = "BTCUSDT"           # 체결 심볼
    signal_symbol: str = ""           # 교차 모드: 시그널 심볼 (예: BTCUSDT). 비우면 symbol 자체 시그널
    cross_beta: float = 1.75          # 교차 모드: BTC 기준 목표/손절 %거리 배율
    timeframe: str = "3m"

    # --- Wave ---
    # R 파동 최소 크기: 전일(Y) range 대비 비율. 이보다 작으면 '진행형'으로 무시
    r_min_ratio_of_y: float = 0.15
    # T 파동 최소 크기 (Y range 대비). 이보다 작으면 패턴 카운트 보류
    t_min_ratio_of_y: float = 0.25
    # 되돌림(38.2) 판정 기준: 'touch'(고/저가) 또는 'close'(종가)
    retrace_basis: str = "close"

    # --- Signal ---
    # 진입 방식: 'touch' | 'retest' | 'confluence'(미해소 레벨 3개 이상 겹침, 저빈도)
    entry_mode: str = "confluence"
    # --- confluence ---
    conf_min_reasons: int = 3          # 진입에 필요한 미해소 레벨 수
    conf_band_pct: float = 0.04        # 현재가 기준 이 범위 안의 레벨만 '이유'로 인정
    conf_require_y_break: bool = False  # 전일 저가 이탈(롱)/고가 돌파(숏) 후에만
    conf_sl_pct: float = 0.05          # 넓은 손절
    conf_risk: float = 0.005           # 소량 (계좌 0.5%)
    intraday_only: bool = False        # True 면 세션 종료(08:57) 전 청산
    # --- 보유 모드 ---
    hold_mode: str = "swing"           # 'day' = 1일 단타(세션 종료 청산) | 'swing' = 1~2일 보유(시간 손절)
    max_hold_hours: float = 48.0
    rev_exit: bool = True              # T 반대 전환 시 자동 청산 (반자동 모드에서는 False 권장)       # swing: 이 시간 지나면 시장가 청산 (0 = 무제한)
    day_entry_cutoff_hour: int = 5     # day: KST 이 시각(05:00) 이후 신규 진입 금지 (세션 종료 4h 전)
    # --- 분할 진입 (영상: 1개 잡고 더 빠지면 1개 더) ---
    scale_in: bool = True
    scale_in_adverse_pct: float = 0.01 # 진입가 대비 이만큼 불리하게 가면 동일 수량 1회 추가
    conf_use_r_line: bool = True       # R 레드/블루 라인 근접도 이유 1개로 인정
    # --- V1 존 필터 (결합안 A) ---
    v1_zone_filter: bool = False       # True: T 파동 38.2 반등 선행 + 가격이 존 안일 때만 겹침 진입 허용
    v1_zone_r: float = 0.236           # 존 상단 (롱: T.pos <= r, 숏: >= 1-r)
    v1_need_bounce: bool = True        # 38.2 반등(눌림) 선행 요구
    # 레드/블루 라인 근접 허용 오차 (R range 대비 비율)
    line_tolerance: float = 0.06
    # 두 번째 되돌림 처리: 'skip' | 'half'
    second_retrace_mode: str = "half"
    # V자 손절 후 쿨다운 (봉 수)
    v_cooldown_bars: int = 10
    # 전환 신호로 진입 허용
    allow_reversal_entry: bool = True
    # 역매매(#1-6 도달 후 소량) 허용
    allow_counter_trade: bool = False

    # --- Risk ---
    risk_per_trade: float = 0.01        # 계좌 대비 1회 손실 허용 (sizing_mode='risk')
    leverage: int = 10
    # 사이징: 'risk' = 손절폭 기준 리스크% | 'margin' = 현재 시드의 margin_fraction 을 증거금으로 (명목 = 증거금×레버리지)
    sizing_mode: str = "margin"
    margin_fraction: float = 0.5
    maint_margin: float = 0.005         # 유지증거금률 → 격리 청산가 = 진입가×(1 ∓ (1/lev − mm))
    fee_rate: float = 0.0004            # taker
    slippage: float = 0.0002
    # 분할 익절 비율 (R끝, T고/저, Y#1-1, Y#1-2, Y#1-3, 나머지 추적)
    tp_fractions: tuple = (0.3, 0.2, 0.2, 0.15, 0.15)
    # 손절 버퍼: R 저가/고가 밖으로 R range 대비 추가 여유
    sl_buffer_ratio: float = 0.2
    # 몇 번째 익절 후 본절 이동 (1=첫 익절 후, 0=이동 안 함)
    be_after_tp: int = 0
    # 손절 폭 최소/최대 (진입가 대비)
    min_sl_pct: float = 0.002
    max_sl_pct: float = 0.02


@dataclass
class ExecParams:
    api_key: str = ""
    api_secret: str = ""
    testnet: bool = True
    paper: bool = True          # True 면 주문 전송 없이 로그만
    initial_balance: float = 10_000.0


def load_exec_params() -> ExecParams:
    import os
    from dotenv import load_dotenv
    load_dotenv()
    return ExecParams(
        api_key=os.getenv("BINANCE_API_KEY", ""),
        api_secret=os.getenv("BINANCE_API_SECRET", ""),
        testnet=os.getenv("BINANCE_TESTNET", "true").lower() == "true",
        paper=os.getenv("PAPER", "true").lower() == "true",
        initial_balance=float(os.getenv("INITIAL_BALANCE", "10000")),
    )
