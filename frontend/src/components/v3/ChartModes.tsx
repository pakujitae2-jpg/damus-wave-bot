import { useEffect, useRef, useState } from 'react'
import type { Candle, Trade } from '#/lib/useMarketHub'

/* ============================================================
   차트 모드 — 같은 캔들·체결 데이터를 다른 방식으로 본다.
   각 차트는 FibChart 와 동일한 구조(자체 ref + ResizeObserver + 캔버스)로 독립 구현.
     VPVR    가격대별 거래량 프로파일 (POC / 밸류에어리어 70%)
     DELTA   델타 캔들 — 몸통을 매수−매도 체결 델타로 칠하고 하단에 델타 막대
     HEIKIN  하이킨아시 — 노이즈 제거형 캔들
     TPO     마켓 프로파일 — 가격대별 체류 분포
   ============================================================ */

export const CHART_MODES = ['FIB', 'VPVR', 'DELTA', 'HEIKIN', 'TPO'] as const
export type ChartMode = (typeof CHART_MODES)[number]

const PR = 60
const PT = 8
const PB = 16

const nf = (v: number, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const hhmm = (t: number) => {
  const d = new Date(t + 9 * 3600e3)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [s, setS] = useState({ w: 600, h: 260 })
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

interface Geo {
  W: number; H: number; plotW: number; plotH: number
  mn: number; mx: number
  y: (v: number) => number
  X: (i: number) => number
  cw: number; bw: number
  digits: number
  c: (k: string) => string
}

/** 축·그리드·현재가·시각축을 그리고 본문은 body 콜백에 맡긴다 (JSX 를 만들지 않는 순수 유틸) */
function paint(
  cv: HTMLCanvasElement,
  wrap: HTMLDivElement,
  W: number,
  H: number,
  candles: Candle[],
  price: number | null,
  cursor: { x: number; y: number } | null,
  body: (ctx: CanvasRenderingContext2D, ge: Geo) => void,
) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = W * dpr
  cv.height = H * dpr
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const c = (k: string) => getComputedStyle(wrap).getPropertyValue(k).trim() || '#888'
  ctx.fillStyle = c('--panel')
  ctx.fillRect(0, 0, W, H)
  if (candles.length < 2) {
    ctx.fillStyle = c('--ink3')
    ctx.font = '10px "Space Mono", monospace'
    ctx.fillText('봉 수집 중…', 8, 20)
    return
  }

  let mn = Math.min(...candles.map((k) => k.l))
  let mx = Math.max(...candles.map((k) => k.h))
  const pad = (mx - mn) * 0.06 || 1
  mn -= pad; mx += pad

  const plotW = W - PR
  const plotH = H - PT - PB
  const y = (v: number) => PT + ((mx - v) / (mx - mn)) * plotH
  const n = candles.length
  const cw = plotW / n
  const X = (i: number) => cw * i + cw / 2
  const bw = Math.max(1, Math.min(9, cw * 0.62))
  const digits = price && price >= 1000 ? 0 : price && price >= 1 ? 3 : 4
  const ge: Geo = { W, H, plotW, plotH, mn, mx, y, X, cw, bw, digits, c }

  // 그리드 + 우측 가격축
  ctx.strokeStyle = c('--line2')
  ctx.lineWidth = 1
  ctx.font = '9px "Space Mono", monospace'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  for (let i = 0; i <= 4; i++) {
    const v = mn + ((mx - mn) * i) / 4
    const yy = y(v)
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke()
    ctx.fillStyle = c('--ink3')
    ctx.fillText(nf(v, digits), plotW + 5, yy)
  }

  body(ctx, ge)

  // 현재가
  if (price != null) {
    const yp = y(price)
    ctx.save()
    ctx.strokeStyle = c('--gold'); ctx.lineWidth = 1.2; ctx.setLineDash([4, 3])
    ctx.beginPath(); ctx.moveTo(0, yp); ctx.lineTo(plotW, yp); ctx.stroke()
    ctx.restore()
    ctx.fillStyle = c('--gold')
    ctx.fillRect(plotW + 1, yp - 8, PR - 3, 16)
    ctx.fillStyle = '#000'
    ctx.font = 'bold 10px "Space Mono", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(nf(price, digits), plotW + 1 + (PR - 3) / 2, yp)
  }

  // 시각축
  ctx.fillStyle = c('--ink3')
  ctx.font = '9px "Space Mono", monospace'
  ctx.textAlign = 'center'
  const step = Math.max(1, Math.floor(n / 7))
  for (let i = 0; i < n; i += step) ctx.fillText(hhmm(candles[i].t), X(i), H - 4)

  // 크로스헤어
  if (cursor && cursor.x < plotW) {
    const idx = Math.max(0, Math.min(n - 1, Math.floor(cursor.x / cw)))
    const cx = X(idx)
    const hp = mx - ((cursor.y - PT) / plotH) * (mx - mn)
    ctx.save()
    ctx.strokeStyle = c('--ink2'); ctx.lineWidth = 1; ctx.setLineDash([3, 3])
    ctx.beginPath(); ctx.moveTo(cx, PT); ctx.lineTo(cx, PT + plotH); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, cursor.y); ctx.lineTo(plotW, cursor.y); ctx.stroke()
    ctx.restore()
    ctx.fillStyle = c('--ink')
    ctx.fillRect(plotW + 1, cursor.y - 8, PR - 3, 16)
    ctx.fillStyle = c('--panel')
    ctx.font = 'bold 10px "Space Mono", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(nf(hp, digits), plotW + 1 + (PR - 3) / 2, cursor.y)
  }
}

/** 공통 껍데기 — 각 모드는 body 만 다르다 */
function ChartShell({
  candles, price, body,
}: {
  candles: Candle[]
  price: number | null
  body: (ctx: CanvasRenderingContext2D, ge: Geo) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const { w: W, h: H } = useSize(wrapRef)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const bodyRef = useRef(body)
  bodyRef.current = body

  useEffect(() => {
    const cv = cvRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap) return
    paint(cv, wrap, W, H, candles, price, cursor, bodyRef.current)
  }, [candles, price, W, H, cursor])

  const hover = (() => {
    if (!cursor || candles.length === 0) return null
    const plotW = W - PR
    if (cursor.x >= plotW) return null
    const cw = plotW / candles.length
    return candles[Math.max(0, Math.min(candles.length - 1, Math.floor(cursor.x / cw)))]
  })()
  const d = price && price >= 1000 ? 0 : price && price >= 1 ? 3 : 4

  return (
    <div className="chartbox" ref={wrapRef}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setCursor({ x: e.clientX - r.left, y: e.clientY - r.top })
      }}
      onMouseLeave={() => setCursor(null)}
    >
      <canvas ref={cvRef} style={{ width: W, height: H }} />
      {hover && (
        <div className="ohlcbox">
          <span className="c-ink3">{hhmm(hover.t)}</span>
          <span>O {nf(hover.o, d)}</span>
          <span className="c-up">H {nf(hover.h, d)}</span>
          <span className="c-dn">L {nf(hover.l, d)}</span>
          <span className={hover.c >= hover.o ? 'c-up' : 'c-dn'}>C {nf(hover.c, d)}</span>
        </div>
      )}
    </div>
  )
}

const drawCandles = (ctx: CanvasRenderingContext2D, ge: Geo, candles: Candle[]) => {
  candles.forEach((k, i) => {
    const cx = ge.X(i)
    const up = k.c >= k.o
    ctx.strokeStyle = up ? ge.c('--up') : ge.c('--dn')
    ctx.fillStyle = up ? ge.c('--up') : ge.c('--dn')
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(cx, ge.y(k.h)); ctx.lineTo(cx, ge.y(k.l)); ctx.stroke()
    ctx.fillRect(cx - ge.bw / 2, ge.y(Math.max(k.o, k.c)), ge.bw, Math.max(1, Math.abs(ge.y(k.o) - ge.y(k.c))))
  })
}

/* ---------------- VPVR ---------------- */
export function VpvrChart({ candles, price }: { candles: Candle[]; price: number | null }) {
  return (
    <ChartShell candles={candles} price={price} body={(ctx, ge) => {
      const BINS = 46
      const bins = new Float64Array(BINS)
      const binOf = (p: number) => Math.max(0, Math.min(BINS - 1, Math.floor(((p - ge.mn) / (ge.mx - ge.mn)) * BINS)))
      for (const k of candles) bins[binOf((k.h + k.l + k.c) / 3)] += k.v || 1
      let maxB = 0, total = 0
      for (const b of bins) { if (b > maxB) maxB = b; total += b }
      if (maxB <= 0) { drawCandles(ctx, ge, candles); return }

      let poc = 0
      for (let i = 1; i < BINS; i++) if (bins[i] > bins[poc]) poc = i
      const order = Array.from({ length: BINS }, (_, i) => i).sort((a, b) => bins[b] - bins[a])
      let acc = 0
      const inVA = new Set<number>()
      for (const i of order) { if (total > 0 && acc / total >= 0.7) break; acc += bins[i]; inVA.add(i) }

      const profW = ge.plotW * 0.34
      const binH = ge.plotH / BINS
      for (let i = 0; i < BINS; i++) {
        if (bins[i] <= 0) continue
        const w = (bins[i] / maxB) * profW
        const yy = PT + (BINS - 1 - i) * binH
        ctx.fillStyle = i === poc ? 'rgba(255,176,32,0.55)'
          : inVA.has(i) ? 'rgba(77,141,255,0.30)' : 'rgba(120,140,180,0.16)'
        ctx.fillRect(0, yy, w, Math.max(1, binH - 1))
      }
      drawCandles(ctx, ge, candles)

      const pocPrice = ge.mn + ((poc + 0.5) / BINS) * (ge.mx - ge.mn)
      ctx.save()
      ctx.strokeStyle = ge.c('--gold'); ctx.lineWidth = 1.4; ctx.setLineDash([6, 4])
      ctx.beginPath(); ctx.moveTo(0, ge.y(pocPrice)); ctx.lineTo(ge.plotW, ge.y(pocPrice)); ctx.stroke()
      ctx.restore()
      ctx.fillStyle = ge.c('--gold')
      ctx.font = 'bold 9px "Space Mono", monospace'
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'
      ctx.fillText(`POC ${nf(pocPrice, ge.digits)} · VA 70%`, 4, ge.y(pocPrice) - 4)
    }} />
  )
}

/* ---------------- DELTA ---------------- */
export function DeltaChart({ candles, price, trades }: { candles: Candle[]; price: number | null; trades: Trade[] }) {
  return (
    <ChartShell candles={candles} price={price} body={(ctx, ge) => {
      const step = candles.length > 1 ? candles[1].t - candles[0].t : 180000
      const delta = new Map<number, number>()
      for (const t of trades) {
        const slot = candles[0].t + Math.floor((t.t - candles[0].t) / step) * step
        delta.set(slot, (delta.get(slot) ?? 0) + (t.buy ? t.q : -t.q))
      }
      let maxD = 1e-9
      for (const v of delta.values()) maxD = Math.max(maxD, Math.abs(v))

      candles.forEach((k, i) => {
        const cx = ge.X(i)
        const d = delta.get(k.t)
        let col: string
        if (d == null) {
          col = ge.c('--ink3')
        } else {
          const inten = Math.min(1, Math.abs(d) / maxD)
          col = `hsla(${d >= 0 ? 150 : 348}, 92%, ${34 + inten * 28}%, ${0.6 + inten * 0.4})`
        }
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(cx, ge.y(k.h)); ctx.lineTo(cx, ge.y(k.l)); ctx.stroke()
        ctx.fillRect(cx - ge.bw / 2, ge.y(Math.max(k.o, k.c)), ge.bw, Math.max(1, Math.abs(ge.y(k.o) - ge.y(k.c))))
      })

      const barTop = PT + ge.plotH * 0.80
      const barH = ge.plotH * 0.18
      const mid = barTop + barH / 2
      ctx.strokeStyle = ge.c('--line2')
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(ge.plotW, mid); ctx.stroke()
      candles.forEach((k, i) => {
        const d = delta.get(k.t)
        if (d == null) return
        const h = (Math.abs(d) / maxD) * (barH / 2)
        ctx.fillStyle = d >= 0 ? 'rgba(38,224,127,0.85)' : 'rgba(255,77,106,0.85)'
        ctx.fillRect(ge.X(i) - ge.bw / 2, d >= 0 ? mid - h : mid, ge.bw, Math.max(1, h))
      })
      ctx.fillStyle = ge.c('--ink3')
      ctx.font = '9px "Space Mono", monospace'
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      ctx.fillText(`DELTA · 체결 ${trades.length}건`, 4, barTop - 11)
    }} />
  )
}

/* ---------------- HEIKIN ASHI ---------------- */
export function HeikinChart({ candles, price }: { candles: Candle[]; price: number | null }) {
  return (
    <ChartShell candles={candles} price={price} body={(ctx, ge) => {
      let ho = candles[0].o, hc = candles[0].c
      candles.forEach((k, i) => {
        const close = (k.o + k.h + k.l + k.c) / 4
        const open = i === 0 ? (k.o + k.c) / 2 : (ho + hc) / 2
        const high = Math.max(k.h, open, close)
        const low = Math.min(k.l, open, close)
        ho = open; hc = close
        const cx = ge.X(i)
        const up = close >= open
        ctx.strokeStyle = up ? ge.c('--up') : ge.c('--dn')
        ctx.fillStyle = up ? ge.c('--up') : ge.c('--dn')
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(cx, ge.y(high)); ctx.lineTo(cx, ge.y(low)); ctx.stroke()
        ctx.fillRect(cx - ge.bw / 2, ge.y(Math.max(open, close)), ge.bw, Math.max(1, Math.abs(ge.y(open) - ge.y(close))))
      })
      ctx.fillStyle = ge.c('--ink3')
      ctx.font = '9px "Space Mono", monospace'
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      ctx.fillText('HEIKIN ASHI · 노이즈 제거', 4, 3)
    }} />
  )
}

/* ---------------- TPO ---------------- */
export function TpoChart({ candles, price }: { candles: Candle[]; price: number | null }) {
  return (
    <ChartShell candles={candles} price={price} body={(ctx, ge) => {
      const BINS = 42
      const rows = new Array(BINS).fill(0)
      const binOf = (p: number) => Math.max(0, Math.min(BINS - 1, Math.floor(((p - ge.mn) / (ge.mx - ge.mn)) * BINS)))
      for (const k of candles) {
        const lo = binOf(k.l), hi = binOf(k.h)
        for (let b = lo; b <= hi; b++) rows[b]++
      }
      let maxR = 0
      for (const r of rows) if (r > maxR) maxR = r
      if (maxR <= 0) return
      const binH = ge.plotH / BINS
      const cellW = Math.max(3, Math.min(10, (ge.plotW * 0.9) / maxR))
      for (let i = 0; i < BINS; i++) {
        const yy = PT + (BINS - 1 - i) * binH
        const t = rows[i] / maxR
        for (let k = 0; k < rows[i]; k++) {
          ctx.fillStyle = `hsla(${205 - t * 60}, 88%, ${32 + t * 28}%, ${0.35 + t * 0.5})`
          ctx.fillRect(2 + k * cellW, yy, cellW - 1, Math.max(1, binH - 1))
        }
      }
      const poc = rows.indexOf(maxR)
      const pocPrice = ge.mn + ((poc + 0.5) / BINS) * (ge.mx - ge.mn)
      ctx.save()
      ctx.strokeStyle = ge.c('--gold'); ctx.lineWidth = 1.4; ctx.setLineDash([6, 4])
      ctx.beginPath(); ctx.moveTo(0, ge.y(pocPrice)); ctx.lineTo(ge.plotW, ge.y(pocPrice)); ctx.stroke()
      ctx.restore()
      ctx.fillStyle = ge.c('--gold')
      ctx.font = 'bold 9px "Space Mono", monospace'
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
      ctx.fillText(`TPO POC ${nf(pocPrice, ge.digits)}`, ge.plotW - 4, ge.y(pocPrice) - 4)
    }} />
  )
}
