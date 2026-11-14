import { afterEach, describe, expect, it } from 'vitest'
import { createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, statSync, renameSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { createDemoProvider } from '../scripts/demo/elklart-capway-provider.mjs'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
function serverPort(server: Server): number {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected listening TCP server address')
  return address.port
}
async function runtime() {
  const directory = mkdtempSync(join(tmpdir(), 'elklart-provider-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const apiKey = randomBytes(32).toString('hex')
  const webhookSecret = randomBytes(32).toString('hex')
  const options = { directory, apiKey, webhookSecret, environment: 'test' }
  const server = createDemoProvider(options)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => closeServer(server))
  const base = `http://127.0.0.1:${serverPort(server)}`
  const request = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { 'x-elklart-demo-key': apiKey }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { request, base, options, directory, server, webhookSecret }
}
const invoice = { externalReferenceCode: "demo-'invoice", customer: { firstname: 'Anna' }, debts: [{ originalPrincipal: 100, remainingPrincipal: 100 }], document: [{ originalFileName: 'demo.pdf', fileDataBase64: 'JVBERg==' }] }

describe('Elklart Capway HTTP boundary', () => {
  it('requires private credentials and explicit TEST configuration', () => {
    expect(() => createDemoProvider({ environment: 'production', apiKey: undefined, webhookSecret: undefined })).toThrow(/test/)
    expect(() => createDemoProvider({ environment: 'test', apiKey: 'weak', webhookSecret: undefined })).toThrow(/Private/)
  })
  it('authenticates, persists and reconciles idempotently by external reference', async () => {
    const rt = await runtime()
    expect((await fetch(rt.base + '/v1/Invoices/Ping')).status).toBe(401)
    expect((await rt.request('/v1/Invoices/Ping')).status).toBe(200)
    writeFileSync(rt.directory + '/invoices.json.tmp', 'stale legacy temporary file', { mode: 0o600 })
    const first = await (await rt.request('/v1/Invoices', 'PUT', [invoice])).json()
    const replay = await (await rt.request('/v1/Invoices', 'PUT', [invoice])).json()
    expect(replay).toEqual(first)
    const guid = first.invoiceGuids[0]
    const query = new URLSearchParams({ $filter: "externalReferenceCode eq 'demo-''invoice'", $top: '2' })
    expect((await (await rt.request('/v1/Invoices?' + query)).json()).value).toHaveLength(1)
    expect((await (await rt.request('/v1/Invoices/' + guid)).json()).document).toEqual(invoice.document)
    expect((await rt.request('/v1/Invoices', 'PUT', [{ ...invoice, debts: [{ originalPrincipal: 101, remainingPrincipal: 101 }] }])).status).toBe(409)
    expect(statSync(rt.directory + '/invoices.json').mode & 0o777).toBe(0o600)
    // Reload the on-disk state through a fresh server, not a mocked persistence layer.
    const restored = createDemoProvider(rt.options)
    await new Promise<void>(resolve => restored.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => closeServer(restored))
    expect((await fetch(`http://127.0.0.1:${serverPort(restored)}/v1/Invoices/${guid}`, { headers: { 'x-elklart-demo-key': rt.options.apiKey } })).status).toBe(200)
  })
  it('returns signed ordinary-ingress envelopes, corrects status, rejects conflicting replay and traversal', async () => {
    const rt = await runtime()
    const { invoiceGuids: [guid] } = await (await rt.request('/v1/Invoices', 'PUT', [invoice])).json()
    const event = { id: 'evt-1', invoiceGuid: guid, status: 'paid', occurred_at: '2026-11-10T12:00:00Z' }
    const prototypeBefore = Object.getOwnPropertyDescriptors(Object.prototype)
    for (const invoiceGuid of ['__proto__', 'constructor', 'prototype']) {
      expect((await rt.request('/__demo/events', 'POST', { ...event, invoiceGuid })).status).toBe(422)
    }
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototypeBefore)
    const envelope = await (await rt.request('/__demo/events', 'POST', event)).json()
    expect(envelope.path).toBe('/api/webhooks/billing/capway_aptic')
    expect(envelope.headers['x-gridex-signature']).toBe(createHmac('sha256', rt.webhookSecret).update(`${envelope.headers['x-gridex-timestamp']}.${envelope.body}`).digest('hex'))
    expect((await (await rt.request(`/v1/Invoices/${guid}`)).json()).status).toBe(1)
    expect((await rt.request('/__demo/events', 'POST', event)).status).toBe(200)
    expect((await rt.request('/__demo/events', 'POST', { ...event, status: 'unpaid' })).status).toBe(409)
    expect((await rt.request('/__demo/events', 'POST', { ...event, id: 'evt-2', status: 'credited', occurred_at: '2026-11-10T12:01:00Z' })).status).toBe(200)
    expect((await (await rt.request(`/v1/Invoices/${guid}`)).json()).status).toBe(64)
    expect((await rt.request('/v1/Invoices/%2e%2e%2fsecrets')).status).toBe(400)
    expect((await rt.request(`/v1/Invoices/${guid}/Attachments`)).status).toBe(404)
    expect((await rt.request('/v1/Invoices', 'PUT', [])).status).toBe(422)
  })
  it('keeps failed creates and events invisible until persistence succeeds', async () => {
    const rt = await runtime()
    const { invoiceGuids: [guid] } = await (await rt.request('/v1/Invoices', 'PUT', [invoice])).json()
    const before = readFileSync(rt.directory + '/invoices.json', 'utf8')
    // A real filesystem failure, including when tests run as root.
    const parked = rt.directory + '-parked'
    renameSync(rt.directory, parked)
    writeFileSync(rt.directory, 'blocked', { mode: 0o600 })
    try {
      expect((await rt.request('/v1/Invoices', 'PUT', [{ ...invoice, externalReferenceCode: 'second-invoice' }])).status).toBe(500)
      const query = new URLSearchParams({ $filter: "externalReferenceCode eq 'second-invoice'" })
      expect((await (await rt.request('/v1/Invoices?' + query)).json()).value).toEqual([])
      const event = { id: 'failed-event', invoiceGuid: guid, status: 'paid', occurred_at: '2026-11-10T12:00:00Z' }
      expect((await rt.request('/__demo/events', 'POST', event)).status).toBe(500)
      expect((await (await rt.request(`/v1/Invoices/${guid}`)).json()).status).toBe(2)
      expect((await rt.request(`/v1/Invoices/${guid}/Purchase`, 'POST', { approved: true })).status).toBe(500)
      expect(await (await rt.request(`/v1/Invoices/${guid}/Purchase`)).json()).toEqual({})
      expect(readFileSync(parked + '/invoices.json', 'utf8')).toBe(before)
    } finally {
      rmSync(rt.directory)
      renameSync(parked, rt.directory)
    }
    const retry = await rt.request('/v1/Invoices', 'PUT', [{ ...invoice, externalReferenceCode: 'second-invoice' }])
    expect(retry.status).toBe(200)
    const { invoiceGuids: [secondGuid] } = await retry.json()
    expect(JSON.parse(readFileSync(rt.directory + '/invoices.json', 'utf8')).invoices[secondGuid]).toBeTruthy()
    expect((await rt.request('/__demo/events', 'POST', { id: 'failed-event', invoiceGuid: guid, status: 'paid', occurred_at: '2026-11-10T12:00:00Z' })).status).toBe(200)
    expect(JSON.parse(readFileSync(rt.directory + '/invoices.json', 'utf8')).invoices[guid].status).toBe(1)
  })
})
