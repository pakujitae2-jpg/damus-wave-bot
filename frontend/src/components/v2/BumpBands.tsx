import { useEffect, useRef, useState } from 'react'

/* ============================================================
   BUMP BANDS — 랭크 플로우
     최근 5분 동안 심볼들이 수익률 순위를 어떻게 갈아탔는지 밴드로 그린다.
     선이 위로 갈수록 상대 강세. 교차 매매에서 어느 알트가 앞서가는지 한눈에.
   ============================================================ */

const PALETTE = ['#ffb020', '#26e07f', '#4d8dff', '#b06cff', '#22d3ee', '#ff5fd2']
const STEPS = 26

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [s, setS] = useState({ w: 400, h: 150 })
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

export function BumpBands({
  histRef, symbols, tick,
}: {
  histRef: React.MutableRefObject<Record<string, number[]>>
  symbols: string[]
  tick: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const { w: W, h: H } = useSize(wrapRef)

  useEffect(() => {
    const cv = cvRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap) return
    const hist = histRef.current
    const syms = symbols.filter((s) => (hist[s]?.length ?? 0) > 12)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = W * dpr
    cv.height = H * dpr
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const g = (k: string) => getComputedStyle(wrap).getPropertyValue(k).trim() || '#888'
    ctx.fillStyle = g('--panel')
    ctx.fillRect(0, 0, W, H)
    if (syms.length < 2) {
      ctx.fillStyle = g('--ink3')
      ctx.font = '10px "Space Mono", monospace'
      ctx.fillText('표본 수집 중…', 8, 18)
      return
    }

    const PL = 34, PR = 46, PT = 8, PB = 8
    const plotW = W - PL - PR
    const plotH = H - PT - PB
    const n = Math.min(STEPS, Math.min(...syms.map((s) => hist[s].length)))
    if (n < 3) return

    // 각 시점의 순위 계산 (시작값 대비 수익률)
    const ranks: number[][] = [] // [step][symIdx] = rank(0=1등)
    const perf: number[][] = []
    for (let k = 0; k < n; k++) {
      const vals = syms.map((s) => {
        const arr = hist[s]
        const end = arr.length - (n - 1 - k)
        const base = arr[Math.max(0, end - n)] ?? arr[0]
        const cur = arr[end - 1] ?? arr[arr.length - 1]
        return base > 0 ? (cur / base - 1) * 100 : 0
      })
      perf.push(vals)
      const order = vals.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v)
      const r = new Array(syms.length).fill(0)
      order.forEach((o, rank) => { r[o.i] = rank })
      ranks.push(r)
    }

    const rowH = plotH / Math.max(1, syms.length - 1 || 1)
    const X = (k: number) => PL + (k / (n - 1)) * plotW
    const Y = (rank: number) => PT + (syms.length > 1 ? (rank / (syms.length - 1)) * plotH : plotH / 2)

    // 가로 레인
    ctx.strokeStyle = g('--line2')
    ctx.lineWidth = 1
    for (let r = 0; r < syms.length; r++) {
      ctx.beginPath(); ctx.moveTo(PL, Y(r)); ctx.lineTo(PL + plotW, Y(r)); ctx.stroke()
    }

    // 밴드
    syms.forEach((s, si) => {
      const col = PALETTE[si % PALETTE.length]
      ctx.strokeStyle = col
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.beginPath()
      for (let k = 0; k < n; k++) {
        const x = X(k), y = Y(ranks[k][si])
        if (k === 0) ctx.moveTo(x, y)
        else {
          const px = X(k - 1), py = Y(ranks[k - 1][si])
          const mx = (px + x) / 2
          ctx.bezierCurveTo(mx, py, mx, y, x, y)
        }
      }
      ctx.stroke()
      // 끝점 마커
      const lastY = Y(ranks[n - 1][si])
      ctx.fillStyle = col
      ctx.beginPath(); ctx.arc(X(n - 1), lastY, 3.2, 0, Math.PI * 2); ctx.fill()
      // 좌: 심볼 / 우: 수익률
      ctx.font = 'bold 9px "Space Mono", monospace'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillText(s.replace('USDT', ''), 3, Y(ranks[0][si]))
      ctx.textAlign = 'right'
      const pv = perf[n - 1][si]
      ctx.fillStyle = pv >= 0 ? g('--up') : g('--dn')
      ctx.fillText(`${pv >= 0 ? '+' : ''}${pv.toFixed(2)}%`, W - 3, lastY)
    })
    void rowH
  }, [tick, W, H, symbols, histRef])

  return (
    <div className="chartbox" ref={wrapRef}>
      <canvas ref={cvRef} style={{ width: W, height: H }} />
    </div>
  )
}
