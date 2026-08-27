import { useEffect, useRef, useState } from 'react'
import type { DepthSnap } from '#/lib/useMarketHub'

/* ============================================================
   BOOK MEMBRANE — 호가 압력장 (능선도 / joyplot)
     가로축 = 호가 가격대(실제 호가창 범위에 맞춰 정규화)
     세로축 = 시간 (뒤·위 = 과거, 앞·아래 = 현재)
     능선 높이 = 그 가격의 잔량. 매수는 초록, 매도는 빨강.
   ============================================================ */

const LINES = 30        // 겹쳐 그릴 능선 수
const PADX = 5
const PADY = 4
const SHEAR = 0.12      // 원근감을 위한 가로 밀림 비율

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [s, setS] = useState({ w: 400, h: 180 })
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

const nf = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })

export function BookMembrane({
  depthRef, tick,
}: {
  depthRef: React.MutableRefObject<DepthSnap[]>
  tick: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const { w: W, h: H } = useSize(wrapRef)

  useEffect(() => {
    const cv = cvRef.current
    const wrap = wrapRef.current
    const all = depthRef.current
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
    if (all.length < 3) {
      ctx.fillStyle = g('--ink3')
      ctx.font = '10px "Space Mono", monospace'
      ctx.fillText('호가 수집 중…', 8, 18)
      return
    }

    // 최근 LINES 개 (오래된 것 → 최신 순)
    const step = Math.max(1, Math.floor(all.length / LINES))
    const snaps: DepthSnap[] = []
    for (let i = all.length - 1; i >= 0 && snaps.length < LINES; i -= step) snaps.unshift(all[i])
    const n = snaps.length
    if (n < 2) return

    // ── 가격축: 실제 호가창이 덮는 범위를 쓴다 (고정 % 로 나누면 가운데로 뭉친다) ──
    let pmin = Infinity, pmax = -Infinity, maxQ = 0
    for (const s of snaps) {
      for (const b of s.bids) { if (b.p < pmin) pmin = b.p; if (b.p > pmax) pmax = b.p; if (b.q > maxQ) maxQ = b.q }
      for (const a of s.asks) { if (a.p < pmin) pmin = a.p; if (a.p > pmax) pmax = a.p; if (a.q > maxQ) maxQ = a.q }
    }
    if (!isFinite(pmin) || pmax <= pmin || maxQ <= 0) return
    const span = pmax - pmin
    pmin -= span * 0.02
    pmax += span * 0.02

    const plotW = W - PADX * 2
    const plotH = H - PADY * 2
    const shear = plotW * SHEAR
    const amp = plotH * 0.40          // 능선 최대 높이
    const laneW = plotW - shear       // 능선 한 줄이 쓰는 가로 폭

    const Xof = (p: number, t: number) =>
      PADX + (1 - t) * shear + ((p - pmin) / (pmax - pmin)) * laneW
    // t=0(과거)은 위, t=1(현재)은 아래. 능선은 baseline 에서 위로 솟는다.
    const baseYof = (t: number) => PADY + amp + (plotH - amp) * t

    // 중간가 궤적 (뒤→앞)
    ctx.strokeStyle = g('--ink3')
    ctx.setLineDash([2, 4])
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 1
    ctx.beginPath()
    snaps.forEach((s, i) => {
      const t = i / (n - 1)
      const x = Xof(s.mid, t), y = baseYof(t)
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1

    // ── 능선: 오래된 것부터 그려서 최신이 위로 덮이게 ──
    snaps.forEach((s, i) => {
      const t = i / (n - 1)
      const baseY = baseYof(t)
      const alpha = 0.20 + t * 0.75
      const light = 38 + t * 22
      const front = i === n - 1

      for (const side of ['bid', 'ask'] as const) {
        const rows = (side === 'bid' ? s.bids : s.asks).slice().sort((a, b) => a.p - b.p)
        if (rows.length < 2) continue
        const hue = side === 'bid' ? 150 : 348

        // 채움 (막)
        ctx.beginPath()
        ctx.moveTo(Xof(rows[0].p, t), baseY)
        for (const r of rows) ctx.lineTo(Xof(r.p, t), baseY - (r.q / maxQ) * amp)
        ctx.lineTo(Xof(rows[rows.length - 1].p, t), baseY)
        ctx.closePath()
        ctx.fillStyle = `hsla(${hue}, 88%, ${light}%, ${alpha * (front ? 0.34 : 0.16)})`
        ctx.fill()

        // 능선
        ctx.beginPath()
        rows.forEach((r, k) => {
          const x = Xof(r.p, t), y = baseY - (r.q / maxQ) * amp
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        })
        ctx.strokeStyle = `hsla(${hue}, 92%, ${light}%, ${alpha})`
        ctx.lineWidth = front ? 1.8 : 1
        ctx.stroke()
      }
    })

    // ── 가격 눈금 (최신 능선 기준) ──
    ctx.font = '8.5px "Space Mono", monospace'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = g('--ink3')
    ctx.textAlign = 'left'
    ctx.fillText(nf(pmin), PADX + 1, H - 2)
    ctx.textAlign = 'right'
    ctx.fillText(nf(pmax), W - PADX - 1, H - 2)
    const last = snaps[n - 1]
    ctx.textAlign = 'center'
    ctx.fillStyle = g('--gold')
    ctx.fillText(nf(last.mid), Xof(last.mid, 1), H - 2)
  }, [tick, W, H, depthRef])

  return (
    <div className="chartbox" ref={wrapRef}>
      <canvas ref={cvRef} style={{ width: W, height: H }} />
      <div className="legend">
        <span><i className="c-up">▲</i> 매수벽</span>
        <span><i className="c-dn">▲</i> 매도벽</span>
        <span className="c-ink3">위=과거 · 아래=현재</span>
      </div>
    </div>
  )
}
