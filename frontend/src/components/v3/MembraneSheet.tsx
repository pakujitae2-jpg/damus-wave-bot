import { useEffect, useRef, useState } from 'react'
import type { DepthSnap } from '#/lib/useMarketHub'

/* ============================================================
   BOOK MEMBRANE — ORDER BOOK AS ELASTIC SHEET

   영상 측정으로 확정한 사실
     · 프레임 정합(플롯 내부, 10fps): 가로·세로 이동 0px → 스크롤 없음, 제자리 변형
     · 색 세로 분포: 초록 0~60%(최대 40~50%) / 빨강 55~95%(최대 70~80%) → 경계 55%
     · 색 가로 분포: 균일 → 좌우 분리 없음, 두 막 모두 전폭
     · 확대 관찰: 각 산봉우리 안에 중첩 아치(리브)가 보임
       → 가로줄만이 아니라 세로 메시선까지 그려진 "원근 투영 3D 와이어프레임"

   구현
     2D 필드 f(가격 100노드, 시간 26줄) 를 소실점 원근으로 투영.
     가로줄(시간별 프로파일) + 세로줄(가격별 시간 흐름)을 모두 그려 메시를 만든다.
     중간가 경계 위=매수(초록) 아래=매도(진홍).
   ============================================================ */

const NODES = 100
const ROWS = 26
const COL_EVERY = 4        // 세로 메시선 간격
const PADL = 48
const PADR = 10
const PADT = 12
const PADB = 20
const CENTER = 0.55        // 측정값
const PERSP = 0.62         // 원근 강도 (먼 줄이 작아지는 정도)

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [s, setS] = useState({ w: 640, h: 240 })
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

export function MembraneSheet({
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
    if (all.length < 2) {
      ctx.fillStyle = g('--ink3')
      ctx.font = '10px "Space Mono", monospace'
      ctx.fillText('호가 수집 중…', PADL, 24)
      return
    }

    const stepIdx = Math.max(1, Math.floor(all.length / ROWS))
    const rows: DepthSnap[] = []
    for (let i = all.length - 1; i >= 0 && rows.length < ROWS; i -= stepIdx) rows.unshift(all[i])
    const R = rows.length
    if (R < 3) return

    const plotW = W - PADL - PADR
    const plotH = H - PADT - PADB
    const centerY = PADT + plotH * CENTER
    const upH = centerY - PADT
    const dnH = PADT + plotH - centerY
    const vx = PADL + plotW * 0.5          // 소실점 x

    let maxDist = 0, maxQ = 0
    for (const s of rows) {
      for (const b of s.bids) { const d = s.mid - b.p; if (d > maxDist) maxDist = d; if (b.q > maxQ) maxQ = b.q }
      for (const a of s.asks) { const d = a.p - s.mid; if (d > maxDist) maxDist = d; if (a.q > maxQ) maxQ = a.q }
    }
    if (maxDist <= 0 || maxQ <= 0) return

    // 스냅샷 한쪽을 NODES 개로 리샘플 + 평활화
    const profile = (s: DepthSnap, side: 'bid' | 'ask') => {
      const out = new Float32Array(NODES)
      const src = side === 'bid' ? s.bids : s.asks
      for (const lv of src) {
        const dist = side === 'bid' ? s.mid - lv.p : lv.p - s.mid
        if (dist < 0) continue
        const n = Math.min(NODES - 1, Math.round((dist / maxDist) * (NODES - 1)))
        if (lv.q > out[n]) out[n] = lv.q
      }
      for (let i = 1; i < NODES; i++) if (out[i] === 0) out[i] = out[i - 1] * 0.88
      for (let i = NODES - 2; i >= 0; i--) if (out[i] === 0) out[i] = out[i + 1] * 0.88
      const sm = new Float32Array(NODES)
      for (let i = 0; i < NODES; i++) {
        const a = out[Math.max(0, i - 2)], b = out[Math.max(0, i - 1)], c = out[i]
        const d = out[Math.min(NODES - 1, i + 1)], e = out[Math.min(NODES - 1, i + 2)]
        sm[i] = (a + b * 2 + c * 3 + d * 2 + e) / 9
      }
      return sm
    }

    // ── 두 막의 격자를 미리 계산 (가로줄·세로줄 모두 쓰려면 필요) ──
    type Pt = { x: number; y: number }
    const build = (side: 'bid' | 'ask') => {
      const dir = side === 'bid' ? -1 : 1
      const amp = (side === 'bid' ? upH : dnH) * 0.94
      const grid: Pt[][] = []
      for (let r = 0; r < R; r++) {
        const t = r / (R - 1)                       // 0=과거(멀다), 1=최신(가깝다)
        const sc = 1 - PERSP * (1 - t)              // 먼 줄일수록 작아진다 → 중첩 아치
        const lift = (1 - t) * (side === 'bid' ? upH : dnH) * 0.10 * dir
        const prof = profile(rows[r], side)
        const line: Pt[] = []
        for (let n = 0; n < NODES; n++) {
          const bx = PADL + (n / (NODES - 1)) * plotW
          const by = centerY + dir * (prof[n] / maxQ) * amp
          line.push({
            x: vx + (bx - vx) * sc,
            y: centerY + lift + (by - centerY) * sc,
          })
        }
        grid.push(line)
      }
      return grid
    }

    for (const side of ['bid', 'ask'] as const) {
      const grid = build(side)
      const hue = side === 'bid' ? 148 : 344

      // 세로 메시선 (가격 노드별 시간 흐름) — 먼저 그려 바닥에 깔린다
      for (let n = 0; n < NODES; n += COL_EVERY) {
        ctx.beginPath()
        for (let r = 0; r < R; r++) {
          const p = grid[r][n]
          if (r === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y)
        }
        ctx.strokeStyle = `hsla(${hue}, 85%, 42%, 0.28)`
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // 가로줄 (시간별 프로파일) — 과거 → 최신 순으로 덮어 그린다
      for (let r = 0; r < R; r++) {
        const t = r / (R - 1)
        const alpha = 0.14 + t * 0.82
        const light = 28 + t * 30
        ctx.beginPath()
        grid[r].forEach((p, n) => { if (n === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y) })
        ctx.strokeStyle = `hsla(${hue}, 95%, ${light}%, ${alpha})`
        ctx.lineWidth = r === R - 1 ? 2 : 1
        ctx.stroke()

        if (r === R - 1) {
          ctx.lineTo(grid[r][NODES - 1].x, centerY)
          ctx.lineTo(grid[r][0].x, centerY)
          ctx.closePath()
          ctx.fillStyle = `hsla(${hue}, 92%, ${light}%, 0.10)`
          ctx.fill()
        }
      }
    }

    // ── 경계선(중간가) ──
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(PADL, centerY); ctx.lineTo(PADL + plotW, centerY); ctx.stroke()

    // ── 바닥 기준선 ──
    const floorY = H - PADB + 5
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 1.3
    ctx.beginPath(); ctx.moveTo(PADL, floorY); ctx.lineTo(W - PADR, floorY); ctx.stroke()

    // ── 눈금 / 라벨 ──
    const last = rows[R - 1]
    ctx.font = '8.5px "Space Mono", monospace'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'right'
    ctx.fillStyle = g('--gold')
    ctx.fillText(nf(last.mid), PADL - 5, centerY)
    ctx.fillStyle = g('--ink3')
    ctx.fillText('매수', PADL - 5, centerY - upH * 0.55)
    ctx.fillText('매도', PADL - 5, centerY + dnH * 0.55)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`ORDER BOOK AS ELASTIC SHEET · ${NODES}×${R} NODES`, PADL, 2)

    const topBid = [...last.bids].sort((a, b) => b.q - a.q)[0]
    const topAsk = [...last.asks].sort((a, b) => b.q - a.q)[0]
    if (topBid && topAsk) {
      const isBid = topBid.q >= topAsk.q
      const wall = isBid ? topBid : topAsk
      ctx.textAlign = 'right'
      ctx.font = 'bold 9px "Space Mono", monospace'
      ctx.fillStyle = isBid ? g('--up') : g('--dn')
      ctx.fillText(`${isBid ? 'BID' : 'ASK'} WALL ${nf(wall.p)} · ${wall.q.toFixed(2)}`, W - PADR, 2)
    }

    ctx.font = '8.5px "Space Mono", monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = g('--ink3')
    ctx.fillText('중간가', PADL, H - 3)
    ctx.textAlign = 'right'
    ctx.fillText(`±${maxDist.toFixed(maxDist < 1 ? 4 : 1)}`, W - PADR, H - 3)
  }, [tick, W, H, depthRef])

  return (
    <div className="chartbox" ref={wrapRef}>
      <canvas ref={cvRef} style={{ width: W, height: H }} />
    </div>
  )
}
