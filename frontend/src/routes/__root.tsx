import { HeadContent, Link, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import appCss from '../styles.css?url'
import v2Css from '../v2.css?url'
import qdCss from '../v2desk.css?url'
import qd3Css from '../v3desk.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: '다무스 반자동 데스크 — BTC 시그널 → SOL/ETH/XRP' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'stylesheet', href: v2Css },
      { rel: 'stylesheet', href: qdCss },
      { rel: 'stylesheet', href: qd3Css },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Noto+Sans+KR:wght@400;700&display=swap' },
    ],
  }),
  shellComponent: RootDocument,
})

const NAV = [
  { to: '/', label: '홈' },
  { to: '/live', label: '라이브 상세' },
  { to: '/backtest', label: '백테스트 3년' },
  { to: '/spec', label: '규칙' },
] as const

function RootDocument({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const bare = path === '/' || path === '/v2' || path === '/v3' // 홈·퀀트데스크는 자체 헤더/푸터를 가진다

  return (
    <html lang="ko">
      <head>
        <HeadContent />
      </head>
      <body>
        {bare ? (
          children
        ) : (
          <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-16 sm:px-6">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-surface py-4">
              <span className="text-lg font-semibold tracking-tight text-accent">다무스 반자동 데스크</span>
              <nav className="flex gap-1 text-sm">
                {NAV.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="rounded-md px-3 py-1.5 text-muted hover:bg-surface hover:text-fg [&.active]:bg-surface [&.active]:text-accent"
                    activeProps={{ className: 'active' }}
                    activeOptions={{ exact: item.to === '/' }}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </header>
            <main className="flex-1 py-6">{children}</main>
            <footer className="border-t border-surface py-4 text-xs text-muted">
              반자동 — 진입·손절·TP 자동, 익절은 사용자, 48h 무조치 시 시장가. BTC 시그널 → SOL/ETH/XRP · 10배 · 증거금 20% · 복리.
            </footer>
          </div>
        )}
        <Scripts />
      </body>
    </html>
  )
}
