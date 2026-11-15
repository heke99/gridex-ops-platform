// Local TEST-only HTTP simulator. No network clients or database access.
import http from 'node:http'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, lstatSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function createDemoProvider({ apiKey, webhookSecret, environment, directory = '/workspace/elklart-runtime/provider' }) {
  if (environment !== 'test') throw new Error('Only explicit test environment is permitted')
  if (typeof apiKey !== 'string' || apiKey.length < 32 || typeof webhookSecret !== 'string' || webhookSecret.length < 32) throw new Error('Private runtime API key and webhook secret (32+ characters) required')
  directory = resolve(directory)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Provider directory cannot be a symlink')
  chmodSync(directory, 0o700)
  const statePath = `${directory}/invoices.json`
  let state = { invoices: {}, events: {} }
  try {
    if (lstatSync(statePath).isSymbolicLink()) throw new Error('Provider state cannot be a symlink')
    state = JSON.parse(readFileSync(statePath, 'utf8'))
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const save = candidate => {
    const temporaryPath = `${statePath}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporaryPath, JSON.stringify(candidate), { mode: 0o600, flag: 'wx' })
      renameSync(temporaryPath, statePath)
      // Publish only after the file replacement succeeds. A failed
      // create must never appear in reconciliation reads from this process.
      state = candidate
    } finally {
      try { unlinkSync(temporaryPath) } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
    }
  }
  const digest = value => createHash('sha256').update(value).digest('hex')
  const fail = (status, detail) => Object.assign(new Error(detail), { status })
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
    try {
      const supplied = Buffer.from(String(req.headers['x-elklart-demo-key'] ?? ''))
      const expected = Buffer.from(apiKey)
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw fail(401, 'Unauthorized')
      const rawPath = req.url.split('?')[0]
      if (/%|\\|\.\./.test(rawPath)) throw fail(400, 'Invalid path')
      const url = new URL(req.url, 'http://127.0.0.1:38480')
      let raw = ''
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 2_000_000) throw fail(413, 'Body too large') }
      let body
      try { body = raw ? JSON.parse(raw) : null } catch { throw fail(400, 'Invalid JSON') }
      if (req.method === 'GET' && url.pathname === '/v1/Invoices/Ping') return send(200, { environment: 'test', simulator: 'Elklart' })
      if (url.pathname === '/v1/Invoices') {
        if (req.method === 'GET') {
          const match = /^externalReferenceCode eq '((?:[^']|'')*)'$/.exec(url.searchParams.get('$filter') ?? '')
          if (!match) throw fail(400, 'Exact externalReferenceCode filter required')
          const value = Object.values(state.invoices).filter(row => row.externalReferenceCode === match[1].replaceAll("''", "'"))
          return send(200, { value, count: value.length, total: value.length, skip: 0 })
        }
        if (req.method === 'PUT') {
          const item = Array.isArray(body) && body.length === 1 ? body[0] : null
          if (!item || typeof item.externalReferenceCode !== 'string' || !item.externalReferenceCode.trim() || !item.customer || !Array.isArray(item.debts) || !item.debts.length || item.debts.some(debt => !Number.isFinite(debt.originalPrincipal) || !Number.isFinite(debt.remainingPrincipal))) throw fail(422, 'One invoice with stable reference, customer and valid debts required')
          const hash = digest(item.externalReferenceCode)
          const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
          const payloadHash = digest(JSON.stringify(item))
          const existing = state.invoices[id]
          if (existing && existing.payloadHash !== payloadHash) throw fail(409, 'Reference already exists with different invoice content')
          if (!existing) {
            const candidate = structuredClone(state)
            candidate.invoices[id] = { ...item, invoiceGuid: id, payloadHash, status: 2, financeStatus: 1 }
            save(candidate)
          }
          return send(200, { invoiceGuids: [id] })
        }
      }
      const match = /^\/v1\/Invoices\/([a-f0-9-]{36})(?:\/(FinancialDetails|Transactions|Purchase|Recourse|Dispute|Deprecate))?$/.exec(url.pathname)
      if (match) {
        const row = state.invoices[match[1]]
        if (!row) throw fail(404, 'Invoice not found')
        const operation = match[2]
        if (req.method === 'GET') {
          if (!operation) { const invoice = { ...row }; delete invoice.payloadHash; return send(200, invoice) }
          if (operation === 'FinancialDetails') return send(200, { originalPrincipal: row.debts.reduce((sum, debt) => sum + debt.originalPrincipal, 0), remainingPrincipal: row.debts.reduce((sum, debt) => sum + debt.remainingPrincipal, 0) })
          if (operation === 'Transactions') return send(200, { value: [] })
          if (operation === 'Purchase' || operation === 'Recourse') return send(200, row[operation] ?? {})
        }
        // These documented client endpoints return opaque JSON; preserve their request.
        if (req.method === 'POST' && ['Purchase', 'Dispute', 'Deprecate'].includes(operation)) {
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(422, 'Object required')
          const candidate = structuredClone(state)
          candidate.invoices[match[1]][operation] = body
          save(candidate)
          return send(200, body)
        }
      }
      // Demo control surface, never presented as an Aptic endpoint. Returns an
      // envelope for an operator to deliver to OPS; performs no outbound request.
      if (req.method === 'POST' && url.pathname === '/__demo/events') {
        if (!body || typeof body.invoiceGuid !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.invoiceGuid) || !Object.hasOwn(state.invoices, body.invoiceGuid) || state.invoices[body.invoiceGuid]?.invoiceGuid !== body.invoiceGuid || !['registered', 'unpaid', 'paid', 'credited', 'disputed', 'overdue'].includes(body.status) || typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.id) || typeof body.occurred_at !== 'string' || !Number.isFinite(Date.parse(body.occurred_at))) throw fail(422, 'Known invoice, stable event id, supported status and event time required')
        const payload = { id: body.id, invoiceGuid: body.invoiceGuid, event_type: `invoice.${body.status}`, occurred_at: body.occurred_at, invoice_status: body.status }
        const serialized = JSON.stringify(payload)
        if (Object.hasOwn(state.events, body.id) && state.events[body.id] !== serialized) throw fail(409, 'Event id reused with different payload')
        if (!Object.hasOwn(state.events, body.id)) {
          if (['__proto__', 'constructor', 'prototype'].includes(body.id)) throw fail(422, 'Reserved event id')
          const candidate = structuredClone(state)
          candidate.events[body.id] = serialized
          const row = candidate.invoices[body.invoiceGuid]
          if (!row.lastEventAt || Date.parse(body.occurred_at) >= Date.parse(row.lastEventAt)) {
            row.lastEventAt = body.occurred_at
            row.status = ({ registered: 0, unpaid: 2, paid: 1, credited: 64, overdue: 4, disputed: 0 })[body.status]
          }
          save(candidate)
        }
        const timestamp = Math.floor(Date.now() / 1000)
        return send(200, { path: '/api/webhooks/billing/capway_aptic', body: serialized, headers: { 'content-type': 'application/json', 'x-gridex-timestamp': String(timestamp), 'x-gridex-signature': createHmac('sha256', webhookSecret).update(`${timestamp}.${serialized}`).digest('hex') } })
      }
      throw fail(404, 'Unsupported simulator route')
    } catch (error) { send(error.status ?? 500, { detail: error.status ? error.message : 'Private provider storage error' }) }
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createDemoProvider({ apiKey: process.env.ELKLART_CAPWAY_API_KEY, webhookSecret: process.env.ELKLART_CAPWAY_WEBHOOK_SECRET, environment: process.env.ELKLART_CAPWAY_ENVIRONMENT })
  server.listen(38480, '127.0.0.1', () => process.stdout.write('Elklart TEST provider listening on http://127.0.0.1:38480\n'))
}
