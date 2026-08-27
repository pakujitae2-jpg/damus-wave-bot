import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { BookMap } from '#/components/v2/BookMap'
import { BookMembrane } from '#/components/v2/BookMembrane'
import { BumpBands } from '#/components/v2/BumpBands'
import { CandleEngine, candleEngineTags } from '#/components/v2/CandleEngine'
import { CorrMatrix } from '#/components/v2/CorrMatrix'
import { FibChart } from '#/components/v2/FibChart'
import { TransMatrix } from '#/components/v2/TransMatrix'
import { MaRibbon, ribbonTrend } from '#/components/v2/MaRibbon'
import { OrderBook } from '#/components/v2/OrderBook'
import { PixelTape, TapeStatsBox, tapeStats } from '#/components/v2/PixelTape'
import { useMarketHub } from '#/lib/useMarketHub'
import { useLive } from '#/lib/useLive'

export const Route = createFileRoute('/v2')({ component: V2Desk })

const SIGNAL = 'BTCUSDT'
const BAND = 0.04
const NEED = 3
const DEFAULT_SYMS = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT']

const dec = (p: number) => (p >= 1000 ? 1 : p >= 1 ? 3 : 4)
const nf = (v: number | null | undefined, d = 2) =>
  v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const usd = (v: number, d = 2) => `${v < 0 ? '−' : ''}$${nf(Math.abs(v), d)}`
const sgn = (v: number, d = 2) => `${v >= 0 ? '+' : '−'}${nf(Math.abs(v), d)}`

/** 호가 불균형(%) — 매수 잔량 우위면 +, 매도 우위면 − */
function imbTag(book: { bids: { q: number }[]; asks: { q: number }[] }): number {
  const b = book.bids.reduce((a, x) => a + x.q, 0)
  const a = book.asks.reduce((s, x) => s + x.q, 0)
  return b + a > 0 ? ((b - a) / (b + a)) * 100 : 0
}

function useLightMode() {
  const [light, setLight] = useState(false)
  useEffect(() => {
    try { setLight(localStorage.getItem('qdlight') === '1') } catch { /* 무시 */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('qdlight', light ? '1' : '0') } catch { /* 무시 */ }
  }, [light])
  return [light, () => setLight((v) => !v)] as const
}

function Clock() {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (now == null) return <span className="clk num">--:--:--</span>
  const d = new Date(now + 9 * 3600e3)
  const p = (x: number) => String(x).padStart(2, '0')
  return <span className="clk num">{p(d.getUTCHours())}:{p(d.getUTCMinutes())}:{p(d.getUTCSeconds())}</span>
}

function V2Desk() {
  const { st, busy, stale, command } = useLive(10_000)
  const [light, toggleLight] = useLightMode()
  const symbols = (st?.config.symbols as string[]) ?? DEFAULT_SYMS
  const hub = useMarketHub(SIGNAL, symbols, '3m', 120)
  const { candles, prices, dirs, book, today, yesterday, connected, depthRef, histRef, tick } = hub
  const tape = tapeStats(hub.trades)
  const ceTags = candleEngineTags(candles, prices[SIGNAL] ?? candles.at(-1)?.c ?? null)

  const price = prices[SIGNAL] ?? candles.at(-1)?.c ?? null
  const eng = st?.engine?.[symbols[0]]
  const levels = eng?.open_levels ?? []
  const nLong = price ? levels.filter((l) => l.price > price && l.price <= price * (1 + BAND)).length : 0
  const nShort = price ? levels.filter((l) => l.price < price && l.price >= price * (1 - BAND)).length : 0

  const trades = st?.trades ?? []
  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl <= 0)
  const realized = st ? st.wallet - st.seed : 0
  const unreal = st ? Object.values(st.positions).reduce((a, p) => a + p.unrealized, 0) : 0
  const held = st ? Object.keys(st.positions).length : 0
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, t) => a + t.pnl, 0) / losses.length) : 0
  const rr = avgLoss > 0 ? avgWin / avgLoss : 0
  // 거래별 수익률 표준편차 기반 간이 샤프
  const rets = trades.map((t) => t.pnl / Math.max(1, st?.seed ?? 1))
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) : 0
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(rets.length) : 0

  // 청산 위험: 포지션 현재가와 청산가 거리 → 0(안전) ~ 10(위험)
  const liqRisk = st && held > 0
    ? Math.max(...Object.entries(st.positions).map(([sym, p]) => {
        const cur = prices[sym] ?? st.prices?.[sym] ?? p.entry_price
        if (!p.liq) return 0
        const dist = Math.abs(cur - p.liq) / cur
        return Math.max(0, Math.min(10, 10 - dist * 100))
      }))
    : 0

  const trend = ribbonTrend(candles)
  const markers = st
    ? Object.entries(st.positions).map(([sym, p]) => ({
        t: new Date(p.entry_time.replace(' ', 'T')).getTime(), price: p.entry_price, side: p.side, symbol: sym,
      }))
    : []

  const chg = today ? ((price ?? today.close) / today.open - 1) * 100 : null
  const modeChip = st?.mode === 'LIVE' ? 'warn' : st?.mode === 'testnet' ? 'gold' : ''
  const sigText = held > 0 ? `IN POSITION ${held}` : st?.paused ? 'PAUSED'
    : nLong >= NEED ? 'LONG READY' : nShort >= NEED ? 'SHORT READY' : 'SCANNING'

  const strip = [
    ...symbols.map((s) => ({ k: s.replace('USDT', ''), v: nf(prices[s] ?? st?.prices?.[s], dec(prices[s] ?? 1)), c: dirs[s] })),
    { k: 'BTC', v: nf(price, 1), c: dirs[SIGNAL] },
    { k: '당일고', v: nf(today?.high, 0), c: '' as const },
    { k: '당일저', v: nf(today?.low, 0), c: '' as const },
    { k: '전일고', v: nf(yesterday?.high, 0), c: '' as const },
    { k: '전일저', v: nf(yesterday?.low, 0), c: '' as const },
    { k: '지갑', v: st ? usd(st.wallet) : '—', c: '' as const },
    { k: '가용', v: st?.margin ? usd(st.margin.available, 0) : '—', c: '' as const },
    { k: '겹침', v: `L${nLong} / S${nShort}`, c: '' as const },
    { k: '리본', v: `${trend >= 0 ? '+' : ''}${(trend * 100).toFixed(0)}%`, c: trend >= 0 ? 'up' as const : 'dn' as const },
  ]

  return (
    <div className="qd" data-light={light ? '1' : '0'}>
      <div className="desk">

        {/* ── 상단바 ── */}
        <div className="topbar">
          <div className="brand">
            <div className="mk">D</div>
            <div>
              <div className="b1">DAMUS × QUANT</div>
              <div className="b2">BTC 겹침 · SOL/ETH/XRP · 반자동</div>
            </div>
          </div>
          <div className="tabs">
            <span className="on">FIB GRID</span>
            <span>CONFLUENCE</span>
            <span>SEMI-AUTO</span>
          </div>
          <div className="sp" />
          <span className={`chip ${connected ? 'live' : 'warn'}`}>
            <span className={`led ${connected ? '' : 'off'}`} />{connected ? 'STREAM LIVE' : 'RECONNECT'}
          </span>
          <span className={`chip ${stale ? 'warn' : 'live'}`}>{stale ? 'ENGINE STOP' : `ENGINE ${st?.last_bar?.slice(11, 16) ?? '—'}`}</span>
          <span className={`chip ${modeChip}`}>{st?.mode ?? '—'}</span>
          <button type="button" className={`chip btn ${st?.paused ? 'warn' : ''}`} disabled={busy || !st}
            onClick={() => command({ pause: !st?.paused })}>{st?.paused ? '진입 재개' : '진입 정지'}</button>
          <button type="button" className="chip btn" onClick={toggleLight}>{light ? 'DARK' : 'LIGHT'}</button>
          <Link to="/" className="chip">v1</Link>
          <Clock />
        </div>

        {/* ── 티커 스트립 ── */}
        <div className="strip">
          <div className="run">
            {[0, 1].map((dup) => (
              <span key={dup}>
                {strip.map((s, i) => (
                  <span key={i} className={s.c === 'up' ? 'c-up' : s.c === 'dn' ? 'c-dn' : ''}>
                    <i>{s.k}</i>{s.v}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>

        {/* ── 본문 ── */}
        <div className="mid">
          {/* 좌: PnL */}
          <div className="panel">
            <div className="ph">
              <span className="tt">▦ <b>P&L</b> · SEMI-AUTO</span>
              <div className="sp" />
              <span className={`tag ${realized >= 0 ? 'up' : 'dn'}`}>{st ? sgn(realized) : '—'}</span>
            </div>
            <div className="pb pad">
              <div className={`pnl num ${realized >= 0 ? 'up' : 'dn'}`}>{st ? usd(st.wallet) : '—'}</div>
              <div className="pnlsub">
                <span className="c-ink3">시드 ${st ? nf(st.seed, 0) : '—'}</span>
                <span className={unreal >= 0 ? 'c-up' : 'c-dn'}>미실현 {st ? sgn(unreal) : '—'}</span>
              </div>
              <div className="quad">
                <div><div className="kk">Trades</div><div className="vv num">{trades.length}</div></div>
                <div><div className="kk">Win</div><div className="vv num c-cyan">{trades.length ? `${Math.round((wins.length / trades.length) * 100)}%` : '—'}</div></div>
                <div><div className="kk">Avg R:R</div><div className="vv num c-gold">{rr ? rr.toFixed(2) : '—'}</div></div>
                <div><div className="kk">Sharpe</div><div className="vv num c-purple">{sharpe ? sharpe.toFixed(2) : '—'}</div></div>
              </div>
              <div className="meter">
                <div className="lbl"><span>LIQ RISK</span><span className={liqRisk > 6 ? 'c-dn' : liqRisk > 3 ? 'c-gold' : 'c-up'}>{liqRisk.toFixed(1)} / 10</span></div>
                <div className="bar"><div className="fill" style={{ width: `${liqRisk * 10}%` }} /></div>
              </div>
              <div className="kvs" style={{ marginTop: 8 }}>
                <div className="r"><span>평가</span><em className="num">{st ? usd(st.equity) : '—'}</em></div>
                <div className="r"><span>가용 / 증거금</span><em className="num">{st?.margin ? `${nf(st.margin.available, 0)} / ${nf(st.margin.used_margin, 0)}` : '—'}</em></div>
                <div className="r"><span>상한</span><em className="num">{st?.margin ? usd(st.margin.cap, 0) : '—'}</em></div>
                <div className="r"><span>보유 · 외부</span><em>{held} · {st?.external.length ?? 0}</em></div>
              </div>
            </div>
          </div>

          {/* 중앙: 피보 차트 */}
          <div className="panel">
            <div className="ph">
              <span className="tt">▦ <b>FIB ENGINE</b> · BTC 3M · 어제+오늘</span>
              <span className="sub">UTC 00:00 = 09:00 KST 세션</span>
              <div className="sp" />
              <span className={`tag ${(chg ?? 0) >= 0 ? 'up' : 'dn'}`}>{chg == null ? '—' : `${sgn(chg)}%`}</span>
              <span className="tag gold num">{nf(price, 1)}</span>
              <span className={`tag ${nLong >= NEED || nShort >= NEED ? 'up' : ''}`}>{sigText}</span>
            </div>
            <div className="pb">
              <FibChart candles={candles} price={price} today={today} yesterday={yesterday} markers={markers} />
            </div>
          </div>

          {/* 우: 호가 */}
          <div className="panel">
            <div className="ph">
              <span className="tt">▦ <b>L2</b> · BOOK</span>
              <div className="sp" />
              <span className="tag cyan">{book.bids.length ? 'LIVE' : '—'}</span>
            </div>
            <div className="pb">
              <OrderBook book={book} price={price} rows={11} />
            </div>
          </div>
        </div>

        {/* ── 미시구조: 북맵 · 멤브레인 · 픽셀테이프 ── */}
        <div className="micro">
          <div className="panel">
            <div className="ph">
              <span className="tt">▦ <b>BOOKMAP</b> · DEPTH HEAT + PRINTS</span>
              <div className="sp" />
              <span className="tag up">BID {book.bids.reduce((a, b) => a + b.q, 0).toFixed(1)}</span>
              <span className="tag dn">ASK {book.asks.reduce((a, b) => a + b.q, 0).toFixed(1)}</span>
              <span className="tag cyan">{depthRef.current.length}f</span>
            </div>
            <div className="pb">
              <BookMap depthRef={depthRef} trades={hub.trades} tick={tick} price={price} />
            </div>
          </div>

          <div className="panel">
            <div className="ph">
              <span className="tt">▦ <b>BOOK MEMBRANE</b> · PRESSURE FIELD</span>
              <div className="sp" />
              <span className={`tag ${imbTag(book) >= 0 ? 'up' : 'dn'}`}>IMB {imbTag(book) >= 0 ? '+' : ''}{imbTag(book).toFixed(0)}%</span>
            </div>
            <div className="pb">
              <BookMembrane depthRef={depthRef} tick={tick} />
            </div>
          </div>

          <div className="panel">
            <div className="ph">
              <span className="tt">▦ <b>PIXEL TAPE</b> · TIME &amp; SALES</span>
              <div className="sp" />
              <span className={`tag ${tape.cvd >= 0 ? 'up' : 'dn'}`}>{tape.cvd >= 0 ? 'FLOW BUY' : 'FLOW SELL'}</span>
              <span className="tag">{hub.trades.length}</span>
            </div>
            <div className="pb">
              <div className="tapewrap">
                <div className="tapecv"><PixelTape trades={hub.trades} tick={tick} /></div>
                <div className="tapeside"><TapeStatsBox s={tape} /></div>
              </div>
            </div>
          </div>
        </div>

        {/* ── 분석: 상관 · 랭크플로우 · 전이행렬 · MA리본 ── */}
        <div className="analytics">
          <div className="panel">
            <div className="ph">
              <span className="tt">▦ <b>CORRELATION</b></span>
              <div className="sp" />
              <span className="tag cyan">1s · 5m</span>
            </div>
            <div className="pb">
              <CorrMatrix histRef={histRef} symbols={[SIGNAL, ...symbols]} tick={tick} />
            </div>
          </div>

          <div className="panel">
            <div className="ph">
              <span className="tt">▦ <b>BUMP BANDS</b> · RANK FLOW</span>
              <div className="sp" />
              <span className="tag">{symbols.length + 1} MKT</span>
            </div>
            <div className="pb">
              <BumpBands histRef={histRef} symbols={[SIGNAL, ...symbols]} tick={tick} />
            </div>
          </div>

          <div className="panel">
            <div className="ph">
              <span className="tt">▦ <b>TRANSITION</b> · MARKOV 6</span>
              <div className="sp" />
              <span className="tag gold">BTC 3M</span>
            </div>
            <div className="pb">
              <TransMatrix candles={candles} />
            </div>
          </div>

          <div className="panel">
            <div className="ph">
              <span className="tt">▦ <b>MA RIBBON</b> · 28</span>
              <div className="sp" />
              <span className={`tag ${trend >= 0 ? 'up' : 'dn'}`}>{(trend * 100).toFixed(0)}%</span>
            </div>
            <div className="pb">
              <MaRibbon candles={candles} bands={28} />
            </div>
          </div>
        </div>

        {/* ── 하단: 엔진 · 캔들엔진 · 포지션 ── */}
        <div className="lower">
          <div className="panel">
            <div className="ph">
              <span className="tt">▦ <b>ENGINE</b> · 겹침</span>
              <div className="sp" />
              <span className={`tag ${nLong >= NEED ? 'up' : nShort >= NEED ? 'dn' : ''}`}>{nLong}/{nShort}</span>
            </div>
            <div className="pb pad">
              <div className="kvs">
                <div className="r"><span>패턴</span><em className="c-purple">{eng?.pattern ?? '—'}</em></div>
                <div className="r"><span>T 저~고</span><em className="num">{nf(eng?.t_low, 0)}~{nf(eng?.t_high, 0)}</em></div>
                <div className="r"><span>Y 저~고</span><em className="num">{nf(eng?.y_low, 0)}~{nf(eng?.y_high, 0)}</em></div>
                <div className="r"><span>미해소 레벨</span><em>{levels.length}</em></div>
              </div>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[...levels].sort((a, b) => b.price - a.price).slice(0, 6).map((l, i) => {
                  const inb = price ? Math.abs(l.price - price) / price <= BAND : false
                  const above = price ? l.price > price : false
                  return (
                    <div className="r" key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, opacity: inb ? 1 : 0.45 }}>
                      <span className={l.kind === 'SOP' ? 'c-purple' : l.kind.startsWith('RETEST') ? 'c-blue' : 'c-cyan'}>{l.kind}</span>
                      <span className="num">{nf(l.price, 0)}</span>
                      <span className={above ? 'c-up' : 'c-dn'}>{price ? `${above ? '▲' : '▼'}${nf(Math.abs((l.price / price - 1) * 100), 2)}%` : ''}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="ph">
              <span className="tt">▦ <b>CANDLE ENGINE</b> · BTC 3M · VWAP ±1σ · RSI14</span>
              <div className="sp" />
              {ceTags.rsi != null && (
                <span className={`tag ${ceTags.rsi >= 70 ? 'dn' : ceTags.rsi <= 30 ? 'up' : ''}`}>RSI {ceTags.rsi.toFixed(0)}</span>
              )}
              <span className={`tag ${ceTags.vwapSide === 'ABOVE' ? 'up' : 'dn'}`}>VWAP {ceTags.vwapSide || '—'}</span>
            </div>
            <div className="pb">
              <CandleEngine candles={candles} price={price} />
            </div>
          </div>

          <div className="panel">
            <div className="ph">
              <span className="tt">▦ <b>POS</b></span>
              <div className="sp" />
              <span className="tag">{held}/{symbols.length}</span>
            </div>
            <div className="pb pad">
              {symbols.map((s) => {
                const p = st?.positions[s]
                const cur = prices[s] ?? st?.prices?.[s]
                const ext = st?.external.includes(s)
                return (
                  <div key={s} style={{ borderBottom: '1px solid var(--line2)', padding: '3px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <b style={{ fontSize: 10 }}>{s.replace('USDT', '')}</b>
                      <span className={`num ${dirs[s] === 'up' ? 'c-up' : dirs[s] === 'dn' ? 'c-dn' : ''}`}>{nf(cur, cur ? dec(cur) : 3)}</span>
                    </div>
                    {p ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5 }}>
                          <span className={p.side === 'LONG' ? 'c-up' : 'c-dn'}>{p.side}</span>
                          <span className={`num ${p.unrealized >= 0 ? 'c-up' : 'c-dn'}`}>{sgn(p.unrealized)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--ink3)' }}>
                          <span className="num">SL {nf(p.stop, dec(p.entry_price))}</span>
                          <span className="num">{Math.max(0, p.hours_left).toFixed(1)}h</span>
                        </div>
                        <button type="button" className="chip btn warn" style={{ marginTop: 2, width: '100%', justifyContent: 'center' }}
                          disabled={busy} onClick={() => { if (confirm(`${s} 시장가 청산?`)) command({ close: [s] }) }}>청산</button>
                      </>
                    ) : (
                      <div style={{ fontSize: 9, color: ext ? 'var(--gold)' : 'var(--ink3)' }}>{ext ? '외부 · 보류' : '대기'}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── 상태바 ── */}
        <div className="statusbar">
          <span className={connected ? 'ok' : 'bad'}>■ STREAM {connected ? 'ONLINE' : 'RETRY'}</span>
          <span>CANDLES <b>{candles.length}</b></span>
          <span>BOOK <b>{book.bids.length + book.asks.length}</b></span>
          <span>TAPE <b>{hub.trades.length}</b></span>
          <span>CVD <b className={tape.cvd >= 0 ? 'ok' : 'bad'}>{tape.cvd >= 0 ? '+' : '−'}{Math.abs(tape.cvd).toFixed(2)}</b></span>
          <span>DEPTH <b>{depthRef.current.length}f</b></span>
          <span>레드존 <b className="c-dn">{today ? `${nf(today.low + (today.high - today.low) * 0.146, 0)}~${nf(today.low + (today.high - today.low) * 0.236, 0)}` : '—'}</b></span>
          <span>블루존 <b className="c-blue">{today ? `${nf(today.low + (today.high - today.low) * 0.764, 0)}~${nf(today.low + (today.high - today.low) * 0.854, 0)}` : '—'}</b></span>
          <span className="sp" />
          <span>{st?.logs?.at(-1)?.slice(0, 90) ?? ''}</span>
        </div>
      </div>
    </div>
  )
}
