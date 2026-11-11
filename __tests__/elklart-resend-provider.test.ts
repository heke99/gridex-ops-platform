import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProvider } from '../scripts/demo/elklart-resend-provider.mjs'
const key = 'a'.repeat(48)
const body = { from: 'Elklart <sender@elklart.example.invalid>', to: ['anna@elklart.example.invalid'], subject: 'Demo', text: 'Fictional local message' }
const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function listen(server: Server) { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve()))); return `http://127.0.0.1:${(server.address() as { port: number }).port}` }
async function setup(options: Record<string, unknown> = {}) {
  let deliveries = 0
  const mailpit = await listen(createServer(async (req, res) => { let raw = ''; for await (const chunk of req) raw += chunk; const message = JSON.parse(raw); expect(message.To[0].Email).toBe(body.to[0]); deliveries++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ID: 'mailpit-local-id' })) }))
  const dir = mkdtempSync(join(tmpdir(), 'elklart-mail-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const provider = createProvider({ stateDir: dir, apiKey: key, mailpitURL: mailpit, ...options }); cleanup.push(() => provider.close())
  const base = await listen(createServer(provider.handler))
  async function call(route: string, data?: unknown, idem?: string, auth = key) { return fetch(base + route, { method: data === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${auth}`, ...(idem ? { 'idempotency-key': idem } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) }) }
  await call('/domains', { name: 'elklart.example.invalid' }); await call('/domains/elklart-simulated-domain/verify', {})
  return { call, deliveries: () => deliveries, dir }
}
describe('isolated Resend boundary', () => {
  it('supports domain list/get/create/verify and labels DNS as simulated', async () => {
    const { call } = await setup()
    const list = await (await call('/domains')).json()
    expect(list.data[0].status).toBe('verified')
    const domain = await (await call('/domains/elklart-simulated-domain')).json()
    expect(domain.simulation).toContain('no public DNS')
    expect(domain.records.map((record: { record: string }) => record.record)).toEqual(['DKIM', 'SPF', 'MX', 'DMARC'])
    expect((await call('/domains', { name: 'real.example.com' })).status).toBe(422)
    expect((await call('/domains', undefined, undefined, 'wrong')).status).toBe(401)
  })
  it('deduplicates concurrent repeats and rejects conflicting keys and external mail', async () => {
    const { call, deliveries } = await setup()
    const results = await Promise.all([call('/emails', body, 'same'), call('/emails', body, 'same')])
    expect(results.map(result => result.status)).toEqual([200, 200])
    expect(await results[0].json()).toEqual(await results[1].json())
    expect(deliveries()).toBe(1)
    expect((await call('/emails', { ...body, text: 'different' }, 'same')).status).toBe(409)
    expect((await call('/emails', { ...body, to: ['real@example.com'] }, 'other')).status).toBe(422)
    expect(deliveries()).toBe(1)
  })
  it('persists the successful deduplication ledger and refuses a second writer', async () => {
    const { call, deliveries, dir } = await setup()
    await call('/emails', body, 'restart')
    expect(() => createProvider({ stateDir: dir, apiKey: key })).toThrow()
    // Read the durable ledger independently of the live request handler.
    const fs = await import('node:fs')
    const saved = JSON.parse(fs.readFileSync(join(dir, 'state.json'), 'utf8'))
    expect(Object.values(saved.sends as Record<string, { status: string }>).map(entry => entry.status)).toEqual(['sent'])
    expect(deliveries()).toBe(1)
  })
  it('never delivers when pending intent cannot be persisted', async () => {
    let fail = false
    const fs = await import('node:fs')
    const { call, deliveries } = await setup({ persistState(file: string, state: unknown) { if (fail) throw Error('disk'); fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 }) } })
    fail = true
    expect((await call('/emails', body, 'unsaved')).status).toBe(503)
    expect(deliveries()).toBe(0)
  })
  it('does not publish unsaved success or redeliver after ambiguous completion', async () => {
    const fs = await import('node:fs')
    const { call, deliveries } = await setup({ persistState(file: string, state: { sends: Record<string, { status: string }> }) { if (Object.values(state.sends).some(send => send.status === 'sent')) throw Error('disk'); fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 }) } })
    expect((await call('/emails', body, 'ambiguous')).status).toBe(503)
    expect((await call('/emails', body, 'ambiguous')).status).toBe(409)
    expect(deliveries()).toBe(1)
  })
})
