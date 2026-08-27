import type { ReactNode } from 'react'

export type Tone = 'up' | 'down' | 'muted' | 'accent'

const TONE_CLASS: Record<Tone, string> = {
  up: 'bg-up/15 text-up border-up/40',
  down: 'bg-down/15 text-down border-down/40',
  muted: 'bg-surface text-muted border-muted/30',
  accent: 'bg-accent/15 text-accent border-accent/40',
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  )
}

export function SideBadge({ side }: { side: 'LONG' | 'SHORT' | string }) {
  return <Badge tone={side === 'LONG' ? 'up' : 'down'}>{side}</Badge>
}

/** 패턴 상태 라벨 (UP dip#1* / DOWN bounce#2 / REV_UP …) → 톤 */
export function PatternBadge({ label }: { label: string }) {
  const tone: Tone = label.startsWith('REV_UP') || label.startsWith('UP') ? 'up' : label.startsWith('REV_DOWN') || label.startsWith('DOWN') ? 'down' : 'muted'
  return <Badge tone={tone}>{label}</Badge>
}

export function ExitBadge({ reason }: { reason: string }) {
  const tone: Tone = reason === 'TP_ALL' ? 'up' : reason === 'SL' || reason === 'LIQ' ? 'down' : reason === 'REV_EXIT' ? 'accent' : 'muted'
  return <Badge tone={tone}>{reason}</Badge>
}
