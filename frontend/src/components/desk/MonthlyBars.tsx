import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export function MonthlyBars({ rows }: { rows: { month: string; pnl: number; count: number }[] }) {
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-surface)" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: 'var(--color-muted)', fontSize: 10 }} interval={2} axisLine={{ stroke: 'var(--color-surface)' }} />
          <YAxis tick={{ fill: 'var(--color-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--color-surface)' }} width={56} />
          <Tooltip
            contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-muted)', fontSize: 12 }}
            formatter={(v, _n, item) => [`$${Number(v).toFixed(2)} (${(item?.payload as { count: number })?.count ?? 0}건)`, '월 손익']}
          />
          <Bar dataKey="pnl" isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.month} fill={r.pnl >= 0 ? 'var(--color-up)' : 'var(--color-down)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
