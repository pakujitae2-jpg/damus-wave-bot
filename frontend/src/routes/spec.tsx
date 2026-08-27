import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/spec')({ component: Spec })

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: '1. 시그널 차트 = BTCUSDT 3분봉 (다무스 파동)',
    items: [
      'Y 전일 파동(09:00~익일 09:00 KST 저~고, 고정) — 목표가 #1-1(+14.6%) … #1-6(+61.8%)',
      'T 오늘 파동(세션 누적 저~고) — 눌림/반등 38.2% 카운트, 첫 되돌림 극점 돌파 시 전환',
      'R 현재 파동(마지막 T 극점 이후 스윙) — 레드 라인 23.6% / 블루 라인 76.4%',
      '미해소 레벨 트래커: SOP(60분봉 시가=극값), 전일 고저 돌파 후 리테스트(14.6%), R 파동 레드/블루 미터치(9번)',
    ],
  },
  {
    title: '2. 진입 — 겹침(confluence)',
    items: [
      '현재가 ±4% 안에 미해소 레벨이 한쪽으로 3개 이상 몰리면 그 방향으로 진입 (R 라인 근접은 1개로 인정)',
      '세션당 방향별 1회, 포지션 보유 중 신규 진입 없음',
      'BTC 기준 목표(겹친 레벨) / 손절(5%) 의 %거리 × β1.75 를 알트 가격에 적용, 손절 상한 7%',
    ],
  },
  {
    title: '3. 체결 = SOL/ETH (10배 격리, 복리)',
    items: [
      '증거금 = 현재 잔고 × 20% → 명목 2배. 분할 진입 켜짐: 절반 먼저, 진입가 대비 1% 불리 시 나머지 절반',
      '손절: 시장가(STOP_MARKET 상당). 같은 봉에 손절·익절 동시 터치면 손절 우선. 강제청산가 = 진입가 ∓ 9.5%',
      '익절: 겹친 레벨별 균등 분할 LIMIT. 본절 이동 없음',
      'T 반대 전환 시 전량 청산. 최대 보유 48시간 후 시장가 청산',
      '수수료 0.04% taker, 슬리피지 0.02% 반영. 펀딩비 미반영',
    ],
  },
  {
    title: '4. 페이퍼 운용 (run_paper.py)',
    items: [
      '시드 $1,000 을 SOL/ETH 두 전략이 공유 → 복리. 주문 전송 없음, 잔고 조회 없음',
      'BTC·SOL·ETH 3분봉 REST 폴링(5초), 같은 시각 봉 3개가 모두 마감되면 처리',
      '상태 output/paper/state.json 매 봉 저장, 거래 trades.csv 추가. 재시작 시 잔고·거래 복원, 파동은 5일 워밍업',
      '검증 목표: 1~2개월 시그널 빈도(백테스트 월 ~17건/종목)·승률(~65%)·PF(1.2~1.3) 가 백테스트와 같은 범위인지',
    ],
  },
  {
    title: '5. 검증 이력 (SYSTEM_DESIGN.md)',
    items: [
      '장중 R 라인 매매: PF 0.65 → 겹침 저빈도: 1.36(BTC) → 1일 단타는 모든 변형 PF ≤ 1',
      '알트 자체 시그널 PF 0.8~1.0 → BTC 시그널 교차 β1.75: SOL 1.23 / ETH 1.26 / XRP 1.12 (전반·후반 모두 ≥1.04)',
      'Bot_v1(레인지 존 롱) 이식 검증: 수수료 포함 전 종목 PF < 1, 결합안 A/B 모두 개선 없음',
      '시드 50/70/90% 비중: 3종목 모두 MDD −77% 이상 → 20% 채택',
    ],
  },
]

function Spec() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">규칙</h1>
        <p className="mt-1 text-sm text-muted">코드 미러: damus/config.py (파라미터), engine/waves·pattern·tracker·signals·risk·cross.py</p>
      </div>
      {SECTIONS.map((sec) => (
        <section key={sec.title} className="rounded-md border border-surface p-4">
          <h2 className="mb-2 text-sm font-medium text-accent">{sec.title}</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg/90">
            {sec.items.map((it) => <li key={it}>{it}</li>)}
          </ul>
        </section>
      ))}
    </div>
  )
}
