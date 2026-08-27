import { useEffect, useRef, useState } from 'react'
import type { Candle } from '#/lib/useBinance'
import type { LiveLevel } from '#/lib/types'

const PL = 6
const PR = 78
const PT = 12
const PB = 20
const LABEL_H = 13 // 라벨 하나가 차지하는 세로 폭 — 겹침 판정 기준

const LEVEL_COLOR: Record<string, string> = {
  SOP: 'var(--purple)',
  RETEST_UP: 'var(--blue)',
  RETEST_DN: 'var(--blue)',
  HW_RED: 'var(--cyan)',
  HW_BLUE: 'var(--cyan)',
}
const LEVEL_LABEL: Record<string, string> = {
  SOP: 'SOP',
  RETEST_UP: '리테스트↑',
  RETEST_DN: '리테스트↓',
  HW_RED: '9번 레드',
  HW_BLUE: '9번 블루',
}

const nf = (v: number, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const hhmm = (t: number) => {
  const d = new Date(t + 9 * 3600e3)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** 컨테이너 실제 픽셀 크기로 그린다 — viewBox 스케일 왜곡이 없어 글자가 선명하다 */
function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 900, h: 300 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

/**
 * BTC 시그널 차트 — 3분봉 + 미해소 레벨 + 겹침 밴드.
 * · 마우스를 올리면 크로스헤어와 함께 그 지점 가격·시각·OHLC 를 보여준다.
 * · 라벨은 서로 겹치지 않도록 이미 점유된 세로 구간을 피해서만 그린다.
 */
export function SignalChart({
  candles, price, levels, band, tLow, tHigh, entries,
}: {
  candles: Candle[]
  price: number | null
  levels: LiveLevel[]
  band: number
  tLow?: number | null
  tHigh?: number | null
  entries?: { t: number; price: number; side: string; symbol: string }[]
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const { w: W, h: H } = useSize(wrapRef)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  if (candles.length === 0 || price == null) {
    return <div className="chartbody" ref={wrapRef} />
  }

  let mn = Math.min(...candles.map((c) => c.l))
  let mx = Math.max(...candles.map((c) => c.h))
  for (const l of levels) {
    if (Math.abs(l.price - price) / price < 0.045) {
      mn = Math.min(mn, l.price)
      mx = Math.max(mx, l.price)
    }
  }
  mn = Math.min(mn, price * (1 - band))
  mx = Math.max(mx, price * (1 + band))
  const pad = (mx - mn) * 0.05 || 1
  mn -= pad
  mx += pad

  const plotW = W - PL - PR
  const plotH = H - PT - PB
  const y = (v: number) => PT + ((mx - v) / (mx - mn)) * plotH
  const yInv = (py: number) => mx - ((py - PT) / plotH) * (mx - mn)
  const n = candles.length
  const cw = plotW / n
  const bw = Math.max(1.5, Math.min(10, cw * 0.6))
  const x = (i: number) => PL + cw * i + cw / 2

  const hoverIdx = cursor && cursor.x < PL + plotW ? Math.max(0, Math.min(n - 1, Math.floor((cursor.x - PL) / cw))) : null
  const hc = hoverIdx != null ? candles[hoverIdx] : null
  const hoverPrice = cursor ? yInv(cursor.y) : null

  const digits = price >= 1000 ? 0 : price >= 1 ? 3 : 4
  const els: React.ReactNode[] = []

  // ── 겹침 방지: 점유된 세로 구간 관리 ──
  const takenLeft: number[] = []   // 좌측 라벨 (레벨/T파동)
  const takenRight: number[] = []  // 우측 가격축
  const free = (taken: number[], yy: number) => taken.every((t) => Math.abs(t - yy) >= LABEL_H)
  const claim = (taken: number[], yy: number) => { taken.push(yy); return true }

  // 현재가·크로스헤어는 우선권을 먼저 확보한다
  const yPrice = y(price)
  claim(takenRight, yPrice)
  if (cursor) claim(takenRight, cursor.y)

  // 겹침 밴드
  const yTop = y(price * (1 + band))
  const yBot = y(price * (1 - band))
  els.push(
    <rect key="band" x={PL} y={yTop} width={plotW} height={Math.max(1, yBot - yTop)} fill="var(--gold)" opacity={0.07} />,
    <line key="bt" x1={PL} y1={yTop} x2={PL + plotW} y2={yTop} stroke="var(--gold)" strokeWidth={1} strokeDasharray="2,4" opacity={0.55} />,
    <line key="bb" x1={PL} y1={yBot} x2={PL + plotW} y2={yBot} stroke="var(--gold)" strokeWidth={1} strokeDasharray="2,4" opacity={0.55} />,
  )

  // 가로 그리드 + 우측 가격축 (현재가·크로스헤어와 겹치면 숫자 생략)
  for (let i = 0; i <= 4; i++) {
    const v = mn + ((mx - mn) * i) / 4
    const yy = y(v)
    els.push(<line key={`g${i}`} x1={PL} y1={yy} x2={PL + plotW} y2={yy} stroke="var(--grid)" strokeWidth={1} />)
    if (free(takenRight, yy)) {
      claim(takenRight, yy)
      els.push(
        <text key={`gt${i}`} x={W - PR + 8} y={yy + 3.5} fill="var(--ink3)" fontSize={10} fontWeight={700}>
          {nf(v, digits)}
        </text>,
      )
    }
  }

  // T 파동 저/고
  for (const [lab, v] of [['T고', tHigh], ['T저', tLow]] as [string, number | null | undefined][]) {
    if (v == null || v < mn || v > mx) continue
    const yy = y(v)
    els.push(<line key={`t${lab}`} x1={PL} y1={yy} x2={PL + plotW} y2={yy} stroke="var(--ink3)" strokeWidth={1} strokeDasharray="1,5" opacity={0.65} />)
    if (free(takenLeft, yy)) {
      claim(takenLeft, yy)
      els.push(
        <text key={`tt${lab}`} x={PL + plotW - 4} y={yy - 4} fill="var(--ink3)" fontSize={9.5} fontWeight={700} textAnchor="end">
          {lab} {nf(v, digits)}
        </text>,
      )
    }
  }

  // 미해소 레벨 — 밴드 안(중요한 것)부터 라벨 자리를 차지한다
  const sorted = [...levels]
    .filter((l) => l.price >= mn && l.price <= mx)
    .sort((a, b) => {
      const ai = Math.abs(a.price - price) / price <= band ? 0 : 1
      const bi = Math.abs(b.price - price) / price <= band ? 0 : 1
      return ai - bi
    })
  sorted.forEach((l, i) => {
    const yy = y(l.price)
    const inBand = Math.abs(l.price - price) / price <= band
    const col = LEVEL_COLOR[l.kind] ?? 'var(--ink3)'
    els.push(
      <line key={`l${i}`} x1={PL} y1={yy} x2={PL + plotW} y2={yy} stroke={col}
        strokeWidth={inBand ? 1.6 : 1} strokeDasharray="5,4" opacity={inBand ? 0.95 : 0.32} />,
    )
    if (free(takenLeft, yy)) {
      claim(takenLeft, yy)
      els.push(
        <text key={`lt${i}`} x={PL + 5} y={yy - 4} fill={col} fontSize={9.5} fontWeight={700} opacity={inBand ? 1 : 0.55}>
          {LEVEL_LABEL[l.kind] ?? l.kind} {nf(l.price, digits)}
        </text>,
      )
    }
  })

  // 캔들
  candles.forEach((c, i) => {
    const cx = x(i)
    const up = c.c >= c.o
    const col = up ? 'var(--up)' : 'var(--dn)'
    els.push(<line key={`w${i}`} x1={cx} y1={y(c.h)} x2={cx} y2={y(c.l)} stroke={col} strokeWidth={1} opacity={0.85} />)
    const top = y(Math.max(c.o, c.c))
    const hh = Math.max(1, Math.abs(y(c.o) - y(c.c)))
    els.push(<rect key={`c${i}`} x={cx - bw / 2} y={top} width={bw} height={hh} fill={col} opacity={up ? 0.88 : 1} />)
  })

  // 진입 마커
  for (const e of entries ?? []) {
    let idx = candles.findIndex((c) => c.t >= e.t)
    if (idx < 0) idx = n - 1
    const cx = x(idx)
    const col = e.side === 'LONG' ? 'var(--up)' : 'var(--dn)'
    els.push(
      <g key={`e${e.symbol}${e.t}`}>
        <line x1={cx} y1={PT} x2={cx} y2={PT + plotH} stroke={col} strokeWidth={1} strokeDasharray="3,3" opacity={0.55} />
        <circle cx={cx} cy={PT + 7} r={3.5} fill={col} />
        <text x={cx + 6} y={PT + 10} fill={col} fontSize={9} fontWeight={700}>{e.symbol.replace('USDT', '')}</text>
      </g>,
    )
  }

  // 현재가 라인 + 태그
  els.push(<line key="pxl" x1={PL} y1={yPrice} x2={PL + plotW} y2={yPrice} stroke="var(--gold)" strokeWidth={1.2} strokeDasharray="4,3" />)
  els.push(<rect key="pxb" x={W - PR + 2} y={yPrice - 9} width={PR - 5} height={18} fill="var(--gold)" />)
  els.push(
    <text key="pxt" x={W - PR + 2 + (PR - 5) / 2} y={yPrice + 4} fill="#fff" fontSize={11} fontWeight={700} textAnchor="middle">
      {nf(price, digits)}
    </text>,
  )

  // 시각 축
  const step = Math.max(1, Math.floor(n / 6))
  for (let i = 0; i < n; i += step) {
    els.push(<text key={`x${i}`} x={x(i)} y={H - 6} fill="var(--ink3)" fontSize={9} textAnchor="middle">{hhmm(candles[i].t)}</text>)
  }

  // 크로스헤어
  if (cursor && hc && hoverPrice != null && hoverIdx != null) {
    const cx = x(hoverIdx)
    const tagX = Math.min(Math.max(cx - 26, PL), PL + plotW - 52)
    els.push(
      <g key="cross">
        <line x1={cx} y1={PT} x2={cx} y2={PT + plotH} stroke="var(--ink2)" strokeWidth={1} strokeDasharray="3,3" opacity={0.85} />
        <line x1={PL} y1={cursor.y} x2={PL + plotW} y2={cursor.y} stroke="var(--ink2)" strokeWidth={1} strokeDasharray="3,3" opacity={0.85} />
        <rect x={W - PR + 2} y={cursor.y - 9} width={PR - 5} height={18} fill="var(--ink)" />
        <text x={W - PR + 2 + (PR - 5) / 2} y={cursor.y + 4} fill="var(--bg)" fontSize={11} fontWeight={700} textAnchor="middle">
          {nf(hoverPrice, digits)}
        </text>
        <rect x={tagX} y={H - 17} width={52} height={15} fill="var(--ink)" />
        <text x={tagX + 26} y={H - 6} fill="var(--bg)" fontSize={10} fontWeight={700} textAnchor="middle">{hhmm(hc.t)}</text>
      </g>,
    )
  }

  return (
    <div className="chartbody" ref={wrapRef}>
      <svg
        width={W}
        height={H}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setCursor({ x: e.clientX - r.left, y: e.clientY - r.top })
        }}
        onMouseLeave={() => setCursor(null)}
      >
        {els}
      </svg>
      {hc && (
        <div className="ohlc">
          <span style={{ color: 'var(--ink3)' }}>{hhmm(hc.t)}</span>
          <span>O {nf(hc.o, digits)}</span>
          <span style={{ color: 'var(--up)' }}>H {nf(hc.h, digits)}</span>
          <span style={{ color: 'var(--dn)' }}>L {nf(hc.l, digits)}</span>
          <span style={{ color: hc.c >= hc.o ? 'var(--up)' : 'var(--dn)' }}>C {nf(hc.c, digits)}</span>
        </div>
      )}
    </div>
  )
}
