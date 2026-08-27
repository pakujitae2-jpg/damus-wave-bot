import { useEffect, useRef, useState } from 'react'

export interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
}

/* 바이낸스 선물 WS(fstream)는 일부 네트워크에서 차단된다 — 실측 확인됨.
   현물 WS(stream.binance.com)는 정상이므로 실시간 표시는 현물 스트림을 쓰고,
   캔들 뼈대만 선물 REST 로 한 번 받아온다. (베이시스 차이는 표시용으로 무시 가능) */
const SPOT_WS = 'wss://stream.binance.com:9443/stream'
const FUT_REST = 'https://fapi.binance.com/fapi/v1/klines'
const SPOT_REST = 'https://api.binance.com/api/v3/klines'

export interface LiveFeed {
  candles: Candle[]
  prices: Record<string, number>
  dirs: Record<string, 'up' | 'dn' | ''>
  connected: boolean
}

/**
 * 차트 심볼의 3분봉 + 구독 심볼 전체의 실시간 체결가를 하나의 WS 로 받는다.
 * @param chartSymbol 캔들을 그릴 심볼 (BTCUSDT)
 * @param tickSymbols 가격만 필요한 심볼들 (SOL/ETH/XRP)
 */
export function useLiveFeed(chartSymbol: string, tickSymbols: string[], interval = '3m', limit = 90): LiveFeed {
  const [candles, setCandles] = useState<Candle[]>([])
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [dirs, setDirs] = useState<Record<string, 'up' | 'dn' | ''>>({})
  const [connected, setConnected] = useState(false)
  const priceRef = useRef<Record<string, number>>({})
  const key = [chartSymbol, ...tickSymbols].join(',')

  useEffect(() => {
    let alive = true
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    const all = [chartSymbol, ...tickSymbols]

    // 캔들 초기 적재 — 선물 우선, 실패 시 현물
    const seed = async () => {
      for (const url of [FUT_REST, SPOT_REST]) {
        try {
          const r = await fetch(`${url}?symbol=${chartSymbol}&interval=${interval}&limit=${limit}`)
          if (!r.ok) continue
          const rows = (await r.json()) as unknown[][]
          if (!alive || !Array.isArray(rows) || rows.length === 0) continue
          setCandles(rows.map((c) => ({
            t: +(c[0] as number), o: +(c[1] as string), h: +(c[2] as string),
            l: +(c[3] as string), c: +(c[4] as string),
          })))
          return
        } catch { /* 다음 소스 */ }
      }
    }
    seed()

    const connect = () => {
      if (!alive) return
      const streams = [
        `${chartSymbol.toLowerCase()}@kline_${interval}`,
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
        let d: Record<string, unknown> | undefined
        try {
          d = (JSON.parse(ev.data as string) as { data?: Record<string, unknown> }).data
        } catch { return }
        if (!d) return

        if (d.e === 'aggTrade') {
          const sym = d.s as string
          const p = +(d.p as string)
          const old = priceRef.current[sym]
          priceRef.current[sym] = p
          setPrices((m) => ({ ...m, [sym]: p }))
          if (old != null && old !== p) setDirs((m) => ({ ...m, [sym]: p > old ? 'up' : 'dn' }))
          // 진행 중 캔들의 종가/고저를 체결가로 즉시 갱신 (kline 이벤트보다 촘촘하다)
          if (sym === chartSymbol) {
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
          }
          return
        }
        const k = d.k as Record<string, unknown> | undefined
        if (!k) return
        const c: Candle = { t: k.t as number, o: +(k.o as string), h: +(k.h as string), l: +(k.l as string), c: +(k.c as string) }
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
      ws?.close()
    }
  }, [key, chartSymbol, interval, limit])

  return { candles, prices, dirs, connected }
}
