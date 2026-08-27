import { useEffect, useRef, useState } from 'react'

/** PnL 카드 안의 자본 곡선 스파크라인 (금색 선 + 옅은 채움) */
export function EquitySpark({ points, seed }: { points: number[]; seed: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 400, h: 60 })

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
    if (!cv || !wrap) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = size.w * dpr
    cv.height = size.h * dpr
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    const g = (k: string) => getComputedStyle(wrap).getPropertyValue(k).trim() || '#888'

    const data = points.length > 1 ? points : [seed, seed]
    let mn = Math.min(...data, seed), mx = Math.max(...data, seed)
    const pad = (mx - mn) * 0.12 || Math.max(1, seed * 0.01)
    mn -= pad; mx += pad
    const PT = 14, PB = 4
    const H = size.h - PT - PB
    const X = (i: number) => (i / Math.max(1, data.length - 1)) * size.w
    const Y = (v: number) => PT + ((mx - v) / (mx - mn)) * H

    // 시드 기준선
    ctx.strokeStyle = g('--line')
    ctx.setLineDash([2, 3])
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, Y(seed)); ctx.lineTo(size.w, Y(seed)); ctx.stroke()
    ctx.setLineDash([])

    const last = data[data.length - 1]
    const col = last >= seed ? g('--gold') : g('--dn')

    // 채움
    ctx.beginPath()
    ctx.moveTo(0, Y(data[0]))
    data.forEach((v, i) => ctx.lineTo(X(i), Y(v)))
    ctx.lineTo(size.w, size.h); ctx.lineTo(0, size.h); ctx.closePath()
    const grd = ctx.createLinearGradient(0, PT, 0, size.h)
    grd.addColorStop(0, `color-mix(in srgb, ${col} 30%, transparent)`)
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    try { ctx.fillStyle = grd } catch { ctx.fillStyle = 'rgba(255,176,32,0.16)' }
    ctx.fill()

    // 선
    ctx.beginPath()
    data.forEach((v, i) => ctx[i === 0 ? 'moveTo' : 'lineTo'](X(i), Y(v)))
    ctx.strokeStyle = col
    ctx.lineWidth = 1.6
    ctx.stroke()
  }, [points, seed, size])

  return (
    <div style={{ position: 'absolute', inset: 0 }} ref={wrapRef}>
      <canvas ref={cvRef} style={{ width: size.w, height: size.h, display: 'block' }} />
    </div>
  )
}
