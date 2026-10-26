// reality-defects: C-B3a
// C-B3a (reality batch 3, C3): a single read to the app used fetch, which reused an idle keep-alive socket the server had
// already closed, and failed with UND_ERR_SOCKET "other side closed" before reaching the app. appRequest() opens a fresh
// connection per call (as cron() does, T27). The server here closes every idle connection at once.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

vi.mock('server-only', () => ({}))

let server: Server
const seen: Array<{ method?: string; url?: string; auth?: string; origin?: string; body: string }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, origin: req.headers.origin as string | undefined, body })
      res.writeHead(seen.length % 2 ? 200 : 404, { 'content-type': 'application/json', 'retry-after': '7' })
      res.end(JSON.stringify({ n: seen.length }))
    })
  })
  server.keepAliveTimeout = 1
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.GRIDEX_LIVE_APP_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

describe('C-B3a the harness reads the app on a fresh connection', () => {
  it('returns status, headers and body for each call, with the caller headers and body, while idle sockets are closed', async () => {
    const { appRequest } = await import('../scripts/helpers/live-chain-fixture')
    for (let i = 0; i < 6; i++) {
      const result = await appRequest(`/api/v1/x?i=${i}`, { headers: { authorization: 'Bearer k', origin: 'https://w.example' }, ...(i === 5 ? { method: 'POST', body: '{"a":1}' } : {}) })
      expect(result.status).toBe(i % 2 ? 404 : 200)
      expect(result.headers['retry-after']).toBe('7')
      expect(JSON.parse(result.text)).toEqual({ n: i + 1 })
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(seen.every(row => row.auth === 'Bearer k' && row.origin === 'https://w.example')).toBe(true)
    expect(seen[5]).toMatchObject({ method: 'POST', body: '{"a":1}' })
  }, 180_000)
})
