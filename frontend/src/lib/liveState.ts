/**
 * 라이브 러너(run_live_semi.py) 상태 읽기 + 명령 쓰기 서버 함수.
 * 명령은 output/live/commands.json 에 쓰고 러너가 5초 안에 읽어 실행한다 (거래소 키는 러너만 가진다).
 */
import { createServerFn } from '@tanstack/react-start'
import type { LiveState } from './types'

async function liveDir(): Promise<string> {
  const { resolve } = await import('node:path')
  const { access } = await import('node:fs/promises')
  for (const p of [resolve(process.cwd(), '../output/live'), resolve(process.cwd(), 'output/live')]) {
    try {
      await access(p)
      return p
    } catch {
      /* next */
    }
  }
  return resolve(process.cwd(), '../output/live')
}

export const readLiveState = createServerFn({ method: 'GET' }).handler(async (): Promise<LiveState | null> => {
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  try {
    const txt = await readFile(join(await liveDir(), 'state.json'), 'utf-8')
    return JSON.parse(txt) as LiveState
  } catch {
    return null
  }
})

export const sendCommand = createServerFn({ method: 'POST' })
  .validator((data: { close?: string[]; pause?: boolean }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { readFile, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const p = join(await liveDir(), 'commands.json')
    let cur: { close?: string[]; pause?: boolean } = {}
    try {
      cur = JSON.parse(await readFile(p, 'utf-8'))
    } catch {
      /* none */
    }
    const merged = { ...cur, ...data, close: [...(cur.close ?? []), ...(data.close ?? [])] }
    await writeFile(p, JSON.stringify(merged), 'utf-8')
    return { ok: true }
  })
