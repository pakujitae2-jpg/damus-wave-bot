/** run_live_semi.py 가 쓰는 output/live/state.json 의 형태 */
export interface LiveTrade {
  symbol: string
  side: 'LONG' | 'SHORT'
  kind: string
  entry_time: string
  exit_time: string
  entry_price: number
  exit_price: number
  qty: number
  pnl: number
  reason_in: string
  reason_out: string
  fills: number
  balance_after: number
}

export interface LiveSignal {
  ts: string
  symbol: string
  side: 'LONG' | 'SHORT'
  price: number
  qty: number
  stop: number
  margin: number
  reason: string
  tps?: [string, number][]
}

export interface LivePosition {
  side: 'LONG' | 'SHORT'
  entry_time: string
  entry_price: number
  qty: number
  init_qty: number
  stop: number
  tps: [string, number, number][]
  reason: string
  adds: number
  unrealized: number
  margin: number
  deadline: string
  hours_left: number
  liq: number
  exchange_qty: number | null
}

export interface LiveLevel {
  kind: string
  price: number
  note: string
}

export interface LiveEngine {
  pattern: string
  t_low: number | null
  t_high: number | null
  y_low: number | null
  y_high: number | null
  n_long: number
  n_short: number
  open_levels: LiveLevel[]
}

export interface LiveState {
  mode: 'paper' | 'testnet' | 'LIVE'
  seed: number
  started: string | null
  updated?: string
  wallet: number
  equity: number
  equity_curve: { ts: string; balance: number; equity: number }[]
  trades: LiveTrade[]
  signals: LiveSignal[]
  bars: Record<string, number | string>[]
  positions: Record<string, LivePosition>
  external: string[]
  paused: boolean
  engine?: Record<string, LiveEngine>
  prices?: Record<string, number>
  /** 러너가 봉마다 기록하는 증거금 상태 (안전장치 표시용) */
  margin?: {
    wallet: number
    equity: number
    available: number
    used_margin: number
    cap: number
    max_total_margin: number
    reserve: number
    per_symbol: number
  }
  logs: string[]
  last_bar: string | null
  restarts: number
  config: Record<string, string | number | boolean | string[]>
}

/** run_backtest3y.py 가 쓰는 frontend/src/data/backtest.json 의 형태 */
export interface BacktestSymbol {
  symbol: string
  seed: number
  start: string
  end: string
  trades: number
  win_rate: number
  pf: number
  return_pct: number
  final: number
  max_dd_pct: number
  liquidations: number
  avg_hold_h: number
  worst_trade: number
  best_trade: number
  pos_months: string
  by_exit: Record<string, { count: number; sum: number }>
  by_side: Record<string, { count: number; sum: number }>
  yearly: { year: number; count: number; pnl: number }[]
  monthly: { month: string; count: number; pnl: number }[]
  equity: { date: string; equity: number }[]
  trades_tail: {
    side: string
    entry_time: string
    exit_time: string
    entry: number
    exit: number
    pnl: number
    reason_out: string
    reason_in: string
  }[]
}

export interface BacktestData {
  generated: string
  config: Record<string, unknown>
  symbols: Record<string, BacktestSymbol>
}
