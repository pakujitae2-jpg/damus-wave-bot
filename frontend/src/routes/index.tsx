import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { FibChart } from '#/components/v2/FibChart'
import { useMarketHub } from '#/lib/useMarketHub'
import { useLive } from '#/lib/useLive'
import type { LivePosition, LiveState } from '#/lib/types'

export const Route = createFileRoute('/')({ component: Home })

const SIGNAL = 'BTCUSDT'
const BAND = 0.04
const NEED = 3
const DEFAULT_SYMS = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT']

const dec = (p: number) => (p >= 1000 ? 1 : p >= 1 ? 3 : 4)
const nf = (v: number | null | undefined, d = 2) =>
  v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const usd = (v: number, d = 2) => `${v < 0 ? '−' : ''}$${nf(Math.abs(v), d)}`
const sgn = (v: number, d = 2) => `${v >= 0 ? '+' : '−'}${nf(Math.abs(v), d)}`

function useTheme() {
  const [t, setT] = useState<'light' | 'dark'>('dark')
  useEffect(() => {
    let saved: 'light' | 'dark' = 'dark'
    try {
      saved = (localStorage.getItem('v2theme') as 'light' | 'dark' | null)
        ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    } catch { /* 무시 */ }
    setT(saved)
  }, [])
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', t)
    try { localStorage.setItem('v2theme', t) } catch { /* 무시 */ }
  }, [t])
  return [t, () => setT((x) => (x === 'dark' ? 'light' : 'dark'))] as const
}

function Clock() {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (now == null) return <div className="clock">--:--:-- KST</div>
  const d = new Date(now + 9 * 3600e3)
  const p = (x: number) => String(x).padStart(2, '0')
  return <div className="clock num">■ {p(d.getUTCHours())}:{p(d.getUTCMinutes())}:{p(d.getUTCSeconds())} KST</div>
}

function Home() {
  const { st, error, busy, stale, command } = useLive(10_000)
  const [theme, toggle] = useTheme()
  const symbols = (st?.config.symbols as string[]) ?? DEFAULT_SYMS
  const { candles, prices, dirs, today, yesterday, connected } = useMarketHub(SIGNAL, symbols, '3m', 120)

  const eng = st?.engine?.[symbols[0]]
  const levels = eng?.open_levels ?? []
  const price = prices[SIGNAL] ?? candles.at(-1)?.c ?? null

  const nLong = price ? levels.filter((l) => l.price > price && l.price <= price * (1 + BAND)).length : eng?.n_long ?? 0
  const nShort = price ? levels.filter((l) => l.price < price && l.price >= price * (1 - BAND)).length : eng?.n_short ?? 0

  const chg = today ? ((price ?? today.close) / today.open - 1) * 100 : null
  const hi = today?.high ?? null
  const lo = today?.low ?? null

  const trades = st?.trades ?? []
  const wins = trades.filter((t) => t.pnl > 0)
  const realized = st ? st.wallet - st.seed : 0
  const unreal = st ? Object.values(st.positions).reduce((a, p) => a + p.unrealized, 0) : 0
  const held = st ? Object.keys(st.positions).length : 0
  const today10 = new Date().toISOString().slice(0, 10)
  const todayN = trades.filter((t) => t.exit_time.slice(0, 10) === today10).length
  const best = wins.length ? Math.max(...wins.map((t) => t.pnl)) : null

  const markers = st
    ? Object.entries(st.positions).map(([sym, p]) => ({
        t: new Date(p.entry_time.replace(' ', 'T')).getTime(), price: p.entry_price, side: p.side, symbol: sym,
      }))
    : []

  const sigCls = held > 0 ? 'sig hold' : st?.paused ? 'sig off' : nLong >= NEED || nShort >= NEED ? 'sig on' : 'sig'
  const sigText = held > 0 ? `IN POSITION · ${held}종목`
    : st?.paused ? 'PAUSED · 진입 정지'
    : nLong >= NEED ? 'LONG READY · 조건 충족'
    : nShort >= NEED ? 'SHORT READY · 조건 충족'
    : 'WAIT · 겹침 대기'
  const modeLabel = st?.mode === 'LIVE' ? '● 실계좌 LIVE' : st?.mode === 'testnet' ? '◐ TESTNET' : st?.mode === 'paper' ? '○ PAPER' : '—'

  return (
    <div className="v2">
      <div className="wrap">

        {/* ── 헤더 ── */}
        <div className="hdr">
          <div className="logo">
            <div className="mark">D</div>
            <div>
              <div className="t1">DAMUS × SEMI-AUTO</div>
              <div className="t2">BTC 겹침 시그널 · SOL/ETH/XRP 반자동 선물</div>
            </div>
          </div>
          <div className="nav">
            <i>CONFLUENCE</i> ■ <i>SEMI</i> ■
            <Link to="/v2">v2</Link>
            <Link to="/v3">v3</Link>
            <Link to="/live">상세</Link>
            <Link to="/backtest">백테스트</Link>
            <Link to="/spec">규칙</Link>
          </div>
          <div className="right">
            <button type="button" className={`tgl ${st?.paused ? 'danger' : ''}`} disabled={busy || !st}
              onClick={() => command({ pause: !st?.paused })}>
              {st?.paused ? '진입 재개' : '진입 정지'}
            </button>
            <button type="button" className="tgl gold" onClick={toggle}>{theme === 'dark' ? '☀ LIGHT' : '☾ DARK'}</button>
            <Clock />
          </div>
        </div>

        {/* ── 히어로 + 대형 가격 ── */}
        <div className="hero">
          <div>
            <div className="lab">지갑 자본 · 복리</div>
            <div className="eq">
              {st ? usd(st.wallet) : '$—'}
              <small className={realized >= 0 ? 'pos' : 'neg'}>{st ? sgn(realized) : ''}</small>
            </div>
            <div className="sub">
              시드 ${st ? nf(st.seed, 0) : '—'} · 미실현 <b className={unreal >= 0 ? 'pos' : 'neg'}>{st ? sgn(unreal) : '—'}</b>
            </div>
          </div>
          <div className="c">
            <div className={`big num ${dirs[SIGNAL] ?? ''}`}>
              {nf(price, 1)}
              <small className={chg == null ? '' : chg >= 0 ? 'pos' : 'neg'}>{chg == null ? '' : `${sgn(chg)}%`}</small>
              <span className={`tick ${dirs[SIGNAL] === 'up' ? 'pos' : dirs[SIGNAL] === 'dn' ? 'neg' : ''}`}>
                {dirs[SIGNAL] === 'up' ? '▲' : dirs[SIGNAL] === 'dn' ? '▼' : ''}
              </span>
            </div>
            <div className="sub">BTC/USDT 시그널 · 체결 {symbols.map((s) => s.replace('USDT', '')).join('/')} · 10배 격리</div>
          </div>
          <div className="r">
            <div className="lab">{modeLabel}</div>
            <div className="sub">익절 수동 · 48h 무조치 시 시장가</div>
            <div className="sub">
              {connected ? <b className="pos">● 실시간</b> : <b className="neg">○ 재연결</b>}
              {' · '}
              {stale ? <b className="neg">러너 정지</b> : <>러너 <b className="blue-c">{st?.last_bar?.slice(11, 16) ?? '—'}</b></>}
            </div>
          </div>
        </div>

        {/* ── 스탯 ── */}
        <div className="stats">
          <div><div className="k">Trades</div><div className="v">{trades.length}</div><div className="n">오늘 {todayN}회</div></div>
          <div><div className="k">Win rate</div><div className="v purple-c">{trades.length ? `${Math.round((wins.length / trades.length) * 100)}%` : '—'}</div><div className="n">백테스트 ~60%</div></div>
          <div><div className="k">실현 손익</div><div className={`v ${realized >= 0 ? 'pos' : 'neg'}`}>{st ? usd(realized) : '—'}</div><div className="n">최고 {best == null ? '—' : usd(best)}</div></div>
          <div><div className="k">보유 · 미실현</div><div className={`v ${unreal >= 0 ? 'pos' : 'neg'}`}>{held} · {st ? sgn(unreal) : '—'}</div><div className="n">{st?.external.length ? `외부 ${st.external.join(',')}` : '외부 없음'}</div></div>
        </div>

        {/* ── 본문 3열 : 상태 · 차트 · 흐름/로그 ── */}
        <div className="v1main">
          {/* 좌 : 상태 */}
          <div className="v1col">
            <div className="box">
              <div className="trans">
                <div className="st cur"><b>{eng?.pattern.split(' ')[0] ?? '—'}</b><span>{eng?.pattern.split(' ')[1] ?? 'BTC'}</span></div>
                <div className="arrow">→<div>{NEED}개</div></div>
                <div className="st"><b className={held > 0 ? 'gold-c' : nLong >= NEED ? 'pos' : nShort >= NEED ? 'neg' : ''}>
                  {held > 0 ? 'HOLD' : nLong >= NEED ? 'LONG' : nShort >= NEED ? 'SHORT' : 'WAIT'}
                </b><span>next</span></div>
              </div>
              <div className="kv">
                <span>롱 <em className={nLong >= NEED ? 'pos' : ''}>{nLong}/{NEED}</em></span>
                <span>숏 <em className={nShort >= NEED ? 'neg' : ''}>{nShort}/{NEED}</em></span>
                <span>T <em className="num">{nf(eng?.t_low, 0)}~{nf(eng?.t_high, 0)}</em></span>
                <span>전일 <em className="num">{nf(eng?.y_low, 0)}~{nf(eng?.y_high, 0)}</em></span>
              </div>
              <div className={sigCls}>{sigText}</div>
              <div className="tri">
                <div><b className="purple-c">{levels.length}</b><span>미해소</span></div>
                <div><b className="pos">{nLong}</b><span>밴드 위</span></div>
                <div><b className="neg">{nShort}</b><span>밴드 아래</span></div>
              </div>
            </div>
            <div className="box grow">
              <div className="sec" style={{ marginBottom: 5 }}>미해소 레벨</div>
              {levels.length === 0 ? (
                <div className="n">없음 — 형성 대기</div>
              ) : (
                [...levels].sort((a, b) => b.price - a.price).slice(0, 12).map((l, i) => {
                  const inb = price ? Math.abs(l.price - price) / price <= BAND : false
                  const above = price ? l.price > price : false
                  return (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', gap: 6,
                      fontSize: 10.5, padding: '1px 0', opacity: inb ? 1 : 0.45,
                    }}>
                      <span className={l.kind === 'SOP' ? 'purple-c' : l.kind.startsWith('RETEST') ? 'blue-c' : 'cyan-c'}>
                        {l.kind.replace('RETEST_', 'RT').replace('HW_', '9')}
                      </span>
                      <span className="num">{nf(l.price, 0)}</span>
                      <span className={above ? 'pos' : 'neg'}>
                        {price ? `${above ? '▲' : '▼'}${nf(Math.abs((l.price / price - 1) * 100), 2)}%` : ''}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* 중앙 : 차트 (v2와 동일) */}
          <div className="chartwrap">
            <div className="chart-h">
              <div className="t">BTC / USDT · 3M · 어제+오늘 피보</div>
              <div className="m">
                <span>H <b className="num pos">{nf(hi, 0)}</b></span>
                <span>L <b className="num neg">{nf(lo, 0)}</b></span>
                <b className="num gold-c">{nf(price, 1)}</b>
                <span className={`chg num ${chg == null ? '' : chg >= 0 ? 'up' : 'dn'}`}>{chg == null ? '—' : `${sgn(chg)}%`}</span>
                <span className={`ws ${connected ? 'on' : 'off'}`}>{connected ? '● LIVE' : '○ RETRY'}</span>
              </div>
            </div>
            <FibChart candles={candles} price={price} today={today} yesterday={yesterday} markers={markers} />
          </div>

          {/* 우 : 반자동 흐름 + 로그 */}
          <div className="v1col">
            <div className="steps">
              <div className={`step ${held === 0 && !st?.paused ? 'on' : ''}`}>
                <div className="no">01</div>
                <div><div className="tt">겹침 대기 · 자동 진입</div><div className="dd">레벨 3개 겹치면 시장가 + 손절 + TP</div></div>
              </div>
              <div className={`step ${held > 0 ? 'on' : ''}`}>
                <div className="no">02</div>
                <div><div className="tt">보유 · 익절은 직접</div><div className="dd">앱에서 전량·부분 청산 자유</div></div>
              </div>
              <div className={`step ${Object.values(st?.positions ?? {}).some((p) => p.hours_left < 6) ? 'on' : ''}`}>
                <div className="no">03</div>
                <div><div className="tt">48시간 · 시장가 청산</div><div className="dd">무조치 시 자동 종료 후 재탐색</div></div>
              </div>
            </div>
            <div className="term">
              <div className="th">
                <div className="ic">✈</div>
                <div><b>run_live_semi.py</b><span>{stale ? 'STALE' : 'ONLINE'} · {st?.mode ?? '—'}</span></div>
              </div>
              <div className="rep">
                <div>TRADES<b>{trades.length}</b></div>
                <div>WIN<b>{trades.length ? `${Math.round((wins.length / trades.length) * 100)}%` : '—'}</b></div>
                <div>P/L<b className={realized >= 0 ? 'pos' : 'neg'}>{st ? usd(realized, 0) : '—'}</b></div>
              </div>
              {[...trades].reverse().slice(0, 2).map((t, i) => (
                <div className="line" key={i}>
                  <span className="f">{t.reason_out.slice(0, 10)}</span>
                  {t.symbol.replace('USDT', '')} {t.side} ·{' '}
                  <span className={t.pnl >= 0 ? 'pos' : 'neg'}>{sgn(t.pnl)}</span>
                </div>
              ))}
              {[...(st?.logs ?? [])].reverse().slice(0, 4).map((l, i) => (
                <div className="line" key={`l${i}`} style={{ opacity: 0.75, borderStyle: 'dashed' }}>{l}</div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 포지션 4칸 ── */}
        <div className="stack">
          {symbols.map((s) => (
            <PosBox key={s} symbol={s} pos={st?.positions[s]} price={prices[s] ?? st?.prices?.[s]}
              dir={dirs[s] ?? ''} external={!!st?.external.includes(s)} busy={busy}
              onClose={() => { if (confirm(`${s} 시장가 청산?`)) command({ close: [s] }) }} />
          ))}
          <div className="box">
            <span className="tag acct">ACCOUNT</span>
            <div className="name gold-c">{st ? usd(st.equity) : '—'}</div>
            <div className="d">
              지갑 <em>{st ? usd(st.wallet, 0) : '—'}</em> · 가용 <em>{st?.margin ? usd(st.margin.available, 0) : '—'}</em><br />
              증거금 <em>{st?.margin ? `${nf(st.margin.used_margin, 0)}/${nf(st.margin.cap, 0)}` : '—'}</em> · <em>{String(st?.config.leverage ?? 10)}배</em>
            </div>
            <div className="foot"><span>{st?.mode ?? '—'}</span><span>재시작 {st?.restarts ?? 0}회</span></div>
          </div>
        </div>

        {/* ── 티커 ── */}
        {error ? (
          <div className="warn">{error}</div>
        ) : st && st.external.length > 0 ? (
          <div className="warn">외부 포지션 {st.external.join(', ')} — 봇은 건드리지 않고 진입만 보류합니다.</div>
        ) : (
          <Ticker st={st} levels={levels} prices={prices} price={price} today={today} />
        )}
      </div>
    </div>
  )
}

function PosBox({ symbol, pos, price, dir, external, busy, onClose }: {
  symbol: string
  pos?: LivePosition
  price?: number
  dir: 'up' | 'dn' | ''
  external: boolean
  busy: boolean
  onClose: () => void
}) {
  const short = symbol.replace('USDT', '')
  const d = price ? dec(price) : 3
  const priceCls = dir === 'up' ? 'pos' : dir === 'dn' ? 'neg' : ''
  if (!pos) {
    return (
      <div className="box">
        <span className={`tag ${external ? 'ext' : ''}`}>{short}</span>
        <div className={`name ${priceCls}`}>{nf(price, d)}</div>
        <div className="d">{external ? '외부 포지션 — 진입 보류' : '포지션 없음 · 겹침 대기'}</div>
        <div className="foot"><span>대기</span><span className={external ? 'gold-c' : 'blue-c'}>{external ? 'EXTERNAL' : 'READY'}</span></div>
      </div>
    )
  }
  const roe = pos.margin > 0 ? (pos.unrealized / pos.margin) * 100 : 0
  const pd = dec(pos.entry_price)
  return (
    <div className="box">
      <span className={`tag ${pos.side === 'LONG' ? 'long' : 'short'}`}>{short} {pos.side}</span>
      <div className={`name ${pos.unrealized >= 0 ? 'pos' : 'neg'}`}>
        {sgn(pos.unrealized)} <span style={{ fontSize: 11 }}>({sgn(roe, 1)}%)</span>
      </div>
      <div className="d">
        현재 <em className={priceCls}>{nf(price, d)}</em> · 진입 <em>{nf(pos.entry_price, pd)}</em><br />
        손절 <em className="neg">{nf(pos.stop, pd)}</em> · 증거금 <em>${nf(pos.margin, 0)}</em>
      </div>
      <div className="foot">
        <span>48h <b className={pos.hours_left < 6 ? 'neg' : 'blue-c'}>{Math.max(0, pos.hours_left).toFixed(1)}h</b></span>
        <button type="button" className="btn" style={{ margin: 0, padding: '1px 7px' }} disabled={busy} onClick={onClose}>청산</button>
      </div>
    </div>
  )
}

function Ticker({ st, levels, prices, price, today }: {
  st: LiveState | null
  levels: { kind: string; price: number }[]
  prices: Record<string, number>
  price: number | null
  today: { high: number; low: number } | null
}) {
  const items: string[] = []
  if (price) items.push(`BTC ${nf(price, 1)}`)
  for (const s of (st?.config.symbols as string[]) ?? []) {
    const p = prices[s] ?? st?.prices?.[s]
    if (p) items.push(`${s.replace('USDT', '')} ${nf(p, dec(p))}`)
  }
  if (today) {
    const r = today.high - today.low
    items.push(`당일 ${nf(today.low, 0)}~${nf(today.high, 0)}`)
    items.push(`레드존 ${nf(today.low + r * 0.146, 0)}~${nf(today.low + r * 0.236, 0)}`)
    items.push(`블루존 ${nf(today.low + r * 0.764, 0)}~${nf(today.low + r * 0.854, 0)}`)
  }
  for (const l of levels.slice(-6)) items.push(`${l.kind} ${nf(l.price, 0)}`)
  if (st) items.push(`지갑 ${usd(st.wallet)}`, `거래 ${st.trades.length}건`)
  if (items.length === 0) return <div className="ticker" />
  const line = items.map((t, i) => <span key={i}>{t}</span>)
  return <div className="ticker"><div className="in">{line}{line}</div></div>
}
