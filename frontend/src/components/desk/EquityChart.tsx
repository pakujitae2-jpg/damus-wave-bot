import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface EquityPoint {
  label: string
  equity: number
}

export function EquityChart({ points, seed, height = 256 }: { points: EquityPoint[]; seed: number; height?: number }) {
  const data = points.map((p, i) => ({ i, label: p.label, equity: p.equity }))
  const last = data.at(-1)?.equity ?? seed
  const color = last >= seed ? 'var(--color-up)' : 'var(--color-down)'
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-surface)" vertical={false} />
          <XAxis dataKey="i" tick={false} axisLine={{ stroke: 'var(--color-surface)' }} />
          <YAxis tick={{ fill: 'var(--color-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--color-surface)' }} width={64} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-muted)', fontSize: 12 }}
            labelFormatter={(i) => data[i as number]?.label ?? ''}
            formatter={(v) => [`$${Number(v).toFixed(2)}`, `잔고 (시드 $${seed})`]}
          />
          <Area type="monotone" dataKey="equity" stroke={color} fill="url(#eqFill)" strokeWidth={1.5} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
