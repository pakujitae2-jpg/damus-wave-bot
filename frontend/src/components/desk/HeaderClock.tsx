import { useEffect, useState } from 'react'
import { Badge } from './StateBadge'

const KST_OFFSET_MS = 9 * 3600 * 1000
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`)

export function formatKst(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
}

/** 09:00 KST 기준 세션 날짜 */
export function sessionDate(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS - 9 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

export function HeaderClock({ lastBar, stale }: { lastBar: string | null; stale: boolean }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (now === null) return <div className="h-8" />
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="font-tabular text-lg text-fg">{formatKst(now)} KST</span>
      <span className="text-muted">세션 {sessionDate(now)}</span>
      {lastBar && <span className="text-muted">마지막 봉 {lastBar.slice(0, 16)}</span>}
      <Badge tone={stale ? 'down' : 'up'}>{stale ? '러너 지연/정지' : '러너 동작 중'}</Badge>
    </div>
  )
}
