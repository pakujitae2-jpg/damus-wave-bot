export function Kpi({ label, value, tone, sub }: { label: string; value: string; tone?: 'up' | 'down'; sub?: string }) {
  return (
    <div className="rounded-md border border-surface bg-surface/40 p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`font-tabular mt-1 text-2xl ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-fg'}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  )
}
