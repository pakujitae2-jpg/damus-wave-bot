import raw from '../data/backtest.json'
import type { BacktestData, BacktestSymbol } from './types'

export const backtest = raw as unknown as BacktestData

export function symbolList(): BacktestSymbol[] {
  return Object.values(backtest.symbols)
}

export function fmtUsd(v: number, digits = 2): string {
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(digits)}`
}

export function fmtPct(v: number, digits = 1): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}
