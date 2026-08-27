import type { LiveEngine, LivePosition } from '#/lib/types'
import { Badge, PatternBadge, SideBadge } from './StateBadge'

const f4 = (v: number | null | undefined) => (v == null ? '-' : v >= 1000 ? v.toFixed(1) : v.toFixed(4))

/** 참고 대시보드의 "코인 카드": 가격 · 보유 · 손절/목표/48h · 겹침 카운트 · BTC 파동 상태를 한 카드에 */
export function SymbolCard({
  symbol, price, pos, engine, external, busy, onClose,
}: {
  symbol: string
  price?: number
  pos?: LivePosition
  engine?: LiveEngine
  external: boolean
  busy: boolean
  onClose: () => void
}) {
  const unreal = pos ? pos.unrealized : 0
  const roe = pos && pos.margin > 0 ? (unreal / pos.margin) * 100 : 0
  const hoursLeft = pos ? Math.max(0, pos.hours_left) : 0
  const urgent = pos ? hoursLeft < 6 : false
  return (
    <div className="rounded-xl border border-surface bg-surface/40 p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-base font-semibold text-fg">{symbol.replace('USDT', '/USDT')}</h3>
        <div className="flex items-center gap-2">
          {engine && <PatternBadge label={engine.pattern} />}
          {external && <Badge tone="accent">외부 포지션 · 진입 보류</Badge>}
        </div>
      </div>
      <div className="font-tabular text-2xl font-bold text-fg">{f4(price)}</div>

      {pos ? (
        <div className="mt-2 rounded-md border border-surface bg-bg/60 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SideBadge side={pos.side} />
              <span className="font-tabular text-muted">진입 {f4(pos.entry_price)} · {pos.entry_time.slice(5, 16)}{pos.adds ? ' · 분할+1' : ''}</span>
            </div>
            <span className={`font-tabular text-base font-semibold ${unreal >= 0 ? 'text-up' : 'text-down'}`}>
              {unreal >= 0 ? '+' : ''}{unreal.toFixed(2)} <span className="text-xs font-normal">({roe >= 0 ? '+' : ''}{roe.toFixed(1)}%)</span>
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Cell k="수량" v={pos.qty.toFixed(4)} />
            <Cell k="증거금" v={`$${pos.margin.toFixed(2)}`} />
            <Cell k="손절" v={f4(pos.stop)} tone="down" />
            <Cell k="강제청산" v={pos.liq ? f4(pos.liq) : '-'} tone="down" />
            <Cell k="48h 남음" v={`${hoursLeft.toFixed(1)}h`} tone={urgent ? 'down' : undefined} />
            <Cell k="거래소 수량" v={pos.exchange_qty == null ? '-' : Math.abs(pos.exchange_qty).toFixed(4)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {pos.tps.map(([l, p, q], i) => (
              <span key={i} className="rounded border border-up/40 px-1.5 py-0.5 font-tabular text-up">TP {l} {f4(p)} ×{q.toFixed(3)}</span>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="truncate text-muted" title={pos.reason}>{pos.reason}</span>
            <button type="button" disabled={busy} onClick={onClose}
              className="shrink-0 rounded-md border border-down/50 bg-down/10 px-3 py-1 text-xs text-down hover:bg-down/20 disabled:opacity-50">
              시장가 청산
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">{external ? '사용자 포지션 감지 — 봇은 대기' : '포지션 없음 — 겹침 3개 대기'}</p>
      )}

      {engine && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Cell k="롱 이유" v={`${engine.n_long} / 3`} tone={engine.n_long >= 3 ? 'up' : undefined} />
          <Cell k="숏 이유" v={`${engine.n_short} / 3`} tone={engine.n_short >= 3 ? 'down' : undefined} />
          <Cell k="BTC T 저~고" v={`${engine.t_low?.toFixed(0) ?? '-'} ~ ${engine.t_high?.toFixed(0) ?? '-'}`} />
          <Cell k="BTC 전일 저~고" v={`${engine.y_low?.toFixed(0) ?? '-'} ~ ${engine.y_high?.toFixed(0) ?? '-'}`} />
        </div>
      )}
      {engine && engine.open_levels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {engine.open_levels.slice(-10).map((lv, i) => (
            <span key={i} className="rounded border border-surface px-1.5 py-0.5 font-tabular text-[11px] text-muted" title={lv.note}>{lv.kind} {lv.price.toFixed(0)}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function Cell({ k, v, tone }: { k: string; v: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-md border border-surface bg-bg/50 px-2 py-1.5">
      <div className="text-[10.5px] text-muted">{k}</div>
      <div className={`font-tabular font-semibold ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-fg'}`}>{v}</div>
    </div>
  )
}
