import { useEffect, useRef, useState } from 'react'
import type { Candle } from '#/lib/useMarketHub'

/** MA RIBBON — 28밴드 이동평균. 정배열(상승)일수록 초록, 역배열일수록 빨강으로 물든다. */
export function MaRibbon({ candles, bands = 28 }: { candles: Candle[]; bands?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 600, h: 160 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      if (r.width > 1 && r.height > 1) setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const cv = cvRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap || candles.length < 10) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = size.w * dpr
    cv.height = size.h * dpr
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)

    const g = (k: string) => getComputedStyle(wrap).getPropertyValue(k).trim() || '#888'
    const inkc = g('--ink'), ink3 = g('--ink3'), line2 = g('--line2')

    // 기간: 5 ~ 5+27*4
    const periods = Array.from({ length: bands }, (_, i) => 5 + i * 4)
    const closes = candles.map((c) => c.c)
    const series: number[][] = periods.map((p) => {
      const out: number[] = []
      let sum = 0
      for (let i = 0; i < closes.length; i++) {
        sum += closes[i]
        if (i >= p) sum -= closes[i - p]
        out.push(i >= p - 1 ? sum / p : NaN)
      }
      return out
    })

    const maxP = periods[periods.length - 1]
    const start = maxP
    if (closes.length <= start + 2) return
    const vals: number[] = []
    for (const s of series) for (let i = start; i < s.length; i++) if (isFinite(s[i])) vals.push(s[i])
    for (let i = start; i < closes.length; i++) vals.push(closes[i])
    let mn = Math.min(...vals), mx = Math.max(...vals)
    const pad = (mx - mn) * 0.08 || 1
    mn -= pad; mx += pad

    const W = size.w, H = size.h, PB = 2, PT = 2
    const plotH = H - PT - PB
    const n = closes.length - start
    const X = (i: number) => (i / Math.max(1, n - 1)) * W
    const Y = (v: number) => PT + ((mx - v) / (mx - mn)) * plotH

    // 리본: 짧은 기간(0)=초록 → 긴 기간(1)=보라 스펙트럼
    series.forEach((s, bi) => {
      const t = bi / (bands - 1)
      const hue = 140 - t * 150 // 140(초록) → -10(빨강/자홍)
      ctx.strokeStyle = `hsla(${(hue + 360) % 360}, 85%, 58%, 0.75)`
      ctx.lineWidth = 1
      ctx.beginPath()
      let started = false
      for (let i = start; i < s.length; i++) {
        const v = s[i]
        if (!isFinite(v)) continue
        const px = X(i - start), py = Y(v)
        if (!started) { ctx.moveTo(px, py); started = true } else ctx.lineTo(px, py)
      }
      ctx.stroke()
    })

    // 종가
    ctx.strokeStyle = inkc
    ctx.lineWidth = 1.4
    ctx.beginPath()
    for (let i = start; i < closes.length; i++) {
      const px = X(i - start), py = Y(closes[i])
      if (i === start) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.stroke()

    // 우측 현재가 눈금
    ctx.strokeStyle = line2
    ctx.beginPath(); ctx.moveTo(0, Y(closes[closes.length - 1])); ctx.lineTo(W, Y(closes[closes.length - 1])); ctx.stroke()
    ctx.fillStyle = ink3
    ctx.font = '9px "Space Mono", monospace'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText(`${bands} bands · MA${periods[0]}~MA${maxP}`, W - 4, 3)
  }, [candles, size, bands])

  return (
    <div className="chartbox" ref={wrapRef}>
      <canvas ref={cvRef} style={{ width: size.w, height: size.h }} />
    </div>
  )
}

/** 리본 정배열/역배열 강도 (-1 ~ +1) — 헤더 태그용 */
export function ribbonTrend(candles: Candle[], bands = 28): number {
  if (candles.length < 120) return 0
  const closes = candles.map((c) => c.c)
  const periods = Array.from({ length: bands }, (_, i) => 5 + i * 4)
  const last: number[] = []
  for (const p of periods) {
    if (closes.length < p) return 0
    let sum = 0
    for (let i = closes.length - p; i < closes.length; i++) sum += closes[i]
    last.push(sum / p)
  }
  let ordered = 0
  for (let i = 0; i < last.length - 1; i++) ordered += last[i] > last[i + 1] ? 1 : -1
  return ordered / (last.length - 1)
}
