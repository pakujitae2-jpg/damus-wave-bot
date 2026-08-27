import { Fragment } from 'react'
import { transitionMatrix, type Candle } from '#/lib/useMarketHub'

/* ============================================================
   TRANSITION MATRIX — 6-레짐 마르코프
     레짐 = (상승/하락) × (저·중·고 변동성). BTC 3분봉에서 직접 산출한다.
     행 = 현재 레짐, 열 = 다음 레짐 확률. 현재 레짐 행을 강조.
   ============================================================ */

const LABEL = ['U-L', 'U-M', 'U-H', 'D-L', 'D-M', 'D-H']
const cellBg = (v: number, up: boolean) =>
  v <= 0 ? 'var(--bg2)' : `hsla(${up ? 150 : 348}, 90%, ${16 + v * 40}%, ${0.2 + v * 0.75})`

export function TransMatrix({ candles }: { candles: Candle[] }) {
  const { m, cur } = transitionMatrix(candles)
  if (candles.length < 30) {
    return <div style={{ padding: 8, fontSize: 10, color: 'var(--ink3)' }}>봉 수집 중…</div>
  }
  // 현재 레짐에서 가장 확률 높은 다음 레짐
  const row = m[cur]
  const best = row.indexOf(Math.max(...row))

  return (
    <div style={{ padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: 4, height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `28px repeat(6, 1fr)`, gap: 2, flex: 1, minHeight: 0 }}>
        <div />
        {LABEL.map((l, j) => (
          <div key={`h${j}`} style={{ fontSize: 8, fontWeight: 700, color: 'var(--ink3)', textAlign: 'center' }}>{l}</div>
        ))}
        {LABEL.map((l, i) => (
          <Fragment key={`r${i}`}>
            <div style={{
              fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center',
              color: i === cur ? 'var(--gold)' : 'var(--ink3)',
            }}>{l}</div>
            {m[i].map((v, j) => (
              <div key={`c${i}${j}`} style={{
                background: cellBg(v, j < 3),
                border: i === cur && j === best ? '1px solid var(--gold)' : '1px solid transparent',
                borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8.5, fontWeight: 700, minHeight: 14,
                color: v > 0.35 ? '#fff' : 'var(--ink2)',
                opacity: i === cur ? 1 : 0.62,
              }}>{v > 0.005 ? (v * 100).toFixed(0) : '·'}</div>
            ))}
          </Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, borderTop: '1px solid var(--line2)', paddingTop: 3 }}>
        <span className="c-ink3">현재 레짐</span>
        <b className={cur < 3 ? 'c-up' : 'c-dn'}>{LABEL[cur]}</b>
        <span className="c-ink3">→ 최빈</span>
        <b className={best < 3 ? 'c-up' : 'c-dn'}>{LABEL[best]} {(row[best] * 100).toFixed(0)}%</b>
      </div>
      <div style={{ fontSize: 8, color: 'var(--ink3)' }}>U/D = 상승·하락 · L/M/H = 변동성 저·중·고</div>
    </div>
  )
}
