import { useEffect, useRef, useState } from 'react'

/* ============================================================
   시장 데이터 허브 — 바이낸스 공개 스트림 하나로 v2 데스크 전체를 먹인다.
   선물 WS(fstream)는 이 네트워크에서 차단되므로 현물 스트림(stream.binance.com)을 쓴다.
   ============================================================ */

const SPOT_WS = 'wss://stream.binance.com:9443/stream'
const FUT_REST = 'https://fapi.binance.com/fapi/v1/klines'
const SPOT_REST = 'https://api.binance.com/api/v3/klines'

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export interface Trade { t: number; p: number; q: number; buy: boolean }
export interface BookLevel { p: number; q: number }
export interface Book { bids: BookLevel[]; asks: BookLevel[] }
/** UTC 일봉 = 09:00 KST 세션과 동일 경계 */
export interface Session { high: number; low: number; open: number; close: number }

/** 시간축 뎁스 스냅샷 — 북맵/멤브레인용 */
export interface DepthSnap { t: number; bids: BookLevel[]; asks: BookLevel[]; mid: number }

export interface MarketHub {
  candles: Candle[]
  prices: Record<string, number>
  dirs: Record<string, 'up' | 'dn' | ''>
  trades: Trade[]
  book: Book
  today: Session | null
  yesterday: Session | null
  connected: boolean
  /** 뎁스 이력 (ref — 리렌더 폭주를 막기 위해 상태로 두지 않는다) */
  depthRef: React.MutableRefObject<DepthSnap[]>
  /** 심볼별 가격 이력 (1초 샘플) — 상관행렬·랭크플로우용 */
  histRef: React.MutableRefObject<Record<string, number[]>>
  /** 캔버스 재그리기 신호 (약 12fps) */
  tick: number
}

const MAX_TRADES = 700
const MAX_DEPTH = 260
const MAX_HIST = 300      // 1초 샘플 × 300 = 5분

export function useMarketHub(chartSymbol: string, tickSymbols: string[], interval = '3m', limit = 120): MarketHub {
  const [candles, setCandles] = useState<Candle[]>([])
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [dirs, setDirs] = useState<Record<string, 'up' | 'dn' | ''>>({})
  const [book, setBook] = useState<Book>({ bids: [], asks: [] })
  const [today, setToday] = useState<Session | null>(null)
  const [yesterday, setYesterday] = useState<Session | null>(null)
  const [connected, setConnected] = useState(false)

  // 체결은 초당 수십 건이라 ref 에 모으고 화면은 rAF 로 끊어서 갱신
  const tradeBuf = useRef<Trade[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const priceRef = useRef<Record<string, number>>({})
  const depthRef = useRef<DepthSnap[]>([])
  const histRef = useRef<Record<string, number[]>>({})
  const [tick, setTick] = useState(0)
  const key = [chartSymbol, ...tickSymbols].join(',')

  useEffect(() => {
    let alive = true
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let raf = 0
    const all = [chartSymbol, ...tickSymbols]

    // ── 초기 적재: 분봉 + 일봉 2개(어제/오늘) ──
    const seedKlines = async () => {
      for (const url of [FUT_REST, SPOT_REST]) {
        try {
          const r = await fetch(`${url}?symbol=${chartSymbol}&interval=${interval}&limit=${limit}`)
          if (!r.ok) continue
          const rows = (await r.json()) as unknown[][]
          if (!alive || !Array.isArray(rows) || rows.length === 0) continue
          setCandles(rows.map((c) => ({
            t: +(c[0] as number), o: +(c[1] as string), h: +(c[2] as string),
            l: +(c[3] as string), c: +(c[4] as string), v: +(c[5] as string),
          })))
          return
        } catch { /* 다음 소스 */ }
      }
    }
    const seedDaily = async () => {
      for (const url of [FUT_REST, SPOT_REST]) {
        try {
          const r = await fetch(`${url}?symbol=${chartSymbol}&interval=1d&limit=2`)
          if (!r.ok) continue
          const rows = (await r.json()) as unknown[][]
          if (!alive || rows.length < 2) continue
          const mk = (c: unknown[]): Session => ({
            open: +(c[1] as string), high: +(c[2] as string), low: +(c[3] as string), close: +(c[4] as string),
          })
          setYesterday(mk(rows[0]))
          setToday(mk(rows[1]))
          return
        } catch { /* 다음 소스 */ }
      }
    }
    seedKlines()
    seedDaily()

    let lastTick = 0
    let lastSample = 0
    const flush = (now: number) => {
      if (!alive) return
      if (tradeBuf.current.length) {
        setTrades((old) => {
          const next = [...old, ...tradeBuf.current]
          tradeBuf.current = []
          return next.length > MAX_TRADES ? next.slice(next.length - MAX_TRADES) : next
        })
      }
      // 심볼별 가격 1초 샘플 (상관행렬·랭크플로우)
      if (now - lastSample > 1000) {
        lastSample = now
        for (const s of all) {
          const p = priceRef.current[s]
          if (p == null) continue
          const arr = (histRef.current[s] ??= [])
          arr.push(p)
          if (arr.length > MAX_HIST) arr.shift()
        }
      }
      // 캔버스 재그리기 신호는 약 12fps 로 제한 (뎁스는 초당 10회 들어온다)
      if (now - lastTick > 80) {
        lastTick = now
        setTick((v) => v + 1)
      }
      raf = requestAnimationFrame(flush)
    }
    raf = requestAnimationFrame(flush)

    const connect = () => {
      if (!alive) return
      const lower = chartSymbol.toLowerCase()
      const streams = [
        `${lower}@kline_${interval}`,
        `${lower}@kline_1d`,
        `${lower}@depth20@100ms`,
        ...all.map((s) => `${s.toLowerCase()}@aggTrade`),
      ].join('/')
      ws = new WebSocket(`${SPOT_WS}?streams=${streams}`)
      ws.onopen = () => alive && setConnected(true)
      ws.onerror = () => ws?.close()
      ws.onclose = () => {
        if (!alive) return
        setConnected(false)
        retry = setTimeout(connect, 3000)
      }
      ws.onmessage = (ev) => {
        if (!alive) return
        let msg: { stream?: string; data?: Record<string, unknown> }
        try { msg = JSON.parse(ev.data as string) } catch { return }
        const d = msg.data
        if (!d) return

        // 호가창 — 현재 스냅샷 + 시간축 이력
        if (Array.isArray(d.bids) && Array.isArray(d.asks)) {
          const conv = (rows: unknown) => (rows as [string, string][]).map(([p, q]) => ({ p: +p, q: +q }))
          const bids = conv(d.bids)
          const asks = conv(d.asks)
          setBook({ bids, asks })
          if (bids.length && asks.length) {
            depthRef.current.push({ t: Date.now(), bids, asks, mid: (bids[0].p + asks[0].p) / 2 })
            if (depthRef.current.length > MAX_DEPTH) depthRef.current.shift()
          }
          return
        }

        // 체결
        if (d.e === 'aggTrade') {
          const sym = d.s as string
          const p = +(d.p as string)
          const old = priceRef.current[sym]
          priceRef.current[sym] = p
          setPrices((m) => (m[sym] === p ? m : { ...m, [sym]: p }))
          if (old != null && old !== p) setDirs((m) => ({ ...m, [sym]: p > old ? 'up' : 'dn' }))
          if (sym === chartSymbol) {
            tradeBuf.current.push({ t: d.T as number, p, q: +(d.q as string), buy: !(d.m as boolean) })
            // 진행 중 봉을 체결가로 즉시 갱신
            setCandles((arr) => {
              if (arr.length === 0) return arr
              const next = [...arr]
              const last = { ...next[next.length - 1] }
              last.c = p
              if (p > last.h) last.h = p
              if (p < last.l) last.l = p
              next[next.length - 1] = last
              return next
            })
            setToday((s) => {
              if (!s) return s
              if (p <= s.high && p >= s.low) return { ...s, close: p }
              return { ...s, close: p, high: Math.max(s.high, p), low: Math.min(s.low, p) }
            })
          }
          return
        }

        // 캔들
        const k = d.k as Record<string, unknown> | undefined
        if (!k) return
        const c: Candle = {
          t: k.t as number, o: +(k.o as string), h: +(k.h as string),
          l: +(k.l as string), c: +(k.c as string), v: +(k.v as string),
        }
        if (k.i === '1d') {
          setToday({ open: c.o, high: c.h, low: c.l, close: c.c })
          return
        }
        setCandles((arr) => {
          const next = [...arr]
          const last = next.at(-1)
          if (last && last.t === c.t) next[next.length - 1] = c
          else {
            next.push(c)
            if (next.length > limit) next.shift()
          }
          return next
        })
      }
    }
    connect()

    return () => {
      alive = false
      if (retry) clearTimeout(retry)
      cancelAnimationFrame(raf)
      ws?.close()
    }
  }, [key, chartSymbol, interval, limit])

  return { candles, prices, dirs, trades, book, today, yesterday, connected, depthRef, histRef, tick }
}

/* ---------- 3단계 분석 유틸 ---------- */

/** 피어슨 상관 (수익률 기준) */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 8) return 0
  const ra: number[] = [], rb: number[] = []
  for (let i = a.length - n + 1; i < a.length; i++) ra.push(Math.log(a[i] / a[i - 1]))
  for (let i = b.length - n + 1; i < b.length; i++) rb.push(Math.log(b[i] / b[i - 1]))
  const m = Math.min(ra.length, rb.length)
  if (m < 5) return 0
  const ma = ra.reduce((x, y) => x + y, 0) / m
  const mb = rb.reduce((x, y) => x + y, 0) / m
  let num = 0, da = 0, db = 0
  for (let i = 0; i < m; i++) {
    const x = ra[i] - ma, y = rb[i] - mb
    num += x * y; da += x * x; db += y * y
  }
  const den = Math.sqrt(da * db)
  return den > 0 ? Math.max(-1, Math.min(1, num / den)) : 0
}

/** 6-레짐 마르코프 전이행렬 — (상승/하락) × (저·중·고 변동성) */
export function transitionMatrix(candles: Candle[]): { m: number[][]; counts: number[]; cur: number } {
  const m = Array.from({ length: 6 }, () => new Array(6).fill(0))
  const counts = new Array(6).fill(0)
  if (candles.length < 30) return { m, counts, cur: 0 }
  const rets = candles.slice(1).map((c, i) => Math.log(c.c / candles[i].c))
  const abs = rets.map(Math.abs).slice().sort((x, y) => x - y)
  const q1 = abs[Math.floor(abs.length * 0.33)] ?? 0
  const q2 = abs[Math.floor(abs.length * 0.66)] ?? 0
  const stateOf = (r: number) => {
    const vol = Math.abs(r) <= q1 ? 0 : Math.abs(r) <= q2 ? 1 : 2
    return (r >= 0 ? 0 : 3) + vol
  }
  const states = rets.map(stateOf)
  for (let i = 0; i < states.length - 1; i++) {
    m[states[i]][states[i + 1]]++
    counts[states[i]]++
  }
  for (let i = 0; i < 6; i++) {
    const tot = m[i].reduce((a, b) => a + b, 0)
    if (tot > 0) for (let j = 0; j < 6; j++) m[i][j] /= tot
  }
  return { m, counts, cur: states[states.length - 1] ?? 0 }
}

/** RSI(period) 마지막 값 시계열 */
export function rsiSeries(candles: Candle[], period = 14): number[] {
  const out: number[] = []
  let gain = 0, loss = 0
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i].c - candles[i - 1].c
    const g = Math.max(0, d), l = Math.max(0, -d)
    if (i <= period) {
      gain += g; loss += l
      out.push(NaN)
      if (i === period) {
        gain /= period; loss /= period
        out[out.length - 1] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
      }
    } else {
      gain = (gain * (period - 1) + g) / period
      loss = (loss * (period - 1) + l) / period
      out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss))
    }
  }
  return out
}

/** 롤링 VWAP + 표준편차 밴드 */
export function vwapBands(candles: Candle[]): { vwap: number[]; up: number[]; dn: number[] } {
  const vwap: number[] = [], up: number[] = [], dn: number[] = []
  let pv = 0, vol = 0, pv2 = 0
  for (const c of candles) {
    const tp = (c.h + c.l + c.c) / 3
    pv += tp * c.v
    pv2 += tp * tp * c.v
    vol += c.v
    const v = vol > 0 ? pv / vol : tp
    const varr = vol > 0 ? Math.max(0, pv2 / vol - v * v) : 0
    const sd = Math.sqrt(varr)
    vwap.push(v); up.push(v + sd); dn.push(v - sd)
  }
  return { vwap, up, dn }
}

/* ---------- 파생 계산 ---------- */

/** 파인스크립트와 동일한 피보나치 비율 */
export const FIB = [0.146, 0.236, 0.382, 0.5, 0.618, 0.764, 0.854] as const

export function fibLevels(low: number, high: number): Record<string, number> {
  const r = high - low
  return Object.fromEntries(FIB.map((f) => [String(f), low + r * f]))
}

/** 단순이동평균 리본 — 기간 배열별 마지막 N개 값 */
export function maRibbon(candles: Candle[], periods: number[]): number[][] {
  return periods.map((p) => {
    const out: number[] = []
    let sum = 0
    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].c
      if (i >= p) sum -= candles[i - p].c
      out.push(i >= p - 1 ? sum / p : NaN)
    }
    return out
  })
}
