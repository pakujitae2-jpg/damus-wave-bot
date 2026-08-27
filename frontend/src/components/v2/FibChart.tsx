import { useEffect, useRef, useState } from 'react'
import type { Candle, Session } from '#/lib/useMarketHub'

/* ============================================================
   FibChart — 사용자 파인스크립트 "어제오늘 합친 Fibonacci" 재현 + 캔들

   파인스크립트 대응
     · 세션 경계 UTC 00:00 = 09:00 KST → 우리 엔진 T/Y 파동과 동일
     · 오늘(T): 고가 red / 저가 blue / 14.6·23.6·61.8 red / 38.2·76.4·85.4 blue / 50 green — 점 스타일
     · 어제(Y): 고가 red(굵게) / 저가 ink(굵게) / 비율 gray / 50 green — 실선
     · 채움: 14.6~23.6 red, 76.4~85.4 blue (오늘 10% · 어제 20% 불투명도)
   ============================================================ */

const FIB = [0.146, 0.236, 0.382, 0.5, 0.618, 0.764, 0.854] as const
const PAD_R = 62
const PAD_B = 16
const PAD_T = 6
const PAD_L = 2

const css = (el: HTMLElement, name: string) => getComputedStyle(el).getPropertyValue(name).trim() || '#888'
const nf = (v: number, d: number) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const hhmm = (t: number) => {
  const d = new Date(t + 9 * 3600e3)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

export interface Marker { t: number; price: number; side: string; symbol: string }

export function FibChart({
  candles, price, today, yesterday, markers, showYesterday = true, showToday = true,
}: {
  candles: Candle[]
  price: number | null
  today: Session | null
  yesterday: Session | null
  markers?: Marker[]
  showYesterday?: boolean
  showToday?: boolean
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 900, h: 400 })
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [hover, setHover] = useState<{ c: Candle; price: number } | null>(null)

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
    if (!cv || !wrap || candles.length === 0) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = size.w * dpr
    cv.height = size.h * dpr
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)

    const C = {
      ink: css(wrap, '--ink'), ink2: css(wrap, '--ink2'), ink3: css(wrap, '--ink3'),
      line: css(wrap, '--line'), line2: css(wrap, '--line2'), panel: css(wrap, '--panel'),
      up: css(wrap, '--up'), dn: css(wrap, '--dn'), gold: css(wrap, '--gold'),
      blue: css(wrap, '--blue'), green: css(wrap, '--up'), gray: css(wrap, '--ink3'),
    }

    // ── 스케일 ──
    const W = size.w, H = size.h
    const plotW = W - PAD_L - PAD_R
    const plotH = H - PAD_T - PAD_B
    let mn = Math.min(...candles.map((c) => c.l))
    let mx = Math.max(...candles.map((c) => c.h))
    const consider = (v?: number | null) => {
      if (v == null || !isFinite(v) || !price) return
      if (Math.abs(v - price) / price < 0.06) { mn = Math.min(mn, v); mx = Math.max(mx, v) }
    }
    for (const s of [showToday ? today : null, showYesterday ? yesterday : null]) {
      if (!s) continue
      const r = s.high - s.low
      consider(s.high); consider(s.low)
      for (const f of FIB) consider(s.low + r * f)
    }
    const pad = (mx - mn) * 0.05 || 1
    mn -= pad; mx += pad
    const y = (v: number) => PAD_T + ((mx - v) / (mx - mn)) * plotH
    const yInv = (py: number) => mx - ((py - PAD_T) / plotH) * (mx - mn)
    const n = candles.length
    const cw = plotW / n
    const bw = Math.max(1, Math.min(9, cw * 0.62))
    const X = (i: number) => PAD_L + cw * i + cw / 2
    const digits = price && price >= 1000 ? 0 : price && price >= 1 ? 3 : 4

    // ── 그리드 ──
    ctx.strokeStyle = C.line2
    ctx.lineWidth = 1
    ctx.font = '9px "Space Mono", monospace'
    ctx.textBaseline = 'middle'
    const taken: number[] = []
    const freeY = (yy: number) => taken.every((t) => Math.abs(t - yy) >= 12)
    for (let i = 0; i <= 5; i++) {
      const v = mn + ((mx - mn) * i) / 5
      const yy = y(v)
      ctx.beginPath(); ctx.moveTo(PAD_L, yy); ctx.lineTo(PAD_L + plotW, yy); ctx.stroke()
      ctx.fillStyle = C.ink3
      ctx.textAlign = 'left'
      ctx.fillText(nf(v, digits), PAD_L + plotW + 5, yy)
      taken.push(yy)
    }

    // ── 채움 구간 (파인스크립트 fill) ──
    const fillZone = (s: Session, a: number, b: number, color: string, alpha: number) => {
      const r = s.high - s.low
      const y1 = y(s.low + r * a), y2 = y(s.low + r * b)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      ctx.fillRect(PAD_L, Math.min(y1, y2), plotW, Math.abs(y2 - y1))
      ctx.restore()
    }
    if (showYesterday && yesterday) {
      fillZone(yesterday, 0.146, 0.236, C.dn, 0.20)   // 레드존
      fillZone(yesterday, 0.764, 0.854, C.blue, 0.20) // 블루존
    }
    if (showToday && today) {
      fillZone(today, 0.146, 0.236, C.dn, 0.10)
      fillZone(today, 0.764, 0.854, C.blue, 0.10)
    }

    // ── 라인 그리기 헬퍼 ──
    const hline = (v: number, color: string, width: number, dash: number[], label?: string, labelSide: 'l' | 'r' = 'l') => {
      if (v < mn || v > mx) return
      const yy = y(v)
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.setLineDash(dash)
      ctx.beginPath(); ctx.moveTo(PAD_L, yy); ctx.lineTo(PAD_L + plotW, yy); ctx.stroke()
      ctx.restore()
      if (label && freeY(yy)) {
        taken.push(yy)
        ctx.fillStyle = color
        ctx.font = 'bold 9px "Space Mono", monospace'
        ctx.textAlign = labelSide === 'l' ? 'left' : 'right'
        ctx.fillText(label, labelSide === 'l' ? PAD_L + 4 : PAD_L + plotW - 4, yy - 6)
      }
    }

    // ── 어제(Y) : 실선 ──
    if (showYesterday && yesterday) {
      const r = yesterday.high - yesterday.low
      const ycol = (f: number) => (f === 0.5 ? C.green : C.gray)
      for (const f of FIB) {
        hline(yesterday.low + r * f, ycol(f), 1, [], `Y ${(f * 100).toFixed(1)}`, 'r')
      }
      hline(yesterday.high, C.dn, 2.5, [], `전일고 ${nf(yesterday.high, digits)}`, 'r')
      hline(yesterday.low, C.ink, 2.5, [], `전일저 ${nf(yesterday.low, digits)}`, 'r')
    }

    // ── 오늘(T) : 점 스타일 ──
    if (showToday && today) {
      const r = today.high - today.low
      const tcol = (f: number) =>
        f === 0.5 ? C.green : f === 0.382 || f === 0.764 || f === 0.854 ? C.blue : C.dn
      for (const f of FIB) {
        hline(today.low + r * f, tcol(f), 1, [2, 3], `${(f * 100).toFixed(1)}`, 'l')
      }
      hline(today.high, C.dn, 1.5, [2, 3], `당일고 ${nf(today.high, digits)}`, 'l')
      hline(today.low, C.blue, 1.5, [2, 3], `당일저 ${nf(today.low, digits)}`, 'l')
    }

    // ── 캔들 ──
    candles.forEach((c, i) => {
      const cx = X(i)
      const up = c.c >= c.o
      ctx.strokeStyle = up ? C.up : C.dn
      ctx.fillStyle = up ? C.up : C.dn
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(cx, y(c.h)); ctx.lineTo(cx, y(c.l)); ctx.stroke()
      const top = y(Math.max(c.o, c.c))
      const hh = Math.max(1, Math.abs(y(c.o) - y(c.c)))
      ctx.fillRect(cx - bw / 2, top, bw, hh)
    })

    // ── 진입 마커 ──
    for (const m of markers ?? []) {
      let idx = candles.findIndex((c) => c.t >= m.t)
      if (idx < 0) idx = n - 1
      const cx = X(idx)
      const col = m.side === 'LONG' ? C.up : C.dn
      ctx.save()
      ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(cx, PAD_T); ctx.lineTo(cx, PAD_T + plotH); ctx.stroke()
      ctx.restore()
      ctx.fillStyle = col
      ctx.beginPath(); ctx.arc(cx, y(m.price), 3.5, 0, Math.PI * 2); ctx.fill()
      ctx.font = 'bold 9px "Space Mono", monospace'
      ctx.textAlign = 'left'
      ctx.fillText(m.symbol.replace('USDT', ''), cx + 5, PAD_T + 8)
    }

    // ── 현재가 ──
    if (price != null) {
      const yp = y(price)
      ctx.save()
      ctx.strokeStyle = C.gold; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3])
      ctx.beginPath(); ctx.moveTo(PAD_L, yp); ctx.lineTo(PAD_L + plotW, yp); ctx.stroke()
      ctx.restore()
      ctx.fillStyle = C.gold
      ctx.fillRect(PAD_L + plotW + 2, yp - 8, PAD_R - 6, 16)
      ctx.fillStyle = '#000'
      ctx.font = 'bold 10px "Space Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(nf(price, digits), PAD_L + plotW + 2 + (PAD_R - 6) / 2, yp)
    }

    // ── 시각축 ──
    ctx.fillStyle = C.ink3
    ctx.font = '9px "Space Mono", monospace'
    ctx.textAlign = 'center'
    const step = Math.max(1, Math.floor(n / 8))
    for (let i = 0; i < n; i += step) ctx.fillText(hhmm(candles[i].t), X(i), H - 7)

    // ── 크로스헤어 ──
    if (cursor && cursor.x < PAD_L + plotW) {
      const idx = Math.max(0, Math.min(n - 1, Math.floor((cursor.x - PAD_L) / cw)))
      const cx = X(idx)
      const hp = yInv(cursor.y)
      ctx.save()
      ctx.strokeStyle = C.ink2; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(cx, PAD_T); ctx.lineTo(cx, PAD_T + plotH); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(PAD_L, cursor.y); ctx.lineTo(PAD_L + plotW, cursor.y); ctx.stroke()
      ctx.restore()
      // 가격 태그
      ctx.fillStyle = C.ink
      ctx.fillRect(PAD_L + plotW + 2, cursor.y - 8, PAD_R - 6, 16)
      ctx.fillStyle = C.panel
      ctx.font = 'bold 10px "Space Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(nf(hp, digits), PAD_L + plotW + 2 + (PAD_R - 6) / 2, cursor.y)
      // 시각 태그
      const tx = Math.min(Math.max(cx - 24, PAD_L), PAD_L + plotW - 48)
      ctx.fillStyle = C.ink
      ctx.fillRect(tx, H - 15, 48, 13)
      ctx.fillStyle = C.panel
      ctx.fillText(hhmm(candles[idx].t), tx + 24, H - 8)
    }
  }, [candles, price, today, yesterday, markers, size, cursor, showToday, showYesterday])

  // 커서 → hover 상태
  useEffect(() => {
    if (!cursor || candles.length === 0) { setHover(null); return }
    const plotW = size.w - PAD_L - PAD_R
    const plotH = size.h - PAD_T - PAD_B
    if (cursor.x >= PAD_L + plotW) { setHover(null); return }
    const cw = plotW / candles.length
    const idx = Math.max(0, Math.min(candles.length - 1, Math.floor((cursor.x - PAD_L) / cw)))
    let mn = Math.min(...candles.map((c) => c.l))
    let mx = Math.max(...candles.map((c) => c.h))
    const p = (mx - mn) * 0.05 || 1
    mn -= p; mx += p
    setHover({ c: candles[idx], price: mx - ((cursor.y - PAD_T) / plotH) * (mx - mn) })
  }, [cursor, candles, size])

  const d = price && price >= 1000 ? 0 : price && price >= 1 ? 3 : 4

  return (
    <div className="chartbox" ref={wrapRef}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setCursor({ x: e.clientX - r.left, y: e.clientY - r.top })
      }}
      onMouseLeave={() => setCursor(null)}
    >
      <canvas ref={cvRef} style={{ width: size.w, height: size.h }} />
      {hover && (
        <div className="ohlcbox">
          <span className="c-ink3">{hhmm(hover.c.t)}</span>
          <span>O {nf(hover.c.o, d)}</span>
          <span className="c-up">H {nf(hover.c.h, d)}</span>
          <span className="c-dn">L {nf(hover.c.l, d)}</span>
          <span className={hover.c.c >= hover.c.o ? 'c-up' : 'c-dn'}>C {nf(hover.c.c, d)}</span>
        </div>
      )}
      <div className="legend">
        <span><i className="c-dn">━</i> 전일고·레드존</span>
        <span><i className="c-blue">━</i> 블루존</span>
        <span><i className="c-up">━</i> 50%</span>
        <span><i className="c-ink3">┈</i> 당일 피보(점선)</span>
        <span><i className="c-gold">━</i> 현재가</span>
      </div>
    </div>
  )
}
