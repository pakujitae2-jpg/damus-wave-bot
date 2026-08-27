import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { BookMap } from '#/components/v2/BookMap'
import { BumpBands } from '#/components/v2/BumpBands'
import { CandleEngine, candleEngineTags } from '#/components/v2/CandleEngine'
import { CorrMatrix } from '#/components/v2/CorrMatrix'
import { FibChart } from '#/components/v2/FibChart'
import { MaRibbon, ribbonTrend } from '#/components/v2/MaRibbon'
import { OrderBook } from '#/components/v2/OrderBook'
import { PixelTape, tapeStats } from '#/components/v2/PixelTape'
import { TransMatrix } from '#/components/v2/TransMatrix'
import { EquitySpark } from '#/components/v3/EquitySpark'
import { MembraneSheet } from '#/components/v3/MembraneSheet'
import { CHART_MODES, DeltaChart, HeikinChart, TpoChart, VpvrChart, type ChartMode } from '#/components/v3/ChartModes'
import { useMarketHub } from '#/lib/useMarketHub'
import { useLive } from '#/lib/useLive'

export const Route = createFileRoute('/v3')({ component: V3Desk })

const SIGNAL = 'BTCUSDT'
const BAND = 0.04
const NEED = 3
const DEFAULT_SYMS = ['SOLUSDT', 'ETHUSDT', 'XRPUSDT']

const dec = (p: number) => (p >= 1000 ? 1 : p >= 1 ? 3 : 4)
const nf = (v: number | null | undefined, d = 2) =>
  v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const usd = (v: number, d = 2) => `${v < 0 ? '−' : ''}$${nf(Math.abs(v), d)}`
const sgn = (v: number, d = 2) => `${v >= 0 ? '+' : '−'}${nf(Math.abs(v), d)}`

function useLightMode() {
  const [light, setLight] = useState(false)
  useEffect(() => { try { setLight(localStorage.getItem('qdlight') === '1') } catch { /* 무시 */ } }, [])
  useEffect(() => { try { localStorage.setItem('qdlight', light ? '1' : '0') } catch { /* 무시 */ } }, [light])
  return [light, () => setLight((v) => !v)] as const
}

function Clock() {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (now == null) return <span className="v3clock">--:--:--</span>
  const d = new Date(now + 9 * 3600e3)
  const p = (x: number) => String(x).padStart(2, '0')
  return <span className="v3clock">{p(d.getUTCHours())}:{p(d.getUTCMinutes())}:{p(d.getUTCSeconds())}</span>
}

function V3Desk() {
  const { st, busy, stale, command } = useLive(10_000)
  const [light, toggleLight] = useLightMode()
  const [chartMode, setChartMode] = useState<ChartMode>('FIB')
  const symbols = (st?.config.symbols as string[]) ?? DEFAULT_SYMS
  const hub = useMarketHub(SIGNAL, symbols, '3m', 120)
  const { candles, prices, dirs, book, today, yesterday, connected, depthRef, histRef, tick } = hub

  const price = prices[SIGNAL] ?? candles.at(-1)?.c ?? null
  const eng = st?.engine?.[symbols[0]]
  const levels = eng?.open_levels ?? []
  const nLong = price ? levels.filter((l) => l.price > price && l.price <= price * (1 + BAND)).length : 0
  const nShort = price ? levels.filter((l) => l.price < price && l.price >= price * (1 - BAND)).length : 0

  const tape = tapeStats(hub.trades)
  const trend = ribbonTrend(candles)
  const ceTags = candleEngineTags(candles, price)

  const trades = st?.trades ?? []
  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl <= 0)
  const realized = st ? st.wallet - st.seed : 0
  const unreal = st ? Object.values(st.positions).reduce((a, p) => a + p.unrealized, 0) : 0
  const held = st ? Object.keys(st.positions).length : 0
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, t) => a + t.pnl, 0) / losses.length) : 0
  const rr = avgLoss > 0 ? avgWin / avgLoss : 0
  const rets = trades.map((t) => t.pnl / Math.max(1, st?.seed ?? 1))
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) : 0
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(rets.length) : 0

  const liqRisk = st && held > 0
    ? Math.max(...Object.entries(st.positions).map(([sym, p]) => {
        const cur = prices[sym] ?? st.prices?.[sym] ?? p.entry_price
        if (!p.liq) return 0
        return Math.max(0, Math.min(10, 10 - (Math.abs(cur - p.liq) / cur) * 100))
      }))
    : 0
  const liqTag = liqRisk > 6 ? 'DANGER' : liqRisk > 3 ? 'WATCH' : 'SAFE'

  const markers = st
    ? Object.entries(st.positions).map(([sym, p]) => ({
        t: new Date(p.entry_time.replace(' ', 'T')).getTime(), price: p.entry_price, side: p.side, symbol: sym,
      }))
    : []

  const chg = today ? ((price ?? today.close) / today.open - 1) * 100 : null
  const imb = (() => {
    const b = book.bids.reduce((a, x) => a + x.q, 0)
    const a = book.asks.reduce((s, x) => s + x.q, 0)
    return b + a > 0 ? ((b - a) / (b + a)) * 100 : 0
  })()
  const sigText = held > 0 ? `IN POSITION ${held}` : st?.paused ? 'PAUSED'
    : nLong >= NEED ? 'LONG READY' : nShort >= NEED ? 'SHORT READY' : 'SCANNING'

  const eqPoints = (st?.equity_curve ?? []).slice(-240).map((p) => p.equity)

  const ticks = [...symbols, SIGNAL].flatMap((s) => {
    const p = prices[s] ?? st?.prices?.[s]
    const d = dirs[s]
    return p ? [{ k: s.replace('USDT', ''), v: nf(p, dec(p)), up: d === 'up', dn: d === 'dn' }] : []
  })
  const tickItems = [
    ...ticks,
    { k: '당일고', v: nf(today?.high, 0), up: false, dn: false },
    { k: '당일저', v: nf(today?.low, 0), up: false, dn: false },
    { k: '전일고', v: nf(yesterday?.high, 0), up: false, dn: false },
    { k: '전일저', v: nf(yesterday?.low, 0), up: false, dn: false },
    { k: 'CVD', v: `${tape.cvd >= 0 ? '+' : '−'}${nf(Math.abs(tape.cvd), 2)}`, up: tape.cvd >= 0, dn: tape.cvd < 0 },
    { k: 'IMB', v: `${imb >= 0 ? '+' : ''}${imb.toFixed(0)}%`, up: imb >= 0, dn: imb < 0 },
    { k: '레드존', v: today ? nf(today.low + (today.high - today.low) * 0.236, 0) : '—', up: false, dn: true },
    { k: '블루존', v: today ? nf(today.low + (today.high - today.low) * 0.764, 0) : '—', up: true, dn: false },
  ]

  return (
    <div className="qd qd3" data-light={light ? '1' : '0'}>
      <div className="deck">

        {/* ── 상단바 ── */}
        <div className="v3top">
          <div className="v3logo">
            <div className="mk">D</div>
            <div>
              <div className="l1">DAMUS <i>×</i> QUANT</div>
              <div className="l2">SEMI-AUTO · BTC/ETH/SOL/XRP · 3M CONFLUENCE</div>
            </div>
          </div>
          <div className="v3tabs">
            <span className="on">FIB</span>
            <span>·</span>
            <span>CONFLUENCE</span>
            <span>·</span>
            <span>FLOW</span>
          </div>
          <span className={`chip ${st?.paused ? 'warn' : ''}`}>{sigText}</span>
          <div className="sp" />
          <button type="button" className="chip btn" onClick={toggleLight}>{light ? 'DARK' : 'LIGHT'}</button>
          <button type="button" className={`chip btn ${st?.paused ? 'warn' : ''}`} disabled={busy || !st}
            onClick={() => command({ pause: !st?.paused })}>{st?.paused ? '진입 재개' : '진입 정지'}</button>
          <span className={`chip ${connected ? 'live' : 'warn'}`}>
            <span className={`led ${connected ? '' : 'off'}`} />{st?.mode === 'LIVE' ? 'LIVE · MAINNET' : st?.mode ?? '—'}
          </span>
          <Link to="/" className="chip">v1</Link>
          <Link to="/v2" className="chip">v2</Link>
          <Clock />
          <div className="v3utc">KST<br />{stale ? 'ENGINE STOP' : `BAR ${st?.last_bar?.slice(11, 16) ?? '—'}`}</div>
        </div>

        {/* ── 랭크 스트립 ── */}
        <div className="rankstrip">
          <span className="r1">◆ 반자동 · 익절 수동</span>
          <span className="r2">증거금 {st?.margin ? `${st.margin.per_symbol * 100}%` : '20%'} · {String(st?.config.leverage ?? 10)}배</span>
          <span className="r2">보유 {held}/{symbols.length}</span>
          <span className={realized >= 0 ? 'up' : 'r2'}>누적 {st ? sgn(realized) : '—'}</span>
          <span className="r2">거래 {trades.length}건</span>
          <span className="r2">겹침 L{nLong} · S{nShort} / {NEED}</span>
          <div className="sp" />
          <span className="r1">48H 무조치 시 시장가</span>
        </div>

        {/* ── 시세 티커 ── */}
        <div className="tickstrip">
          <span className="lv">● LIVE</span>
          <div className="run">
            {[0, 1].map((dup) => (
              <span key={dup}>
                {tickItems.map((t, i) => (
                  <span key={i} className={t.up ? 'c-up' : t.dn ? 'c-dn' : ''}>
                    <i>{t.k}</i>{t.v}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>

        {/* ── ROW A : P&L | 차트+호가 ── */}
        <div className="rowA">
          <div className="panel">
            <div className="ph">
              <span className="tt">● <b>DAMUS BOT</b></span>
              <span className="tag up">{st?.mode ?? '—'}</span>
              <div className="sp" />
              <span className="tag gold">누적 손익 · 시드 ${st ? nf(st.seed, 0) : '—'}</span>
            </div>
            <div className="pnlwrap">
              <div className="pnlsub2">BTC 겹침 시그널 → {symbols.map((s) => s.replace('USDT', '')).join('/')} · 격리 {String(st?.config.leverage ?? 10)}배</div>
              <div className="pnlmain">
                <div className={`pnlbig ${realized >= 0 ? 'up' : 'dn'}`}>{st ? usd(st.wallet, 2) : '$—'}</div>
                <div className="pnlside">
                  <div className={`box ${realized >= 0 ? '' : 'dn'}`}>{st ? sgn(realized) : '—'}</div>
                  <div className="cap">평가 {st ? usd(st.equity, 0) : '—'}</div>
                  <div className={`box ${unreal >= 0 ? '' : 'dn'}`} style={{ fontSize: 12 }}>미실현 {st ? sgn(unreal) : '—'}</div>
                  <div className="cap">가용 {st?.margin ? usd(st.margin.available, 0) : '—'}</div>
                </div>
              </div>
              <div className="quad4">
                <div><div className="kk">Trades</div><div className="vv">{trades.length}</div></div>
                <div><div className="kk">Win rate</div><div className="vv c-up">{trades.length ? `${Math.round((wins.length / trades.length) * 100)}%` : '—'}</div></div>
                <div><div className="kk">Avg R/R</div><div className="vv">{rr ? rr.toFixed(2) : '—'}</div></div>
                <div><div className="kk">Sharpe</div><div className="vv c-gold">{sharpe ? sharpe.toFixed(2) : '—'}</div></div>
              </div>
              <div className="eqbox">
                <span className="cap">EQUITY CURVE · 실시간</span>
                <EquitySpark points={eqPoints} seed={st?.seed ?? 1000} />
              </div>
              <div className="liqrow">
                <span className="lab">LIQ RISK</span>
                <span className="val" style={{ color: liqRisk > 6 ? 'var(--dn)' : liqRisk > 3 ? 'var(--gold)' : 'var(--up)' }}>
                  {liqRisk.toFixed(1)}
                </span>
                <span className="c-ink3" style={{ fontSize: 9 }}>/10</span>
                <span className="bar"><span className="fill" style={{ width: `${liqRisk * 10}%` }} /></span>
                <span className={`tag ${liqTag === 'SAFE' ? 'up' : liqTag === 'WATCH' ? 'gold' : 'dn'}`}>{liqTag}</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="ph">
              <span className="tt">▣ <b>BTC / USD</b> · 3M</span>
              <div className="modetabs">
                {CHART_MODES.map((m) => (
                  <button key={m} type="button" className={`mt ${chartMode === m ? 'on' : ''}`}
                    onClick={() => setChartMode(m)}>{m}</button>
                ))}
              </div>
              <div className="sp" />
              <span className="tag cyan">L2 · BOOK</span>
            </div>
            <div className="bigpx">
              <b className={dirs[SIGNAL] === 'up' ? 'c-up' : dirs[SIGNAL] === 'dn' ? 'c-dn' : 'c-gold'}>{nf(price, 1)}</b>
              <span className={`chg ${(chg ?? 0) >= 0 ? 'c-up' : 'c-dn'}`}>{chg == null ? '—' : `${sgn(chg)}%`}</span>
              <span className="c-ink3" style={{ fontSize: 9.5 }}>당일 {nf(today?.low, 0)} ~ {nf(today?.high, 0)}</span>
            </div>
            <div className="pb">
              <div className="chartbook">
                {chartMode === 'FIB' && (
                  <FibChart candles={candles} price={price} today={today} yesterday={yesterday} markers={markers} />
                )}
                {chartMode === 'VPVR' && <VpvrChart candles={candles} price={price} />}
                {chartMode === 'DELTA' && <DeltaChart candles={candles} price={price} trades={hub.trades} />}
                {chartMode === 'HEIKIN' && <HeikinChart candles={candles} price={price} />}
                {chartMode === 'TPO' && <TpoChart candles={candles} price={price} />}
                <div className="bk"><OrderBook book={book} price={price} rows={9} /></div>
              </div>
            </div>
          </div>
        </div>

        {/* ── ROW B : 전이행렬 | 상관행렬 ── */}
        <div className="rowB">
          <div className="panel">
            <div className="ph">
              <span className="tt">⇄ <b>TRANSITION MATRIX</b> · MARKOV · 6 REGIMES</span>
              <div className="sp" />
              <span className="tag gold">BTC 3M</span>
            </div>
            <div className="pb"><TransMatrix candles={candles} /></div>
          </div>
          <div className="panel">
            <div className="ph">
              <span className="tt">⊞ <b>CORRELATION MATRIX</b> · LIVE CLUSTER</span>
              <div className="sp" />
              <span className="tag cyan">1s · 5m</span>
            </div>
            <div className="pb"><CorrMatrix histRef={histRef} symbols={[SIGNAL, ...symbols]} tick={tick} /></div>
          </div>
        </div>

        {/* ── ROW C : 북맵 | 멤브레인 ── */}
        <div className="rowC">
          <div className="panel">
            <div className="ph">
              <span className="tt">▣ <b>BOOKMAP</b> · DEPTH HEAT + PRINTS</span>
              <div className="sp" />
              <span className="tag up">BID {book.bids.reduce((a, b) => a + b.q, 0).toFixed(1)}</span>
              <span className="tag dn">ASK {book.asks.reduce((a, b) => a + b.q, 0).toFixed(1)}</span>
              <span className="tag">{depthRef.current.length}f</span>
            </div>
            <div className="pb"><BookMap depthRef={depthRef} trades={hub.trades} tick={tick} price={price} /></div>
          </div>
          <div className="panel">
            <div className="ph">
              <span className="tt">▣ <b>BOOK MEMBRANE</b> · PRESSURE FIELD</span>
              <div className="sp" />
              <span className={`tag ${imb >= 0 ? 'up' : 'dn'}`}>IMB {imb >= 0 ? '+' : ''}{imb.toFixed(0)}%</span>
              <span className={`tag ${Math.abs(imb) > 35 ? 'dn' : 'cyan'}`}>STATE {Math.abs(imb) > 35 ? 'STRESSED' : Math.abs(imb) > 15 ? 'LOADED' : 'ELASTIC'}</span>
            </div>
            <div className="pb"><MembraneSheet depthRef={depthRef} tick={tick} /></div>
          </div>
        </div>

        {/* ── ROW D : 캔들엔진 | 범프밴드 ── */}
        <div className="rowD">
          <div className="panel">
            <div className="ph">
              <span className="tt">▣ <b>CANDLE ENGINE</b> · BTC 3M · VWAP ±1σ</span>
              <div className="sp" />
              {ceTags.rsi != null && (
                <span className={`tag ${ceTags.rsi >= 70 ? 'dn' : ceTags.rsi <= 30 ? 'up' : ''}`}>RSI {ceTags.rsi.toFixed(0)}</span>
              )}
              <span className={`tag ${ceTags.vwapSide === 'ABOVE' ? 'up' : 'dn'}`}>VWAP {ceTags.vwapSide || '—'}</span>
            </div>
            <div className="pb"><CandleEngine candles={candles} price={price} /></div>
          </div>
          <div className="panel">
            <div className="ph">
              <span className="tt">⋁⋀ <b>BUMP BANDS</b> · RANK FLOW · {symbols.length + 1} MARKETS</span>
              <div className="sp" />
              <span className="tag cyan">30 STEPS</span>
            </div>
            <div className="pb"><BumpBands histRef={histRef} symbols={[SIGNAL, ...symbols]} tick={tick} /></div>
          </div>
        </div>

        {/* ── 에이전트 스트립 ── */}
        <div className="agent">
          <span className="tag">▸ AGENT</span>
          <span>{st?.logs?.at(-1) ?? '대기 중…'}</span>
          <span className="cur" />
        </div>

        {/* ── ROW E : 픽셀테이프 | MA 리본 ── */}
        <div className="rowE">
          <div className="panel">
            <div className="ph">
              <span className="tt">▣ <b>PIXEL TAPE</b> · TIME &amp; SALES</span>
              <div className="sp" />
              <span className={`tag ${tape.cvd >= 0 ? 'up' : 'dn'}`}>{tape.cvd >= 0 ? 'FLOW BUY' : 'FLOW SELL'}</span>
              <span className="tag">TICKS {hub.trades.length}</span>
            </div>
            <div className="pb">
              <div className="tapesplit">
                <PixelTape trades={hub.trades} tick={tick} />
                <div className="side">
                  <div className="bigstat"><span className="k c-up">■ BUY</span><span className="v c-up">{tape.buy}</span></div>
                  <div className="bigstat"><span className="k c-dn">■ SELL</span><span className="v c-dn">{tape.sell}</span></div>
                  <div className="bigstat">
                    <span className="k c-ink3">Δ CVD</span>
                    <span className={`v ${tape.cvd >= 0 ? 'c-up' : 'c-dn'}`}>{tape.cvd >= 0 ? '+' : '−'}{nf(Math.abs(tape.cvd), 1)}</span>
                  </div>
                  <div className="kvrow"><span>TOP PRINT</span><b>${nf(tape.topPrint / 1000, 2)}K</b></div>
                  <div className="kvrow"><span>UPIN</span><b>{tape.upin.toFixed(2)}</b></div>
                  <div style={{ height: 7, border: '1px solid var(--line)', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${tape.upin * 100}%`, background: 'var(--up)' }} />
                    <div style={{ flex: 1, background: 'var(--dn)' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="ph">
              <span className="tt">≡ <b>MA RIBBON</b> · 28 BANDS · MOMENTUM</span>
              <div className="sp" />
              <span className={`tag ${trend >= 0 ? 'up' : 'dn'}`}>{trend >= 0 ? 'TREND UP' : 'TREND DOWN'} {(trend * 100).toFixed(0)}%</span>
            </div>
            <div className="pb"><MaRibbon candles={candles} bands={28} /></div>
          </div>
        </div>

        {/* ── 하단 상태바 ── */}
        <div className="v3status">
          <span className="head">DAMUS · {stale ? 'OFFLINE' : 'ONLINE'}</span>
          <span className="it">STREAM <b className={connected ? 'ok' : 'bad'}>{connected ? 'ONLINE' : 'RETRY'}</b></span>
          <span className="it">패턴 <b>{eng?.pattern ?? '—'}</b></span>
          <span className="it">겹침 <b className={nLong >= NEED ? 'ok' : ''}>{nLong}</b>/<b className={nShort >= NEED ? 'bad' : ''}>{nShort}</b></span>
          <span className="it">DEPTH <b>{depthRef.current.length}f</b></span>
          <span className="it">TAPE <b>{hub.trades.length}</b></span>
          <span className="it">CVD <b className={tape.cvd >= 0 ? 'ok' : 'bad'}>{tape.cvd >= 0 ? '+' : '−'}{Math.abs(tape.cvd).toFixed(2)}</b></span>
          <span className="it">외부 <b>{st?.external.length ?? 0}</b></span>
          <span className="it">증거금 <b>{st?.margin ? `${nf(st.margin.used_margin, 0)}/${nf(st.margin.cap, 0)}` : '—'}</b></span>
          <span className="it">재시작 <b>{st?.restarts ?? 0}</b></span>
        </div>
      </div>
    </div>
  )
}
