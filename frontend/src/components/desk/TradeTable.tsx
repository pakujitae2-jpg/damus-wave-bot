import { ExitBadge, SideBadge } from './StateBadge'

export interface TradeRow {
  symbol?: string
  side: string
  entry_time: string
  exit_time: string
  entry: number
  exit: number
  pnl: number
  reason_out: string
  reason_in: string
  balance_after?: number
}

export function TradeTable({ rows, showBalance = false }: { rows: TradeRow[]; showBalance?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted">거래 없음.</p>
  return (
    <div className="overflow-x-auto rounded-md border border-surface">
      <table className="w-full text-xs">
        <thead className="bg-surface/60 text-muted">
          <tr>
            {rows[0].symbol && <th className="px-2 py-2 text-left">종목</th>}
            <th className="px-2 py-2 text-left">방향</th>
            <th className="px-2 py-2 text-left">진입</th>
            <th className="px-2 py-2 text-left">청산</th>
            <th className="px-2 py-2 text-right">진입가</th>
            <th className="px-2 py-2 text-right">청산가</th>
            <th className="px-2 py-2 text-right">손익</th>
            <th className="px-2 py-2 text-left">사유</th>
            {showBalance && <th className="px-2 py-2 text-right">잔고</th>}
            <th className="px-2 py-2 text-left">근거</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={i} className="border-t border-surface/60">
              {t.symbol && <td className="px-2 py-1.5 text-fg">{t.symbol.replace('USDT', '')}</td>}
              <td className="px-2 py-1.5"><SideBadge side={t.side} /></td>
              <td className="font-tabular px-2 py-1.5 text-muted">{t.entry_time.slice(0, 16)}</td>
              <td className="font-tabular px-2 py-1.5 text-muted">{t.exit_time.slice(0, 16)}</td>
              <td className="font-tabular px-2 py-1.5 text-right">{t.entry.toFixed(4)}</td>
              <td className="font-tabular px-2 py-1.5 text-right">{t.exit.toFixed(4)}</td>
              <td className={`font-tabular px-2 py-1.5 text-right ${t.pnl >= 0 ? 'text-up' : 'text-down'}`}>{t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}</td>
              <td className="px-2 py-1.5"><ExitBadge reason={t.reason_out} /></td>
              {showBalance && <td className="font-tabular px-2 py-1.5 text-right">{t.balance_after?.toFixed(2)}</td>}
              <td className="max-w-[28rem] truncate px-2 py-1.5 text-muted" title={t.reason_in}>{t.reason_in}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
