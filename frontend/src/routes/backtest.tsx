import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Kpi } from '#/components/desk/Kpi'
import { EquityChart } from '#/components/desk/EquityChart'
import { MonthlyBars } from '#/components/desk/MonthlyBars'
import { TradeTable } from '#/components/desk/TradeTable'
import { backtest, fmtPct, fmtUsd, symbolList } from '#/lib/backtest'

export const Route = createFileRoute('/backtest')({ component: Backtest })

function Backtest() {
  const list = symbolList()
  const [sel, setSel] = useState(list[0]?.symbol ?? '')
  const s = list.find((x) => x.symbol === sel)

  if (!s) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">백테스트 3년</h1>
        <p className="text-sm text-muted">결과 없음 — `python run_backtest3y.py` 실행 후 `frontend/src/data/backtest.json` 이 생성됩니다.</p>
      </div>
    )
  }
  const cfg = backtest.config as Record<string, string | number | boolean>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">백테스트 3년 — 교차 보유형</h1>
        <p className="mt-1 text-sm text-muted">
          {s.start} ~ {s.end} · 시그널 {String(cfg.signal)} · β {String(cfg.beta)} · {String(cfg.leverage)}배 · 증거금 {Number(cfg.margin_fraction) * 100}% · {String(cfg.hold)} · 손절 상한 {Number(cfg.max_sl_pct) * 100}% · 수수료 {Number(cfg.fee) * 100}% · 복리 · 시드 ${s.seed}
        </p>
      </div>

      <div className="flex gap-1 text-sm">
        {list.map((x) => (
          <button key={x.symbol} type="button" onClick={() => setSel(x.symbol)}
            className={`rounded-md px-3 py-1.5 ${x.symbol === sel ? 'bg-surface text-accent' : 'text-muted hover:bg-surface hover:text-fg'}`}>
            {x.symbol.replace('USDT', '/USDT')}{x.symbol === 'XRPUSDT' ? ' (참고)' : ''}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Kpi label="최종 잔고" value={fmtUsd(s.final)} tone={s.return_pct >= 0 ? 'up' : 'down'} sub={fmtPct(s.return_pct)} />
        <Kpi label="PF" value={s.pf.toFixed(2)} tone={s.pf >= 1 ? 'up' : 'down'} />
        <Kpi label="최대 낙폭" value={`${s.max_dd_pct.toFixed(1)}%`} tone="down" />
        <Kpi label="거래" value={`${s.trades}`} sub={`승률 ${(s.win_rate * 100).toFixed(1)}% · 평균 보유 ${s.avg_hold_h}h`} />
        <Kpi label="흑자 월" value={s.pos_months} />
        <Kpi label="최악 / 최고 거래" value={`${fmtUsd(s.worst_trade, 0)} / ${fmtUsd(s.best_trade, 0)}`} sub={`강제청산 ${s.liquidations}회`} />
      </div>

      <div className="rounded-md border border-surface p-3">
        <h2 className="mb-1 text-sm font-medium text-muted">누적 잔고 (일별, 복리)</h2>
        <EquityChart points={s.equity.map((p) => ({ label: p.date, equity: p.equity }))} seed={s.seed} height={280} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-md border border-surface p-3 md:col-span-2">
          <h2 className="mb-1 text-sm font-medium text-muted">월별 손익</h2>
          <MonthlyBars rows={s.monthly} />
        </div>
        <div className="rounded-md border border-surface p-3 text-xs">
          <h2 className="mb-2 text-sm font-medium text-muted">연도별 / 청산 사유 / 방향</h2>
          <table className="w-full">
            <tbody>
              {s.yearly.map((y) => (
                <tr key={y.year} className="border-t border-surface/60"><td className="py-1 text-muted">{y.year}</td><td className="font-tabular py-1 text-right">{y.count}건</td><td className={`font-tabular py-1 text-right ${y.pnl >= 0 ? 'text-up' : 'text-down'}`}>{fmtUsd(y.pnl)}</td></tr>
              ))}
              {Object.entries(s.by_exit).map(([k, v]) => (
                <tr key={k} className="border-t border-surface/60"><td className="py-1 text-muted">{k}</td><td className="font-tabular py-1 text-right">{v.count}건</td><td className={`font-tabular py-1 text-right ${v.sum >= 0 ? 'text-up' : 'text-down'}`}>{fmtUsd(v.sum)}</td></tr>
              ))}
              {Object.entries(s.by_side).map(([k, v]) => (
                <tr key={k} className="border-t border-surface/60"><td className="py-1 text-muted">{k}</td><td className="font-tabular py-1 text-right">{v.count}건</td><td className={`font-tabular py-1 text-right ${v.sum >= 0 ? 'text-up' : 'text-down'}`}>{fmtUsd(v.sum)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">최근 거래 60건</h2>
        <TradeTable rows={[...s.trades_tail].reverse()} />
      </section>
    </div>
  )
}
