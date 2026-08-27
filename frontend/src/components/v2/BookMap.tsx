import { useEffect, useRef, useState } from 'react'
import type { DepthSnap, Trade } from '#/lib/useMarketHub'

/* ============================================================
   BOOKMAP — 시간축 호가 히트맵 + 체결 프린트
     x = 시간(뎁스 스냅샷), y = 가격, 밝기 = 그 가격에 쌓인 잔량
     위에 체결가 라인과 체결 점(크기 = 수량)을 얹는다.
   ============================================================ */

const ROWS = 58
const PAD_R = 54

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [s, setS] = useState({ w: 400, h: 190 })
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

const nf = (v: number, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

export function BookMap({
  depthRef, trades, tick, price,
}: {
  depthRef: React.MutableRefObject<DepthSnap[]>
  trades: Trade[]
  tick: number
  price: number | null
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const { w: W, h: H } = useSize(wrapRef)

  useEffect(() => {
    const cv = cvRef.current
    const wrap = wrapRef.current
    const snaps = depthRef.current
    if (!cv || !wrap || snaps.length < 2) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = W * dpr
    cv.height = H * dpr
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const g = (k: string) => getComputedStyle(wrap).getPropertyValue(k).trim() || '#888'
    const bg = g('--panel'), ink3 = g('--ink3'), inkc = g('--ink'), goldc = g('--gold')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // 가격 범위
    let mn = Infinity, mx = -Infinity
    for (const s of snaps) {
      for (const b of s.bids) { if (b.p < mn) mn = b.p; if (b.p > mx) mx = b.p }
      for (const a of s.asks) { if (a.p < mn) mn = a.p; if (a.p > mx) mx = a.p }
    }
    if (!isFinite(mn) || mx <= mn) return
    const pad = (mx - mn) * 0.03
    mn -= pad; mx += pad
    const plotW = W - PAD_R
    const rowH = H / ROWS
    const colW = plotW / snaps.length
    const rowOf = (p: number) => Math.floor(((mx - p) / (mx - mn)) * ROWS)
    const yOf = (p: number) => ((mx - p) / (mx - mn)) * H

    // 최대 잔량 (정규화용)
    let maxQ = 0
    const grid: Float32Array[] = snaps.map((s) => {
      const col = new Float32Array(ROWS * 2) // [0..ROWS)=bid, [ROWS..)=ask
      for (const b of s.bids) {
        const r = rowOf(b.p)
        if (r >= 0 && r < ROWS) { col[r] += b.q; if (col[r] > maxQ) maxQ = col[r] }
      }
      for (const a of s.asks) {
        const r = rowOf(a.p)
        if (r >= 0 && r < ROWS) { col[ROWS + r] += a.q; if (col[ROWS + r] > maxQ) maxQ = col[ROWS + r] }
      }
      return col
    })
    if (maxQ <= 0) return

    // 히트맵
    for (let c = 0; c < grid.length; c++) {
      const col = grid[c]
      const x = c * colW
      for (let r = 0; r < ROWS; r++) {
        const bq = col[r], aq = col[ROWS + r]
        const q = Math.max(bq, aq)
        if (q <= 0) continue
        const t = Math.min(1, Math.sqrt(q / maxQ))
        // 매수벽=청록~초록, 매도벽=자홍~빨강
        const hue = bq >= aq ? 165 - t * 45 : 335 + t * 20
        ctx.fillStyle = `hsla(${hue % 360}, 92%, ${18 + t * 42}%, ${0.25 + t * 0.72})`
        ctx.fillRect(x, r * rowH, Math.max(1, colW + 0.6), Math.max(1, rowH + 0.6))
      }
    }

    // 중간가 라인
    ctx.strokeStyle = inkc
    ctx.lineWidth = 1
    ctx.beginPath()
    snaps.forEach((s, i) => {
      const x = i * colW + colW / 2
      const yy = yOf(s.mid)
      if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy)
    })
    ctx.stroke()

    // 체결 프린트 (최근 것만, 시간축에 맞춰)
    const t0 = snaps[0].t, t1 = snaps[snaps.length - 1].t
    const span = Math.max(1, t1 - t0)
    let maxTq = 0
    for (const tr of trades) if (tr.q > maxTq) maxTq = tr.q
    for (const tr of trades) {
      if (tr.t < t0 || tr.p < mn || tr.p > mx) continue
      const x = ((tr.t - t0) / span) * plotW
      const rr = 1 + Math.sqrt(tr.q / Math.max(1e-9, maxTq)) * 3.4
      ctx.fillStyle = tr.buy ? 'rgba(40,255,150,0.85)' : 'rgba(255,80,110,0.85)'
      ctx.beginPath(); ctx.arc(x, yOf(tr.p), rr, 0, Math.PI * 2); ctx.fill()
    }

    // 우측 가격 눈금
    ctx.fillStyle = bg
    ctx.fillRect(plotW, 0, PAD_R, H)
    ctx.font = '9px "Space Mono", monospace'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    for (let i = 0; i <= 4; i++) {
      const v = mn + ((mx - mn) * i) / 4
      ctx.fillStyle = ink3
      ctx.fillText(nf(v, 0), plotW + 4, yOf(v))
    }
    if (price != null && price >= mn && price <= mx) {
      const yy = yOf(price)
      ctx.fillStyle = goldc
      ctx.fillRect(plotW, yy - 7, PAD_R, 14)
      ctx.fillStyle = '#000'
      ctx.font = 'bold 9px "Space Mono", monospace'
      ctx.fillText(nf(price, 0), plotW + 4, yy)
    }
  }, [tick, W, H, trades, price, depthRef])

  return (
    <div className="chartbox" ref={wrapRef}>
      <canvas ref={cvRef} style={{ width: W, height: H }} />
      <div className="legend">
        <span><i className="c-up">■</i> 매수벽</span>
        <span><i className="c-dn">■</i> 매도벽</span>
        <span><i className="c-ink3">━</i> 중간가</span>
        <span>● 체결</span>
      </div>
    </div>
  )
}
