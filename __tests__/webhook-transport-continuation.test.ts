import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:https'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  dns: [] as Array<{ address: string; family: number }>, dnsCalls: 0,
  port: 0, certificate: '', connects: 0, pinned: [] as string[], status: 200,
  received: [] as Array<{ path: string; body: string; proof: string | undefined }>,
}))
vi.mock('node:dns/promises', () => ({ lookup: async () => {
  fixture.dnsCalls += 1
  return fixture.dns
} }))
vi.mock('node:https', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:https')>()
  return { ...original, request: (url: URL, options: import('node:https').RequestOptions,
    callback: Parameters<typeof original.request>[1]) => {
    fixture.connects += 1
    // Synthetic socket routing is confined to this test. The production
    // policy still validates the public DNS result and supplies its pinned
    // lookup; record that pin before routing to the isolated TLS listener.
    const pinnedLookup = options.lookup!
    pinnedLookup(url.hostname, { family: 0, hints: 0 }, (error, address) => {
      if (error) throw error
      fixture.pinned.push(String(address))
    })
    return original.request(new URL(`https://127.0.0.1:${fixture.port}${url.pathname}${url.search}`), {
      ...options, agent: false, servername: 'partner.example.test', ca: fixture.certificate,
      lookup: undefined,
    }, callback as (response: import('node:http').IncomingMessage) => void)
  } }
})

import { createServer } from 'node:https'
import { postPublicWebhook, PublicWebhookTargetError } from '@/lib/integrations/publicWebhookTransport'

let server: Server, directory: string
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'gridex-synthetic-webhook-tls-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=partner.example.test', '-addext', 'subjectAltName=DNS:partner.example.test',
    '-keyout', join(directory, 'synthetic-key.pem'), '-out', join(directory, 'synthetic-cert.pem')], { stdio: 'ignore' })
  fixture.certificate = readFileSync(join(directory, 'synthetic-cert.pem'), 'utf8')
  server = createServer({ key: readFileSync(join(directory, 'synthetic-key.pem')), cert: fixture.certificate }, (request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      fixture.received.push({ path: request.url ?? '', body: Buffer.concat(chunks).toString(), proof: request.headers['x-synthetic-proof'] as string | undefined })
      response.writeHead(fixture.status, fixture.status === 307 ? { location: `https://127.0.0.1:${fixture.port}/private` } : {})
      response.end(fixture.status === 307 ? 'redirect denied' : 'synthetic accepted')
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve)
  })
  fixture.port = (server.address() as { port: number }).port
}, 15_000)
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  if (directory) rmSync(directory, { recursive: true, force: true })
})
beforeEach(() => {
  fixture.dns = [{ address: '8.8.8.8', family: 4 }]; fixture.dnsCalls = 0
  fixture.connects = 0; fixture.pinned = []; fixture.received = []; fixture.status = 200
})
const send = (url = 'https://partner.example.test/webhook?synthetic=1') => postPublicWebhook({
  url, body: '{"synthetic":true}', headers: new Headers({ 'content-type': 'application/json', 'x-synthetic-proof': 'exact-bytes' }),
  signal: AbortSignal.timeout(5_000),
})

describe('webhook validated DNS and synthetic real TLS transport', () => {
  it('a private DNS answer never opens a socket or reaches the loopback listener', async () => {
    fixture.dns = [{ address: '127.0.0.1', family: 4 }]
    await expect(send()).rejects.toBeInstanceOf(PublicWebhookTargetError)
    expect(fixture.connects).toBe(0); expect(fixture.received).toEqual([])
  })

  it('mixed public/private DNS answers fail closed before any connection', async () => {
    fixture.dns = [{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }]
    await expect(send()).rejects.toBeInstanceOf(PublicWebhookTargetError)
    expect(fixture.connects).toBe(0); expect(fixture.received).toEqual([])
  })

  it('uses one validated DNS pin while the TLS listener receives the exact body and headers', async () => {
    const result = await send()
    expect(result).toEqual({ status: 200, ok: true, body: 'synthetic accepted' })
    expect(fixture.dnsCalls).toBe(1); expect(fixture.pinned).toEqual(['8.8.8.8'])
    expect(fixture.received).toEqual([{ path: '/webhook?synthetic=1', body: '{"synthetic":true}', proof: 'exact-bytes' }])
  })

  it('returns a redirect as a failed delivery without following its private target', async () => {
    fixture.status = 307
    expect(await send()).toEqual({ status: 307, ok: false, body: 'redirect denied' })
    expect(fixture.connects).toBe(1); expect(fixture.received.map(item => item.path)).toEqual(['/webhook?synthetic=1'])
  })
})
