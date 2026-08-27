import { Fragment } from 'react'
import { correlation } from '#/lib/useMarketHub'

/* ============================================================
   CORRELATION MATRIX — 심볼 간 수익률 상관 (1초 샘플, 최근 5분)
   교차 전략이 "BTC 시그널로 알트를 매매"하는 근거를 실시간으로 보여준다.
   ============================================================ */

const cellColor = (v: number) => {
  // -1(파랑) ~ 0(회색) ~ +1(주황)
  const t = Math.abs(v)
  const hue = v >= 0 ? 30 : 210
  return `hsla(${hue}, 90%, ${16 + t * 42}%, ${0.25 + t * 0.7})`
}

export function CorrMatrix({
  histRef, symbols, tick,
}: {
  histRef: React.MutableRefObject<Record<string, number[]>>
  symbols: string[]
  tick: number
}) {
  void tick // 리렌더 트리거용
  const hist = histRef.current
  const ready = symbols.filter((s) => (hist[s]?.length ?? 0) > 10)
  const short = (s: string) => s.replace('USDT', '')

  if (ready.length < 2) {
    return <div style={{ padding: 8, fontSize: 10, color: 'var(--ink3)' }}>표본 수집 중… (약 15초)</div>
  }

  const m = ready.map((a) => ready.map((b) => (a === b ? 1 : correlation(hist[a], hist[b]))))
  // BTC 대비 평균 상관 (교차 전략 유효성 지표)
  const btcIdx = ready.indexOf('BTCUSDT')
  const avgToBtc = btcIdx >= 0
    ? m[btcIdx].filter((_, i) => i !== btcIdx).reduce((a, b) => a + b, 0) / Math.max(1, ready.length - 1)
    : 0

  return (
    <div style={{ padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: 5, height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `34px repeat(${ready.length}, 1fr)`, gap: 2, flex: 1, minHeight: 0 }}>
        <div />
        {ready.map((s) => (
          <div key={`h${s}`} style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--ink3)', textAlign: 'center', letterSpacing: .5 }}>
            {short(s)}
          </div>
        ))}
        {ready.map((a, i) => (
          <Fragment key={`row${a}`}>
            <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--ink3)', display: 'flex', alignItems: 'center' }}>
              {short(a)}
            </div>
            {ready.map((b, j) => (
              <div key={`c${a}${b}`}
                style={{
                  background: i === j ? 'var(--panel2)' : cellColor(m[i][j]),
                  borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9.5, fontWeight: 700, color: i === j ? 'var(--ink3)' : 'var(--ink)',
                  minHeight: 16,
                }}>
                {i === j ? '·' : m[i][j].toFixed(2)}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, borderTop: '1px solid var(--line2)', paddingTop: 3 }}>
        <span className="c-ink3">BTC 평균 상관</span>
        <b className={avgToBtc > 0.6 ? 'c-up' : avgToBtc > 0.3 ? 'c-gold' : 'c-dn'}>{avgToBtc.toFixed(3)}</b>
      </div>
      <div style={{ fontSize: 8.5, color: 'var(--ink3)' }}>
        {avgToBtc > 0.6 ? '동조 강함 — 교차 전략 유효 구간' : avgToBtc > 0.3 ? '동조 보통' : '탈동조 — 교차 시그널 주의'}
      </div>
    </div>
  )
}
