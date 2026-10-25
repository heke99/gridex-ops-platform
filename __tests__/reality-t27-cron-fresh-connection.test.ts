// reality-defects: T27
// T27 (reality F run 32, F7): the harness's cron() used fetch, which reused an idle keep-alive socket after a long
// scenario step; the server had closed it and the call failed with UND_ERR_SOCKET "other side closed" before reaching
// the app. cron() now opens a fresh connection per call. This test runs a server that closes every idle connection at
// once (keepAliveTimeout 1 ms) and calls it repeatedly with pauses.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

vi.mock('server-only', () => ({}))

let server: Server
const seen: Array<{ auth: string | undefined; url: string | undefined }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ auth: req.headers.authorization, url: req.url })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, n: seen.length }))
  })
  server.keepAliveTimeout = 1
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.GRIDEX_LIVE_APP_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.CRON_SECRET = 'test-secret'
})
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

describe('T27 the harness calls a cron on a fresh connection', () => {
  it('survives the server closing idle connections between calls, with the Vercel Bearer header', async () => {
    const { cron } = await import('../scripts/helpers/live-chain-fixture')
    for (let i = 0; i < 5; i++) {
      const result = await cron(`/api/cron/x?i=${i}`)
      expect(result).toEqual({ status: 200, body: { ok: true, n: i + 1 } })
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(seen.every(row => row.auth === 'Bearer test-secret')).toBe(true)
    expect(seen.map(row => row.url)).toEqual([0, 1, 2, 3, 4].map(i => `/api/cron/x?i=${i}`))
  }, 180_000)
})
