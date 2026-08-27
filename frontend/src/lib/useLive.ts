import { useCallback, useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { readLiveState, sendCommand } from './liveState'
import type { LiveState } from './types'

export function useLive(intervalMs = 10_000) {
  const load = useServerFn(readLiveState)
  const send = useServerFn(sendCommand)
  const [st, setSt] = useState<LiveState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    return load()
      .then((s) => { setSt(s); setError(s ? null : 'output/live/state.json 없음 — run_live_semi.py 실행 여부 확인') })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [load])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, intervalMs)
    return () => clearInterval(id)
  }, [refresh, intervalMs])

  const command = useCallback(async (data: { close?: string[]; pause?: boolean }) => {
    setBusy(true)
    try {
      await send({ data })
      setTimeout(refresh, 6000)
    } finally {
      setTimeout(() => setBusy(false), 6000)
    }
  }, [send, refresh])

  const stale = st?.updated ? Date.now() - new Date(st.updated).getTime() > 10 * 60_000 : true
  return { st, error, busy, stale, command, refresh }
}
