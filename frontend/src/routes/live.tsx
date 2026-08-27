import { createFileRoute } from '@tanstack/react-router'
import { Kpi } from '#/components/desk/Kpi'
import { HeaderClock } from '#/components/desk/HeaderClock'
import { EquityChart } from '#/components/desk/EquityChart'
import { TradeTable } from '#/components/desk/TradeTable'
import { SideBadge } from '#/components/desk/StateBadge'
import { useLive } from '#/lib/useLive'
import { fmtPct, fmtUsd } from '#/lib/backtest'

export const Route = createFileRoute('/live')({ component: Live })

function Live() {
  const { st, error, stale } = useLive(15_000)
  if (!st) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">라이브 상세</h1>
        <p className="text-sm text-muted">{error ?? '불러오는 중…'}</p>
      </div>
    )
  }
  const symbols = (st.config.symbols as string[]) ?? []
  const pnl = st.wallet - st.seed
  const wins = st.trades.filter((t) => t.pnl > 0)
  const losses = st.trades.filter((t) => t.pnl <= 0)
  const pf = losses.length ? wins.reduce((a, t) => a + t.pnl, 0) / -losses.reduce((a, t) => a + t.pnl, 0) : wins.length ? Infinity : 0
  const days = st.started ? Math.max(1, (Date.now() - new Date(st.started).getTime()) / 86_400_000) : 1

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">라이브 상세 — {st.mode}</h1>
        <p className="mt-1 text-sm text-muted">가동 {days.toFixed(0)}일 · 재시작 {st.restarts}회 · 갱신 {st.updated?.slice(11, 19)}</p>
      </div>
      <HeaderClock lastBar={st.last_bar} stale={stale} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="지갑" value={fmtUsd(st.wallet)} tone={pnl >= 0 ? 'up' : 'down'} sub={fmtPct((st.wallet / st.seed - 1) * 100)} />
        <Kpi label="실현 손익" value={fmtUsd(pnl)} tone={pnl >= 0 ? 'up' : 'down'} />
        <Kpi label="거래" value={`${st.trades.length}`} sub={`월 환산 ${((st.trades.length / days) * 30).toFixed(1)}건 (백테스트 ~17/종목)`} />
        <Kpi label="승률" value={st.trades.length ? `${((wins.length / st.trades.length) * 100).toFixed(0)}%` : '—'} sub="백테스트 ~60%" />
        <Kpi label="PF" value={st.trades.length ? (pf === Infinity ? '∞' : pf.toFixed(2)) : '—'} sub="백테스트 1.2~1.3" />
        <Kpi label="시그널" value={`${st.signals.length}`} />
      </div>

      {st.equity_curve.length > 1 && (
        <div className="rounded-md border border-surface p-3">
          <EquityChart points={st.equity_curve.map((p) => ({ label: p.ts, equity: p.equity }))} seed={st.seed} />
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">거래 내역</h2>
        <TradeTable showBalance rows={[...st.trades].reverse().map((t) => ({
          symbol: t.symbol, side: t.side, entry_time: t.entry_time, exit_time: t.exit_time, entry: t.entry_price,
          exit: t.exit_price, pnl: t.pnl, reason_out: t.reason_out, reason_in: t.reason_in, balance_after: t.balance_after,
        }))} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">시그널 로그</h2>
        {st.signals.length === 0 ? <p className="text-sm text-muted">아직 시그널 없음.</p> : (
          <div className="overflow-x-auto rounded-md border border-surface">
            <table className="w-full text-xs">
              <thead className="bg-surface/60 text-muted"><tr>
                <th className="px-2 py-2 text-left">시각</th><th className="px-2 py-2 text-left">종목</th><th className="px-2 py-2 text-left">방향</th>
                <th className="px-2 py-2 text-right">가격</th><th className="px-2 py-2 text-right">손절</th><th className="px-2 py-2 text-right">증거금</th><th className="px-2 py-2 text-left">TP</th><th className="px-2 py-2 text-left">근거</th>
              </tr></thead>
              <tbody>
                {[...st.signals].reverse().slice(0, 50).map((s, i) => (
                  <tr key={i} className="border-t border-surface/60">
                    <td className="font-tabular px-2 py-1.5 text-muted">{s.ts}</td>
                    <td className="px-2 py-1.5">{s.symbol.replace('USDT', '')}</td>
                    <td className="px-2 py-1.5"><SideBadge side={s.side} /></td>
                    <td className="font-tabular px-2 py-1.5 text-right">{s.price.toFixed(4)}</td>
                    <td className="font-tabular px-2 py-1.5 text-right text-down">{s.stop.toFixed(4)}</td>
                    <td className="font-tabular px-2 py-1.5 text-right">${s.margin.toFixed(2)}</td>
                    <td className="font-tabular px-2 py-1.5 text-up">{(s.tps ?? []).map(([l, p]) => `${l}@${p.toFixed(3)}`).join(' ')}</td>
                    <td className="max-w-[24rem] truncate px-2 py-1.5 text-muted" title={s.reason}>{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">봉 로그 (최근 20)</h2>
        <div className="overflow-x-auto rounded-md border border-surface">
          <table className="w-full text-xs">
            <thead className="bg-surface/60 text-muted"><tr>
              <th className="px-2 py-2 text-left">봉</th><th className="px-2 py-2 text-right">BTC</th>
              {symbols.map((s) => <th key={s} className="px-2 py-2 text-right">{s.replace('USDT', '')}</th>)}
              {symbols.map((s) => <th key={s + 's'} className="px-2 py-2 text-left">{s.replace('USDT', '')} 상태</th>)}
            </tr></thead>
            <tbody>
              {[...st.bars].reverse().slice(0, 20).map((b, i) => (
                <tr key={i} className="border-t border-surface/60">
                  <td className="font-tabular px-2 py-1.5 text-muted">{String(b.ts)}</td>
                  <td className="font-tabular px-2 py-1.5 text-right">{Number(b.btc).toFixed(1)}</td>
                  {symbols.map((s) => <td key={s} className="font-tabular px-2 py-1.5 text-right">{Number(b[s]).toFixed(4)}</td>)}
                  {symbols.map((s) => <td key={s + 's'} className="px-2 py-1.5 text-muted">{String(b[`${s}_state`] ?? '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">러너 로그</h2>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-bg/60 p-2 text-[11px] text-muted">{[...st.logs].reverse().join('\n') || '-'}</pre>
      </section>
    </div>
  )
}
