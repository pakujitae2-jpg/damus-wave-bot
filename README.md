# 다무스 파동 매매봇 (바이낸스 USDT-M 선물)

전략 설명: `SYSTEM_DESIGN.md`

## 구조
```
damus/
  config.py            StrategyParams(튜닝 파라미터) / ExecParams(.env)
  data/binance.py      REST 히스토리(+parquet 캐시) / WS 스트림 / 09:00 세션
  engine/waves.py      Y·T·R 파동 엔진 (봉 단위 증분)
  engine/pattern.py    T 파동 상태머신: 눌림/반등 카운트, 전환, V자
  engine/signals.py    진입 시그널 (N자 레드/블루 라인, 전환)
  engine/risk.py       사이징, 손절, 익절 사다리(R→T→Y→#1-x), 본절, T 반대전환 청산
  engine/tracker.py    9번(숙제) / SOP / 리테스트 레벨 기록
  engine/strategy.py   위 엔진을 묶는 러너 (백테스트·실시간 공용)
  backtest/            백테스터 + 리포트
  chart/plot.py        Plotly 차트 (Y/T/R 오버레이 + 트레이드)
  exec/                바이낸스 주문 실행기 + 실시간 러너
run_backtest.py        python run_backtest.py 180 --chart 2026-08-26
tune.py                python tune.py 180 60   (IS/OOS 그리드 탐색 → output/tune_*.csv)
run_live.py            python run_live.py       (.env: PAPER / BINANCE_TESTNET)
```

## 실행
```
pip install pandas numpy requests websocket-client plotly pyarrow python-dotenv
python run_backtest.py 60 --chart 2026-08-26     # output/chart_*.html, trades.csv
python tune.py 180 60
cp .env.example .env                              # 키 입력 후
python run_live.py                                # PAPER=true 면 로그만
```

## 단계별 안전장치
1. `PAPER=true` (기본) — 주문 없음, 로그만
2. `PAPER=false BINANCE_TESTNET=true` — 테스트넷 실제 주문
3. `PAPER=false BINANCE_TESTNET=false` — 실계좌 (실행 시 'LIVE' 입력 확인)

## 현재 전략 (2026-08-27)
- 진입: `confluence` — 미해소 레벨(SOP·전일고저 리테스트·R 9번) 3개 이상 겹침, 리스크 0.5%, 1% 불리 시 1회 분할 추가
- 보유: `swing` 최대 48h, 본절 이동 없음, 목표 = 겹친 레벨 분할 익절, 손절 5%
- 1년 백테스트: PF 1.36, +7.0%, MDD −2.4%, 월 18건 (`python compare_modes.py 365` 로 재현, 결과 `output/compare_modes.csv`)
- 1일 단타(`hold_mode="day"`)는 구현되어 있으나 모든 변형에서 PF ≤ 1 → 비권장

## 레버리지·종목 검증 (2026-08-27)
- `compare_margin.py`: 10배 고정, 시드 50/70/90% 증거금, SOL/ETH/XRP/BTC × DAY/SWING48 → `output/compare_margin.csv`
- 결과: 알트 3종 −80~−99% (시그널 PF 0.8~1.0 로 에지 없음), BTC SWING48 만 +170~224% 이나 MDD −48~−76%
- 상세·해석: `SYSTEM_DESIGN.md` 6장

## Bot_v1 엔진 이식·결합안 (2026-08-27)
- `damus/engine/v1_engine.py`: Kstudy101/Bot_v1 `simulate.ts` 1:1 이식 (+수수료/숏미러/시드비중 옵션)
- `python run_v1.py validate` — SOL 3년 골든 대조 (세션·게이트·무매매 정확 일치, 체결 ±6건)
- `python run_v1.py compare 365|1100` — 4종목 × 10배 × 시드50/70/90% × 수수료 on/off × 롱/롱+숏 → `output/v1_compare_*.csv`
- 결과: 수수료 포함 시 전 종목 PF < 1, 상세 `SYSTEM_DESIGN.md` 7장
- `python run_combo.py 365` — 결합안 A(겹침+V1존 필터) / B(V1진입+겹침 필터): 둘 다 개선 없음, `SYSTEM_DESIGN.md` 8장

## 교차 방식 (2026-08-27) — 현재 권장
- `damus/engine/cross.py`: 시그널 BTC / 체결 알트, β=1.75, 손절 상한 7%, 보유형 48h
- 1년 PF: SOL 1.23 / ETH 1.26 / XRP 1.12 (전반·후반 모두 ≥1.04). 10배 증거금 10~20% 에서 SOL +44~77%, ETH +42~79% (MDD −19~−41%)
- 시드 50/70/90% 비중은 MDD −77% 이상 → 비권장. 1일 단타는 교차에서도 PF ≤ 1.05
- 라이브: `.env` 에 `SYMBOL=SOLUSDT SIGNAL_SYMBOL=BTCUSDT` 설정 후 `python run_live.py` (PAPER=true 기본)
- 재현: `python run_cross.py 365`, `run_cross2.py 365`, `run_cross3.py 365`, 상세 `SYSTEM_DESIGN.md` 9장

## 페이퍼 가동 · 제어실 (2026-08-27)
- `python run_paper.py` — SOL·ETH 교차 보유형 페이퍼, 시드 $1,000 복리, 증거금 20%. 상태 `output/paper/state.json`
- `frontend/` — Bot_v1 스택(TanStack Start + React + Tailwind + recharts). `cd frontend && npm install && npm run dev` → http://localhost:3100
- `start_paper.bat` — 러너 + 제어실 재시작 (상태 복원)
- `python run_backtest3y.py` — 3년 복리 백테스트 → `frontend/src/data/backtest.json`, `output/backtest3y/`
- `python run_yearly.py` — 연도별 시그널 품질. **3년 결과: SOL −84% / ETH −73%, 에지는 2025H2 이후에만** (`SYSTEM_DESIGN.md` 10장)

## 반자동 라이브 (2026-08-28) — 현재 구성
- `run_live_semi.py` — 진입/손절/TP 자동, 익절 수동, 48h 시장가, 거래소 포지션 대조, 대시보드 명령. paper/testnet/LIVE 공통
- `start_live.bat` — 러너 + 대시보드 재시작. 모드는 `.env` (`PAPER`, `BINANCE_TESTNET`, `LIVE_CONFIRM=YES`)
- 대시보드 http://localhost:3100 — 홈: 한눈 현황(청산/일시정지 버튼), /live 상세
- 상세·전환 절차: `SYSTEM_DESIGN.md` 11장
- `python test_semi.py` — 반자동 로직 자체 검증(가짜 거래소, 15개 항목)
