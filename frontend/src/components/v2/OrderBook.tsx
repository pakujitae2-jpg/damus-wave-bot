import type { Book } from '#/lib/useMarketHub'

const nf = (v: number, d: number) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

/** L2 호가 사다리 — 수량 비율을 배경 바로 표시 */
export function OrderBook({ book, price, rows = 12 }: { book: Book; price: number | null; rows?: number }) {
  const asks = book.asks.slice(0, rows).reverse()
  const bids = book.bids.slice(0, rows)
  const maxQ = Math.max(1e-9, ...asks.map((a) => a.q), ...bids.map((b) => b.q))
  const d = price && price >= 1000 ? 1 : price && price >= 1 ? 3 : 4
  const spread = asks.length && bids.length ? asks[asks.length - 1].p - bids[0].p : null
  const bidVol = bids.reduce((a, b) => a + b.q, 0)
  const askVol = asks.reduce((a, b) => a + b.q, 0)
  const imb = bidVol + askVol > 0 ? ((bidVol - askVol) / (bidVol + askVol)) * 100 : 0

  return (
    <div className="book">
      <div className="side ask">
        {asks.map((a, i) => (
          <div className="row ask" key={`a${i}`}>
            <span className="hb" style={{ width: `${(a.q / maxQ) * 100}%` }} />
            <span className="p num">{nf(a.p, d)}</span>
            <span className="q num">{a.q.toFixed(3)}</span>
          </div>
        ))}
      </div>
      <div className="mid2">
        <b className="num c-gold">{price == null ? '—' : nf(price, d)}</b>
        <span className="num">스프레드 {spread == null ? '—' : nf(spread, d)}</span>
      </div>
      <div className="side bid">
        {bids.map((b, i) => (
          <div className="row bid" key={`b${i}`}>
            <span className="hb" style={{ width: `${(b.q / maxQ) * 100}%` }} />
            <span className="p num">{nf(b.p, d)}</span>
            <span className="q num">{b.q.toFixed(3)}</span>
          </div>
        ))}
      </div>
      <div className="mid2" style={{ borderBottom: 'none' }}>
        <span className="num">불균형</span>
        <b className={`num ${imb >= 0 ? 'c-up' : 'c-dn'}`}>{imb >= 0 ? '+' : ''}{imb.toFixed(1)}%</b>
      </div>
    </div>
  )
}
