// Actual EVENT callbacks and production enqueue/dispatch with finite I/O ports.
// No listener, network, database, provider or campaign PASS is produced.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const repo = fileURLToPath(new URL('../', import.meta.url))
const digest = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex')
const lit = (value: string) => "'" + value.replaceAll("'", "''") + "'"
type Row = Record<string, unknown>
type Capture = { at: string; host: string; name: string; headers: Record<string, string>; bodyBase64: string; sha256: string; respondedStatus: number }
type Product = { enqueueWebhookDeliveriesForEvent: (event: Row, options?: Row) => Promise<number>; dispatchDueWebhookDeliveries: (limit?: number) => Promise<unknown> }
function load<T>(relative: string, ports: Row, globals: Row = {}): T {
  const exports: Row = {}, filename = path.join(repo, relative)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  runInNewContext(code, { exports, Buffer, URL, Headers, Response, AbortController, TextDecoder,
    require: (name: string) => { if (!Object.hasOwn(ports, name)) throw new Error('Undeclared import: ' + name); return ports[name] },
    console: { log() {}, warn() {}, error() {} }, setTimeout: () => 1, clearTimeout() {}, ...globals }, { filename, timeout: 5000 })
  return exports as T
}
function registry() {
  const cases = new Map<string, () => Promise<void>>(); let setup = async () => {}
  return { cases, setup: () => setup(), vitest: { expect, beforeAll: (fn: () => Promise<void>) => { setup = fn }, describe: (_name: string, fn: () => void) => fn(), it: (name: string, fn: () => Promise<void>) => cases.set(name, fn) } }
}
class Query {
  filters: Array<(row: Row) => boolean> = []; patch: Row | null = null; values: Row[] | null = null; singleValue = false; take = Infinity
  constructor(readonly table: Row[]) {}
  select() { return this }
  eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this }
  in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this }
  lt(key: string, value: string) { this.filters.push(row => typeof row[key] === 'string' && row[key] < value); return this }
  lte(key: string, value: string) { this.filters.push(row => typeof row[key] === 'string' && row[key] <= value); return this }
  order() { return this }
  limit(value: number) { this.take = value; return this }
  update(value: Row) { this.patch = value; return this }
  upsert(value: Row[]) { this.values = value; return this }
  maybeSingle() { this.singleValue = true; return this }
  then<T>(resolve: (result: { data: Row | Row[] | null; error: null }) => T): Promise<T> {
    if (this.values) for (const value of this.values) {
      if (!this.table.some(row => row.idempotency_key === value.idempotency_key)) this.table.push({ id: crypto.randomUUID(), status: 'queued', attempts: 0, next_attempt_at: new Date(0).toISOString(), ...value })
    }
    const selected = this.table.filter(row => this.filters.every(filter => filter(row))).slice(0, this.take)
    if (this.patch) selected.forEach(row => Object.assign(row, this.patch))
    const copied = selected.map(row => ({ ...row }))
    return Promise.resolve(resolve({ data: this.singleValue ? copied[0] ?? null : copied, error: null }))
  }
}
type Fault = 'healthy' | 'wrong-event' | 'header-event' | 'body-event' | 'wrong-resource' | 'wrong-resource-type' | 'wrong-tenant' | 'wrong-customer' | 'wrong-source' | 'wrong-delivery-event' | 'wrong-client' | 'wrong-subscription-source' | 'wrong-subscription-reference' | 'extra-delivery' | 'missing-delivery' | 'extra-capture' | 'missing-capture' | 'receiver-hash' | 'stored-hash' | 'bad-signature' | 'api-500' | 'api-503' | 'api-malformed'
function world(fault: Fault = 'healthy') {
  const reg = registry(), env: Record<string, string> = { SIM_RECEIVER_CTRL_URL: 'http://127.0.0.1:3106', SIM_RECEIVER_HOSTS: 'a.t5.sim.invalid,b.t5.sim.invalid', CRON_SECRET: 'synthetic-only', RESEND_WEBHOOK_SECRET: 'whsec_' + Buffer.from('synthetic-inbound-key').toString('base64') }
  const tables: Record<string, Row[]> = { webhook_subscriptions: [], webhook_deliveries: [], domain_events: [], companies: [], customers: [], customer_sites: [], integration_api_clients: [] }
  const captures: Capture[] = [], secrets = new Map<string, string>(), modes = new Map<string, { status: number; delayMs: number }>()
  const inboundIds = new Set<string>()
  const calls = { apiSubscribe: 0, sqlSubscribe: 0, enqueue: 0, nativeReplay: 0, posts: 0 }
  const service = { from: (name: string) => { if (!tables[name]) throw new Error('Undeclared table: ' + name); return new Query(tables[name]) } }
  const credential = load<Row>('lib/integrations/webhookCredentialPolicy.ts', { '@/lib/supabase/service': { supabaseService: service } })
  const safety = load<Row>('lib/api/publicPayloadSafety.ts', {})
  const refs = load<Row>('lib/integrations/publicReferences.ts', { 'node:crypto': crypto })
  const product = load<Product>('lib/integrations/webhooks.ts', {
    'node:crypto': crypto, '@/lib/supabase/service': { supabaseService: service },
    '@/lib/tenant/operationPolicy': { getTenantOperationDecision: async () => ({ allowed: true }) },
    '@/lib/integrations/tenantContext': { loadExternalTenantReference: async (company: string) => String(tables.companies.find(row => row.id === company)?.external_tenant_reference) },
    '@/lib/integrations/websiteIntegrationContract': { WEBSITE_INTEGRATION_CONTRACT_VERSION: '2026-08-16.2' },
    '@/lib/api/publicPayloadSafety': safety, '@/lib/partner-api/openApi': { PARTNER_API_VERSION: '2026-08-17.1' }, '@/lib/integrations/publicReferences': refs,
    '@/lib/integrations/webhookCredentialPolicy': credential,
    '@/lib/integrations/apiResponseProfile': { projectWebsiteWebhookResponse: (value: Row) => value, websiteWebhookResponseRevision: () => 'finite-website-control' },
    '@/lib/integrations/publicWebhookTransport': { postPublicWebhook: async (input: { url: string; headers: Headers; body: string }) => {
      const url = new URL(input.url), name = url.pathname.split('/').at(-1)!, mode = modes.get(name) ?? { status: 200, delayMs: 0 }
      let body = input.body; const headers = Object.fromEntries(input.headers)
      if (name === 'a1' && ['wrong-event', 'header-event', 'body-event', 'wrong-resource', 'wrong-resource-type', 'wrong-customer'].includes(fault)) {
        const parsed = JSON.parse(body)
        if (fault === 'wrong-event' || fault === 'body-event') parsed.event_id = 'event_WRONG'
        if (fault === 'wrong-event' || fault === 'header-event') headers['x-gridex-event-id'] = 'event_WRONG'
        if (fault === 'wrong-event' || fault === 'wrong-resource') { parsed.resource = { type: 'unrelated', reference: 'wrong-site' }; parsed.data.unrelated_note = tables.customer_sites[0].facility_reference }
        if (fault === 'wrong-resource-type') parsed.resource = { ...parsed.resource, type: 'unrelated' }
        if (fault === 'wrong-customer') parsed.customer = { customer_reference: 'customer_FOREIGN', customer_number: 'FOREIGN' }
        body = JSON.stringify(parsed)
        const sub = tables.webhook_subscriptions.find(row => row.endpoint_url === input.url)!
        headers['x-gridex-signature'] = 'sha256=' + crypto.createHmac('sha256', secrets.get(String(sub.id))!).update(headers['x-gridex-timestamp'] + '.' + body).digest('hex')
        input.body = body
      }
      if (fault === 'bad-signature' && name === 'a1') headers['x-gridex-signature'] = 'sha256=' + '0'.repeat(64)
      const capture = { at: new Date().toISOString(), host: url.hostname, name, headers, bodyBase64: Buffer.from(body).toString('base64'), sha256: digest(body), respondedStatus: mode.status }
      if (!(fault === 'missing-capture' && name === 'a1')) captures.push(capture)
      if (fault === 'extra-capture' && name === 'a1') captures.push({ ...capture })
      calls.posts++
      if (mode.delayMs > 1000) throw new Error('finite transport timeout')
      return { ok: mode.status >= 200 && mode.status < 300, status: mode.status, body: '{}' }
    } },
  }, { process: { env } })
  const enqueue = async (event: Row, options?: Row) => { calls.enqueue++; if (options?.subscriptionIds) calls.nativeReplay++; return product.enqueueWebhookDeliveriesForEvent(event, options) }
  function subscription(company: string, client: string | null, endpoint: string, name: string, secret: string, partnerSource: boolean) {
    const id = crypto.randomUUID(), ref = 'whsub_' + digest(id).slice(0, 24), secretRef = 'finite-' + id
    const row: Row = { id, company_id: company, api_client_id: client, webhook_subscription_reference: ref, name, endpoint_url: endpoint, event_types: ['site.created'], status: 'active', signing_algorithm: 'HMAC-SHA256', signing_secret_ref: secretRef, signing_secret_hash: digest(secret), custom_headers: {}, timeout_ms: 10000, max_attempts: 8, metadata: partnerSource ? { source: 'partner_api', secret_store: 'supabase_vault' } : {}, failure_count: 0 }
    tables.webhook_subscriptions.push(row); secrets.set(id, secret); env['WEBHOOK_SIGNING_SECRET_' + secretRef] = secret
    return row
  }
  const quoted = (sql: string) => [...sql.matchAll(/'((?:''|[^'])*)'/g)].map(match => match[1].replaceAll("''", "'"))
  const psqlRows = (sql: string): Row[] => {
    const lower = sql.toLowerCase(), values = quoted(sql)
    if (lower.includes('from public.webhook_subscriptions')) {
      let rows = tables.webhook_subscriptions.filter(row => values.includes(String(row.webhook_subscription_reference)) || values.includes(String(row.id)))
      if (fault === 'wrong-client') rows = rows.map(row => ({ ...row, api_client_id: crypto.randomUUID() }))
      if (fault === 'wrong-subscription-source') rows = rows.map(row => ({ ...row, metadata: {} }))
      if (fault === 'wrong-subscription-reference') rows = rows.map(row => ({ ...row, webhook_subscription_reference: 'wrong-ref' }))
      return rows
    }
    if (lower.includes('from public.customer_sites')) return tables.customer_sites.filter(row => values.includes(String(row.facility_reference)))
    if (lower.includes('from public.customers')) return tables.customers.filter(row => values.includes(String(row.id)) || values.includes(String(row.customer_reference)))
    if (lower.includes('from public.companies')) return tables.companies.filter(row => values.includes(String(row.id)))
    if (lower.includes('from public.domain_events')) return tables.domain_events.filter(row => values.includes(String(row.aggregate_id)) || values.includes(String(row.id))).map(row => fault === 'wrong-tenant' ? { ...row, company_id: crypto.randomUUID() } : fault === 'wrong-source' ? { ...row, source: 'unrelated-producer' } : row)
    if (lower.includes('from public.webhook_deliveries')) {
      let rows: Row[] = tables.webhook_deliveries.filter(row => values.includes(String(row.webhook_subscription_id))).map(row => ({ ...row, secs_to_next: row.next_attempt_at ? Math.round((Date.parse(String(row.next_attempt_at)) - Date.now()) / 1000) : null }))
      if (fault === 'wrong-delivery-event') rows = rows.map(row => ({ ...row, domain_event_id: crypto.randomUUID() }))
      if (fault === 'extra-delivery') rows.push({ ...rows[0], id: crypto.randomUUID() })
      if (fault === 'missing-delivery') rows = []
      if (fault === 'stored-hash') rows = rows.map(row => ({ ...row, request_body_hash: '0'.repeat(64) }))
      return rows
    }
    throw new Error('Undeclared SQL read: ' + sql)
  }
  const psql = (sql: string) => {
    if (sql.includes('vault.create_secret')) {
      calls.sqlSubscribe++; const values = quoted(sql), company = /select '([^']+)'/.exec(sql)?.[1], endpoint = values.find(value => value.startsWith('https://')), secret = /vault.create_secret\('([^']+)'/.exec(sql)?.[1]
      if (!company || !endpoint || !secret) throw new Error('Undeclared legacy subscription SQL')
      return String(subscription(company, null, endpoint, 'legacy SQL', secret, false).id)
    }
    if (/select customer_reference/i.test(sql)) return String(tables.customers.find(row => sql.includes(String(row.id)))?.customer_reference)
    if (/^insert into public.webhook_deliveries/i.test(sql)) return ''
    if (sql.includes('communication_log_events')) { const id = /provider_event_id='([^']+)'/.exec(sql)?.[1]; return id && inboundIds.has(id) ? '1' : '0' }
    if (/count\(\*\)/i.test(sql)) return '0'
    if (sql.includes('update public.webhook_subscriptions set timeout_ms=1000')) {
      const id = /where id='([^']+)'/.exec(sql)![1]; Object.assign(tables.webhook_subscriptions.find(row => row.id === id)!, { timeout_ms: 1000, max_attempts: 4 }); return ''
    }
    if (sql.includes("update public.webhook_subscriptions set status='paused'")) {
      const id = /id<>'([^']+)'/.exec(sql)![1]; tables.webhook_subscriptions.filter(row => row.id !== id && sql.includes(String(row.company_id))).forEach(row => { row.status = 'paused' }); return ''
    }
    if (sql.includes("update public.webhook_subscriptions set status='active'")) { tables.webhook_subscriptions.forEach(row => { row.status = 'active' }); return '' }
    if (sql.includes('next_attempt_at=now()')) { const id = /where id='([^']+)'/.exec(sql)![1]; tables.webhook_deliveries.find(row => row.id === id)!.next_attempt_at = new Date(0).toISOString(); return '' }
    if (sql.includes('UPDATE public.company_capabilities')) return ''
    throw new Error('Undeclared SQL effect: ' + sql)
  }
  const partner = async (key: { id: string; companyId: string }, method: string, endpoint: string, body?: Row) => {
    if (endpoint === 'webhooks/subscriptions' && method === 'POST') {
      calls.apiSubscribe++
      if (fault === 'api-500' || fault === 'api-503') return { status: fault === 'api-500' ? 500 : 503, json: { error: 'technical failure' }, text: '{}' }
      if (!String(body?.endpoint_url).startsWith('https://') || String(body?.endpoint_url).includes('127.0.0.1')) return { status: 422, json: {}, text: 'webhook_target_not_public' }
      const row = subscription(key.companyId, key.id, String(body!.endpoint_url), String(body!.name), String(body!.signing_secret), true)
      return { status: 201, json: fault === 'api-malformed' ? {} : { data: { webhook_subscription_reference: row.webhook_subscription_reference } }, text: '{}' }
    }
    if (endpoint === 'webhooks/subscriptions' && method === 'GET') return { status: 200, text: '{}', json: { data: { subscriptions: tables.webhook_subscriptions.filter(row => row.company_id === key.companyId && row.api_client_id === key.id) } } }
    if (endpoint.endsWith('/site') && method === 'POST') {
      const customerRef = endpoint.split('/')[1], customer = tables.customers.find(row => row.customer_reference === customerRef)!, id = crypto.randomUUID(), ref = 'site_' + digest(id).slice(0, 24)
      tables.customer_sites.push({ id, company_id: key.companyId, customer_id: customer.id, facility_reference: ref, status: 'draft', data_quality_status: null })
      const event = { id: crypto.randomUUID(), company_id: key.companyId, event_type: 'site.created', aggregate_type: 'site', aggregate_id: ref, subject_customer_id: customer.id, source: 'partner_api_resource_trigger_v2', event_version: 1, idempotency_key: 'finite:' + id, payload: { site_reference: ref, status: 'draft', data_quality_status: null }, occurred_at: new Date().toISOString(), created_at: new Date().toISOString() }
      tables.domain_events.push(event); await enqueue(event)
      return { status: 201, json: { entity_id: ref }, text: '{}' }
    }
    throw new Error('Undeclared partner operation: ' + endpoint)
  }
  const fetchPort = async (input: string | URL, init?: { body?: string }) => {
    const url = String(input)
    if (url.includes('/__reset')) { captures.length = 0; return Response.json({}) }
    if (url.includes('/__requests')) {
      const name = new URL(url).searchParams.get('name'), got = captures.filter(row => row.name === name).map(row => ({ ...row }))
      if (fault === 'receiver-hash') got.forEach(row => { row.sha256 = '0'.repeat(64) })
      // Incorrect signed body is internally consistent as in the preserved prior counterexample.
      if (['wrong-event','header-event','body-event','wrong-resource','wrong-resource-type','wrong-customer'].includes(fault)) got.forEach(row => { const delivery = tables.webhook_deliveries.find(d => d.public_delivery_id === row.headers['x-gridex-delivery-id']); if (delivery) delivery.request_body_hash = row.sha256 })
      return Response.json(got)
    }
    if (url.includes('/__mode')) { const value = JSON.parse(init!.body!); modes.set(value.name, { status: value.status, delayMs: value.delayMs }); return Response.json({}) }
    if (url.includes('/api/webhooks/resend')) {
      const headers = (init as { headers?: Record<string, string> })?.headers ?? {}, id = headers['svix-id'], timestamp = headers['svix-timestamp'], signature = headers['svix-signature']
      if (!id || !timestamp || !signature) return Response.json({}, { status: 400 })
      const expected = 'v1,' + crypto.createHmac('sha256', Buffer.from(env.RESEND_WEBHOOK_SECRET.slice(6), 'base64')).update(`${id}.${timestamp}.${init?.body}`).digest('base64')
      if (signature !== expected) return Response.json({}, { status: 401 })
      const duplicate = inboundIds.has(id); inboundIds.add(id); return Response.json({ duplicate })
    }
    if (url.includes('/api/internal/webhooks/dispatch')) return Response.json(await product.dispatchDueWebhookDeliveries(50))
    throw new Error('Undeclared HTTP operation')
  }
  load('scripts/simulation/track5/scenarios/event01.test.ts', {
    'node:crypto': crypto, vitest: reg.vitest,
    '../lib': { sim: { appUrl: 'http://127.0.0.1:3105' }, requireEnv: (name: string) => env[name], psql, psqlRows },
    '../lib/partner': { partner, createPartnerClient: (companyId: string, scopes: string[]) => { const client = { id: crypto.randomUUID(), companyId, token: 'synthetic-only', scopes }; tables.integration_api_clients.push({ id: client.id, company_id: companyId, status: 'active' }); return client }, brief: () => 'finite response' },
    '../lib/t5-world': { lit, createCompany: () => { const id = crypto.randomUUID(); tables.companies.push({ id, status: 'active', external_tenant_reference: 'tenant_' + digest(id).slice(0, 24) }); return id }, createCustomer: (company: string) => { const id = crypto.randomUUID(); tables.customers.push({ id, company_id: company, customer_reference: 'customer_' + digest(id).slice(0, 24), customer_number: 'C' + tables.customers.length }); return id } },
    '../lib/receipts': { sha256: digest, receipt() {} }, '@/lib/integrations/webhooks': { enqueueWebhookDeliveriesForEvent: enqueue },
    '@/lib/partner-api/openApi': { PARTNER_API_VERSION: '2026-08-17.1' }, '@/lib/integrations/publicReferences': refs,
  }, { fetch: fetchPort, setTimeout: (fn: () => void) => { fn(); return 1 } })
  return { calls, captures, tables, prepare: () => reg.setup(), run: async (prefix: string) => { const callback = [...reg.cases].find(([title]) => title.startsWith(prefix))?.[1]; if (!callback) throw new Error('Missing actual EVENT callback'); await callback() } }
}
describe('actual EVENT source and signed partner receipt qualification', () => {
  it('accepts the actual production enqueue→dispatch→HMAC partner wire', async () => {
    const c = world(); await c.prepare(); await c.run('EVENT01.01 ')
    expect(c.calls.apiSubscribe).toBe(2); expect(c.calls.sqlSubscribe).toBe(0)
    expect(c.calls.enqueue).toBe(1); expect(c.calls.posts).toBe(1)
    const wire = JSON.parse(Buffer.from(c.captures[0].bodyBase64, 'base64').toString())
    expect(wire.resource.type).toBe('site')
    expect(wire.customer.customer_reference).not.toBe(c.tables.customers[0].customer_reference)
    expect(wire.customer.customer_number).toBeNull()
  })
  it.each(['wrong-event','header-event','body-event','wrong-resource','wrong-resource-type','wrong-tenant','wrong-customer','wrong-source','wrong-delivery-event','wrong-client','wrong-subscription-source','wrong-subscription-reference','extra-delivery','missing-delivery','extra-capture','missing-capture','receiver-hash','stored-hash','bad-signature','api-500','api-503','api-malformed'] as const)('refuses %s despite otherwise qualified finite setup', async fault => {
    const c = world(fault); await c.prepare()
    const expected: Record<Exclude<Fault, 'healthy'>, RegExp> = {
      'wrong-event': /public source event ID/, 'header-event': /public source event ID/,
      'body-event': /body source event ID/, 'wrong-resource': /exact source resource/,
      'wrong-resource-type': /exact source resource/, 'wrong-customer': /exact source customer/,
      'wrong-tenant': /originating source identity/, 'wrong-source': /originating source identity/,
      'wrong-delivery-event': /exact delivery source\/subscription identity/,
      'wrong-client': /exact subscription client\/source identity/,
      'wrong-subscription-source': /exact subscription client\/source identity/,
      'wrong-subscription-reference': /exact subscription client\/source identity/,
      'extra-delivery': /one delivery for assigned subscription/, 'missing-delivery': /one delivery for assigned subscription/,
      'extra-capture': /mottagna POST till A/, 'missing-capture': /mottagna POST till A/,
      'receiver-hash': /receiver exact byte hash/, 'stored-hash': /stored exact byte hash/,
      'bad-signature': /HMAC over original bytes/,
      'api-500': /actual partner subscription create/, 'api-503': /actual partner subscription create/,
      'api-malformed': /EVENT_HARNESS_PRECONDITION: malformed public object/,
    }
    await expect(c.run('EVENT01.01 ')).rejects.toThrow(expected[fault])
    const beforeDispatch = ['wrong-tenant', 'wrong-source', 'wrong-client', 'wrong-subscription-source', 'wrong-subscription-reference', 'api-500', 'api-503', 'api-malformed'].includes(fault)
    expect(c.calls.posts, 'negative reaches its intended physical stage').toBe(beforeDispatch ? 0 : 1)
    expect(c.calls.sqlSubscribe, 'technical/identity failure never falls back to SQL').toBe(0)
  })
  it('replays the genuine supported own-event enqueue without a second physical receipt', async () => {
    const c = world(); await c.prepare(); await c.run('EVENT01.01 '); await c.run('EVENT01.03 ')
    expect(c.calls.nativeReplay).toBe(1); expect(c.captures.filter(row => row.name === 'a1')).toHaveLength(1)
  })
  it('qualifies the real tenantB producer wire while keeping A events out of B', async () => {
    const c = world(); await c.prepare(); await c.run('EVENT01.01 '); await c.run('EVENT01.05 ')
    expect(c.captures.filter(row => row.name === 'b1')).toHaveLength(1)
  })
  it('preserves actual production retry/backoff/deadletter semantics under the declared finite clock fixture', async () => {
    const c = world(); await c.prepare(); await c.run('EVENT01.01 '); await c.run('EVENT01.04 ')
    expect(c.captures.filter(row => row.name === 'retry')).toHaveLength(4)
  })
})
