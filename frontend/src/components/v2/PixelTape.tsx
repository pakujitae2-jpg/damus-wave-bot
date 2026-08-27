import { useEffect, useRef, useState } from 'react'
import type { Trade } from '#/lib/useMarketHub'

/* ============================================================
   PIXEL TAPE — 체결 테이프를 셀 격자로. 한 칸이 체결 1건.
     초록 = 매수 체결(테이커 BUY), 빨강 = 매도 체결. 밝기 = 체결 수량.
     오른쪽에 BUY/SELL 건수와 CVD(누적 거래량 델타)를 붙인다.
   ============================================================ */

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [s, setS] = useState({ w: 300, h: 190 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      if (r.width > 1 && r.height > 1) setS({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return s
}

const nf = (v: number, d = 2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

export interface TapeStats { buy: number; sell: number; cvd: number; topPrint: number; upin: number }

export function tapeStats(trades: Trade[]): TapeStats {
  let buy = 0, sell = 0, bq = 0, sq = 0, top = 0
  for (const t of trades) {
    if (t.buy) { buy++; bq += t.q } else { sell++; sq += t.q }
    const notional = t.p * t.q
    if (notional > top) top = notional
  }
  const tot = bq + sq
  return { buy, sell, cvd: bq - sq, topPrint: top, upin: tot > 0 ? bq / tot : 0 }
}

export function PixelTape({ trades, tick }: { trades: Trade[]; tick: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const { w: W, h: H } = useSize(wrapRef)

  useEffect(() => {
    const cv = cvRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = W * dpr
    cv.height = H * dpr
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const g = (k: string) => getComputedStyle(wrap).getPropertyValue(k).trim() || '#888'
    ctx.fillStyle = g('--panel')
    ctx.fillRect(0, 0, W, H)
    if (trades.length === 0) return

    // 셀 크기: 대략 정사각형이 되도록 열 수를 잡는다
    const cell = 11
    const cols = Math.max(4, Math.floor(W / cell))
    const rows = Math.max(3, Math.floor(H / cell))
    const cap = cols * rows
    const list = trades.slice(Math.max(0, trades.length - cap))
    let maxQ = 0
    for (const t of list) if (t.q > maxQ) maxQ = t.q
    if (maxQ <= 0) maxQ = 1

    const cw = W / cols
    const ch = H / rows
    list.forEach((t, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      const inten = Math.min(1, Math.sqrt(t.q / maxQ))
      const hue = t.buy ? 150 : 348
      ctx.fillStyle = `hsla(${hue}, 92%, ${20 + inten * 46}%, ${0.35 + inten * 0.6})`
      ctx.fillRect(c * cw + 0.5, r * ch + 0.5, cw - 1, ch - 1)
    })
  }, [tick, W, H, trades])

  return (
    <div className="chartbox" ref={wrapRef}>
      <canvas ref={cvRef} style={{ width: W, height: H }} />
    </div>
  )
}

/** 테이프 통계 사이드 패널 */
export function TapeStatsBox({ s }: { s: TapeStats }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '4px 6px', minWidth: 86 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
        <span className="c-up">■ BUY</span><b className="num c-up">{s.buy}</b>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
        <span className="c-dn">■ SELL</span><b className="num c-dn">{s.sell}</b>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, borderTop: '1px solid var(--line2)', paddingTop: 3 }}>
        <span className="c-ink3">Δ CVD</span>
        <b className={`num ${s.cvd >= 0 ? 'c-up' : 'c-dn'}`}>{s.cvd >= 0 ? '+' : '−'}{nf(Math.abs(s.cvd), 2)}</b>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5 }}>
        <span className="c-ink3">TOP</span><b className="num">${nf(s.topPrint / 1000, 1)}K</b>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5 }}>
        <span className="c-ink3">UPIN</span><b className="num c-cyan">{(s.upin * 100).toFixed(0)}%</b>
      </div>
      <div style={{ height: 6, border: '1px solid var(--line)', borderRadius: 2, overflow: 'hidden', marginTop: 2, display: 'flex' }}>
        <div style={{ width: `${s.upin * 100}%`, background: 'var(--up)' }} />
        <div style={{ flex: 1, background: 'var(--dn)' }} />
      </div>
    </div>
  )
}
