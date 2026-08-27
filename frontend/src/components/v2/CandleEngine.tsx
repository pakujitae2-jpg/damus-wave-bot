import { useEffect, useRef, useState } from 'react'
import { rsiSeries, vwapBands, type Candle } from '#/lib/useMarketHub'

/* ============================================================
   CANDLE ENGINE — 캔들 + VWAP ±1σ 밴드 + RSI(14) 서브패널
     하단 1/4 을 RSI 로 쓰고, 30/70 밴드를 표시한다.
   ============================================================ */

const PAD_R = 44
const PAD_T = 4
const RSI_H = 0.28

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [s, setS] = useState({ w: 400, h: 140 })
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

export function CandleEngine({ candles, price }: { candles: Candle[]; price: number | null }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const { w: W, h: H } = useSize(wrapRef)

  useEffect(() => {
    const cv = cvRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap || candles.length < 20) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = W * dpr
    cv.height = H * dpr
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const g = (k: string) => getComputedStyle(wrap).getPropertyValue(k).trim() || '#888'
    ctx.fillStyle = g('--panel')
    ctx.fillRect(0, 0, W, H)

    const view = candles.slice(-70)
    const { vwap, up, dn } = vwapBands(candles)
    const vOff = candles.length - view.length
    const rsi = rsiSeries(candles, 14)

    const priceH = H * (1 - RSI_H) - PAD_T
    const rsiTop = H * (1 - RSI_H) + 2
    const rsiH = H - rsiTop - 2
    const plotW = W - PAD_R

    let mn = Math.min(...view.map((c) => c.l))
    let mx = Math.max(...view.map((c) => c.h))
    for (let i = vOff; i < candles.length; i++) {
      if (isFinite(up[i])) { mn = Math.min(mn, dn[i]); mx = Math.max(mx, up[i]) }
    }
    const pad = (mx - mn) * 0.06 || 1
    mn -= pad; mx += pad
    const Y = (v: number) => PAD_T + ((mx - v) / (mx - mn)) * priceH
    const n = view.length
    const cw = plotW / n
    const bw = Math.max(1, Math.min(6, cw * 0.6))
    const X = (i: number) => cw * i + cw / 2

    // VWAP 밴드 채움
    ctx.beginPath()
    for (let i = 0; i < n; i++) ctx[i === 0 ? 'moveTo' : 'lineTo'](X(i), Y(up[vOff + i]))
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(dn[vOff + i]))
    ctx.closePath()
    ctx.fillStyle = 'rgba(120,150,255,0.10)'
    ctx.fill()

    // VWAP
    ctx.strokeStyle = g('--blue')
    ctx.lineWidth = 1.2
    ctx.beginPath()
    for (let i = 0; i < n; i++) ctx[i === 0 ? 'moveTo' : 'lineTo'](X(i), Y(vwap[vOff + i]))
    ctx.stroke()

    // 캔들
    view.forEach((c, i) => {
      const cx = X(i)
      const isUp = c.c >= c.o
      ctx.strokeStyle = isUp ? g('--up') : g('--dn')
      ctx.fillStyle = isUp ? g('--up') : g('--dn')
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(cx, Y(c.h)); ctx.lineTo(cx, Y(c.l)); ctx.stroke()
      const top = Y(Math.max(c.o, c.c))
      const hh = Math.max(1, Math.abs(Y(c.o) - Y(c.c)))
      ctx.fillRect(cx - bw / 2, top, bw, hh)
    })

    // 현재가 태그
    if (price != null) {
      const yp = Y(price)
      ctx.fillStyle = g('--gold')
      ctx.fillRect(plotW + 1, yp - 7, PAD_R - 3, 14)
      ctx.fillStyle = '#000'
      ctx.font = 'bold 9px "Space Mono", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(nf(price, 0), plotW + 1 + (PAD_R - 3) / 2, yp)
    }

    // ── RSI ──
    ctx.strokeStyle = g('--line2')
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, rsiTop); ctx.lineTo(plotW, rsiTop); ctx.stroke()
    const RY = (v: number) => rsiTop + ((100 - v) / 100) * rsiH
    for (const lv of [30, 70]) {
      ctx.strokeStyle = g('--line')
      ctx.setLineDash([2, 3])
      ctx.beginPath(); ctx.moveTo(0, RY(lv)); ctx.lineTo(plotW, RY(lv)); ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.strokeStyle = g('--purple')
    ctx.lineWidth = 1.2
    ctx.beginPath()
    let started = false
    for (let i = 0; i < n; i++) {
      const v = rsi[vOff + i - 1]
      if (!isFinite(v)) continue
      const x = X(i), y = RY(v)
      if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
    }
    ctx.stroke()
    const lastRsi = [...rsi].reverse().find((v) => isFinite(v))
    ctx.font = 'bold 9px "Space Mono", monospace'
    ctx.textAlign = 'left'
    ctx.fillStyle = g('--purple')
    ctx.fillText(`RSI ${lastRsi != null ? lastRsi.toFixed(0) : '—'}`, 3, rsiTop + 8)
    ctx.fillStyle = g('--blue')
    ctx.fillText(`VWAP ${nf(vwap[vwap.length - 1], 0)}`, 3, 10)
  }, [candles, price, W, H])

  return (
    <div className="chartbox" ref={wrapRef}>
      <canvas ref={cvRef} style={{ width: W, height: H }} />
    </div>
  )
}

/** 헤더 태그용 — 마지막 RSI / VWAP 대비 위치 */
export function candleEngineTags(candles: Candle[], price: number | null) {
  if (candles.length < 20) return { rsi: null as number | null, vwapSide: '' }
  const rsi = rsiSeries(candles, 14)
  const last = [...rsi].reverse().find((v) => isFinite(v)) ?? null
  const { vwap } = vwapBands(candles)
  const v = vwap[vwap.length - 1]
  return { rsi: last, vwapSide: price == null ? '' : price >= v ? 'ABOVE' : 'BELOW' }
}
