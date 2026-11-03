// Actual enqueue/dispatch/projection/safety/credential/HMAC code with finite
// database, tenant and final transport ports. No service or provider is started.
import { createHash, createHmac } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DomainEventRow } from '@/lib/events/domainEvents'

type Row = Record<string, unknown>
type Post = { url: string; headers: Headers; body: string; signal: AbortSignal }
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>, references: {} as Record<string, string>,
  posts: [] as Post[], statuses: [] as number[], allowed: true, nextId: 100,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    if (!(table in io.tables)) throw new Error(`Undeclared table ${table}`)
    let patch: Row | null = null, inserted: Row[] | null = null, single = false, maximum = Infinity
    const filters: Array<(row: Row) => boolean> = []
    const query = {
      select: () => query,
      update: (value: Row) => { patch = value; return query },
      upsert: (rows: Row[], options: { onConflict: string; ignoreDuplicates: boolean }) => {
        if (table !== 'webhook_deliveries' || options.onConflict !== 'idempotency_key' || !options.ignoreDuplicates) throw new Error('Undeclared upsert')
        inserted = rows; return query
      },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query },
      lt: (key: string, value: string) => { filters.push(row => typeof row[key] === 'string' && String(row[key]) < value); return query },
      lte: (key: string, value: string) => { filters.push(row => typeof row[key] === 'string' && String(row[key]) <= value); return query },
      order: () => query,
      limit: (value: number) => { maximum = value; return query },
      maybeSingle: () => { single = true; return query },
      async then<T, U = never>(resolve: (value: { data: Row[] | Row | null; error: null }) => T | PromiseLike<T>, reject?: (error: unknown) => U | PromiseLike<U>) {
        if (inserted) for (const row of inserted) {
          if (!io.tables[table].some(old => old.idempotency_key === row.idempotency_key)) io.tables[table].push({
            id: `00000000-0000-4000-8000-${String(++io.nextId).padStart(12, '0')}`, status: 'queued', attempts: 0,
            next_attempt_at: '2000-01-01T00:00:00.000Z', locked_at: null, locked_by: null,
            public_delivery_id: null, request_body_hash: null, ...structuredClone(row),
          })
        }
        const rows = io.tables[table].filter(row => filters.every(filter => filter(row))).slice(0, maximum)
        if (patch) rows.forEach(row => Object.assign(row, structuredClone(patch)))
        if (single && rows.length > 1) throw new Error('Ambiguous finite row observation')
        return Promise.resolve({ data: single ? rows[0] ? structuredClone(rows[0]) : null : structuredClone(rows), error: null }).then(resolve, reject)
      },
    }
    return query
  },
} }))
vi.mock('@/lib/tenant/operationPolicy', () => ({ getTenantOperationDecision: async (_company: string, operation: string) => {
  if (operation !== 'webhook.deliver') throw new Error('Undeclared tenant operation')
  return io.allowed ? { allowed: true, company_status: 'active' } : { allowed: false, company_status: 'closed', reason_code: 'tenant_closed' }
} }))
vi.mock('@/lib/integrations/tenantContext', () => ({ loadExternalTenantReference: async (company: string) => {
  if (!io.references[company]) throw new Error('Missing exact finite tenant scope')
  return io.references[company]
} }))
vi.mock('@/lib/integrations/publicWebhookTransport', () => ({ postPublicWebhook: async (input: Post) => {
  io.posts.push({ ...input, headers: new Headers(input.headers) })
  const status = io.statuses.shift() ?? 200
  return { status, ok: status >= 200 && status < 300, body: 'SYNTHETIC transport observation' }
} }))

import { buildPublicWebhookPayload, dispatchDueWebhookDeliveries, enqueueWebhookDeliveriesForEvent } from '@/lib/integrations/webhooks'
import { assertPublicResponsePayload, PublicPayloadSafetyError } from '@/lib/api/publicPayloadSafety'
import { PARTNER_API_VERSION } from '@/lib/partner-api/openApi'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

const COMPANY = '00000000-0000-4000-8000-000000000001'
const EVENT = '00000000-0000-4000-8000-000000000003'
const SITE = '00000000-0000-4000-8000-000000000005'
const CUSTOMER = '00000000-0000-4000-8000-000000000007'
const CLIENT = '00000000-0000-4000-8000-000000000009'
const SCOPE = 'SYNTHETIC-private-tenant-derivation-scope'
const SECRET = 'SYNTHETIC-component-signing-secret-not-a-live-credential'
const SECRET_ENV = 'WEBHOOK_SIGNING_SECRET_PARTNER_PUBLIC_EVENT_TEST'
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const eventReference = `event_${sha(`${SCOPE}:event:${EVENT}`).slice(0, 32)}`
const organizationReference = `organization_${createHash('sha256').update(`gridex-public-reference:v1:${SCOPE}:organization:${SCOPE}`).digest('base64url').slice(0, 32)}`
let previousSecret: string | undefined
beforeAll(() => { previousSecret = process.env[SECRET_ENV]; process.env[SECRET_ENV] = SECRET })
afterAll(() => { if (previousSecret === undefined) delete process.env[SECRET_ENV]; else process.env[SECRET_ENV] = previousSecret })
beforeEach(() => {
  io.posts = []; io.statuses = []; io.allowed = true; io.nextId = 100; io.references = { [COMPANY]: SCOPE }
  io.tables = {
    webhook_subscriptions: [{ id: '00000000-0000-4000-8000-000000000011', company_id: COMPANY, api_client_id: CLIENT,
      status: 'active', endpoint_url: 'https://receiver.example.invalid/webhook', event_types: ['site.created', 'contracts.publication.changed'],
      metadata: { source: 'partner_api' }, custom_headers: {}, timeout_ms: 1000, max_attempts: 3, signing_secret_ref: 'PARTNER_PUBLIC_EVENT_TEST' }],
    integration_api_clients: [{ id: CLIENT, company_id: COMPANY, status: 'active', revoke_reason: null, metadata: {} }],
    webhook_deliveries: [], domain_events: [],
  }
})
function event(): DomainEventRow {
  return { id: EVENT, company_id: COMPANY, event_type: 'site.created', aggregate_type: 'site', aggregate_id: SITE,
    subject_customer_id: CUSTOMER, actor_user_id: null, source: 'synthetic_component', event_version: 1, idempotency_key: null,
    occurred_at: '2026-11-01T07:00:00.000Z', created_at: '2026-11-01T07:00:00.000Z',
    payload: { site_reference: 'site_SYNTHETIC_public_ref', customer_reference: 'customer_SYNTHETIC_public_ref', status: 'active', company_id: COMPANY },
  }
}
async function enqueue(source = event()) {
  io.tables.domain_events = [{ ...structuredClone(source) }]
  expect(await enqueueWebhookDeliveriesForEvent(source, { strict: true })).toBe(1)
  expect(io.tables.webhook_deliveries).toHaveLength(1)
  return io.tables.webhook_deliveries[0]
}
function signedWire(delivery: Row) {
  expect(io.posts).toHaveLength(1)
  const post = io.posts[0], body = JSON.parse(post.body) as Row
  const expectedDelivery = `delivery_${sha(`${organizationReference}:delivery:${delivery.id}`).slice(0, 32)}`
  expect(body.event_id).toBe(eventReference); expect(body.delivery_id).toBe(expectedDelivery)
  expect(post.headers.get('x-gridex-event-id')).toBe(eventReference)
  expect(post.headers.get('x-gridex-delivery-id')).toBe(expectedDelivery)
  expect(post.headers.get('x-gridex-event-type')).toBe('site.created')
  const timestamp = post.headers.get('x-gridex-timestamp')
  expect(timestamp).toMatch(/^\d+$/)
  expect(post.headers.get('x-gridex-signature')).toBe(`sha256=${createHmac('sha256', SECRET).update(`${timestamp}.${post.body}`).digest('hex')}`)
  expect(delivery).toMatchObject({ public_delivery_id: expectedDelivery, request_body_hash: sha(post.body) })
  for (const internal of [COMPANY, EVENT, SITE, CUSTOMER, CLIENT, SCOPE]) expect(post.body).not.toContain(internal)
  expect(post.signal.aborted).toBe(false)
  return body
}

describe('Partner webhook publisher preserves the scoped public event contract', () => {
  it('genuine partner producer reaches signed transport from actual enqueue and dispatch', async () => {
    const source = event(), original = structuredClone(source), delivery = await enqueue(source)
    expect(await dispatchDueWebhookDeliveries()).toEqual({ processed: 1, sent: 1, failed: 0, deliveryUncertain: 0 })
    expect(signedWire(delivery)).toMatchObject({ event_type: 'site.created', created_at: source.occurred_at,
      resource: { type: 'site', reference: 'site_SYNTHETIC_public_ref' }, customer: { customer_reference: 'customer_SYNTHETIC_public_ref' },
      data: { site_reference: 'site_SYNTHETIC_public_ref', status: 'active' }, api_version: PARTNER_API_VERSION })
    expect(delivery).toMatchObject({ status: 'sent', attempts: 1, response_status: 200, locked_at: null, locked_by: null })
    expect(source).toEqual(original); expect(io.tables.domain_events[0]).toEqual(original)
  })
  it('retains enqueue idempotency and never redispatches a completed delivery', async () => {
    const delivery = await enqueue(); await dispatchDueWebhookDeliveries()
    const before = structuredClone(delivery)
    await enqueueWebhookDeliveriesForEvent(event(), { strict: true })
    expect(io.tables.webhook_deliveries).toEqual([before])
    expect(await dispatchDueWebhookDeliveries()).toMatchObject({ processed: 0, sent: 0 })
    expect(io.posts).toHaveLength(1)
  })
  it.each([`event_${'A'.repeat(32)}`, `event_${'a'.repeat(31)}`, `event_${'a'.repeat(33)}`, `event_${'a'.repeat(32)}.extra`, `event_${'a'.repeat(32)} `])('refuses malformed canonical stored event ID %s at its actual publisher boundary', async bad => {
    const delivery = await enqueue(); (delivery.payload as Row).event_id = bad
    expect(await dispatchDueWebhookDeliveries()).toMatchObject({ sent: 0, failed: 1 })
    expect(io.posts).toHaveLength(0)
    expect(delivery).toMatchObject({ status: 'failed', failure_reason: 'Public response contains a forbidden internal field at $.event_id.' })
  })
  it.each([null, EVENT, 42])('rebuilds a noncanonical stored payload only from its exact source when root ID is %j', async bad => {
    const delivery = await enqueue(); (delivery.payload as Row).event_id = bad
    expect(await dispatchDueWebhookDeliveries()).toMatchObject({ sent: 1, failed: 0 })
    signedWire(delivery)
  })
  it('refuses a noncanonical payload with no exact original instead of blessing its ID', async () => {
    const delivery = await enqueue(); (delivery.payload as Row).event_id = EVENT; io.tables.domain_events = []
    expect(await dispatchDueWebhookDeliveries()).toMatchObject({ sent: 0, failed: 1 })
    expect(delivery.failure_reason).toBe('webhook_domain_event_missing'); expect(io.posts).toHaveLength(0)
  })
  it.each([
    { field: 'customer', value: { customer_reference: CUSTOMER }, path: '$.customer.customer_reference' },
    { field: 'aggregate', value: { type: 'site', reference: SITE }, path: '$.resource.reference' },
    { field: 'data', value: { event_id: eventReference }, path: '$.data.event_id' },
    { field: 'data', value: { extra: { id: SITE } }, path: '$.data.extra.id' },
    { field: 'data', value: { storage_path: 'private/example.pdf' }, path: '$.data.storage_path' },
    { field: 'data', value: { secret: { service_role: 'must-not-escape' } }, path: '$.data.secret.service_role' },
  ])('preserves actual recursive refusal at $path after the allowed envelope field', async ({ field, value, path }) => {
    const delivery = await enqueue(); (delivery.payload as Row)[field] = value
    expect(await dispatchDueWebhookDeliveries()).toMatchObject({ sent: 0, failed: 1 })
    expect(io.posts).toHaveLength(0); expect(delivery.failure_reason).toBe(`Public response contains a forbidden internal field at ${path}.`)
  })
  it('keeps the generic public root restriction and existing GETevents path exception', () => {
    expect(() => assertPublicResponsePayload({ event_id: eventReference })).toThrow(PublicPayloadSafetyError)
    expect(() => assertPublicResponsePayload({ data: [{ event_id: eventReference }] })).not.toThrow()
    expect(() => assertPublicResponsePayload({ data: { event_id: eventReference } })).toThrow(PublicPayloadSafetyError)
  })
  it('keeps retry body and public delivery identity after a real controlled HTTP rejection', async () => {
    io.statuses = [500, 200]; const delivery = await enqueue()
    expect(await dispatchDueWebhookDeliveries()).toMatchObject({ sent: 0, failed: 1 })
    expect(delivery.failure_reason).toBe('HTTP 500'); const first = io.posts[0]
    const priorHash = delivery.request_body_hash, priorId = delivery.public_delivery_id
    delivery.next_attempt_at = '2000-01-01T00:00:00.000Z'
    expect(await dispatchDueWebhookDeliveries()).toMatchObject({ sent: 1, failed: 0 })
    expect(io.posts).toHaveLength(2); expect(io.posts[1].body).toBe(first.body)
    expect(delivery).toMatchObject({ attempts: 2, request_body_hash: priorHash, public_delivery_id: priorId })
  })
  it.each([
    { patch: { request_body_hash: 'f'.repeat(64) }, reason: 'webhook_representation_reconciliation_required' },
    { patch: { public_delivery_id: `delivery_${'f'.repeat(32)}` }, reason: 'webhook_delivery_identity_reconciliation_required' },
  ])('retains existing reconciliation refusal $reason without transport', async ({ patch, reason }) => {
    const delivery = await enqueue(); Object.assign(delivery, patch)
    expect(await dispatchDueWebhookDeliveries()).toMatchObject({ sent: 0, failed: 1 })
    expect(delivery.failure_reason).toBe(reason); expect(io.posts).toHaveLength(0)
  })
  it('keeps credential security revocation ahead of the publisher and transport', async () => {
    const delivery = await enqueue(); Object.assign(io.tables.integration_api_clients[0], { status: 'revoked', revoke_reason: '[revoke_kind:security_revocation] SYNTHETIC' })
    expect(await dispatchDueWebhookDeliveries()).toMatchObject({ sent: 0, failed: 1 })
    expect(delivery.failure_reason).toBe('webhook_credential_security_revoked'); expect(io.posts).toHaveLength(0)
  })
  it.each([WEBSITE_INTEGRATION_CONTRACT_VERSION, '2026-10-04.1'])('keeps actual website profile %s outside the partner exception', async revision => {
    io.tables.webhook_subscriptions[0].metadata = {}
    io.tables.integration_api_clients[0].metadata = { api_contract_profiles: { website: revision } }
    const delivery = await enqueue(); const canonical = buildPublicWebhookPayload(event(), SCOPE)
    expect(await dispatchDueWebhookDeliveries()).toMatchObject({ sent: 1, failed: 0 })
    const body = signedWire(delivery)
    expect(body.aggregate).toEqual(canonical.aggregate); expect(body.contract_schema_version).toBe(revision)
    expect(body).not.toHaveProperty('api_version'); expect(io.posts[0].headers.get('x-gridex-contract-version')).toBe(revision)
  })
  it('keeps the original publication revision token on website wire and omits it from partner wire', async () => {
    const source = { ...event(), event_type: 'contracts.publication.changed', aggregate_type: 'contract_publication', payload: {
      channel: 'api', publication_revision: 1, revision_token: '00000000-0000-4000-8000-000000000015', reason: 'published', timestamp: '2026-11-01T07:00:00.000Z',
    } }
    await enqueue(source); expect(await dispatchDueWebhookDeliveries()).toMatchObject({ sent: 1, failed: 0 })
    expect((JSON.parse(io.posts[0].body) as { data: Row }).data).not.toHaveProperty('revision_token')
    io.posts = []; io.tables.webhook_deliveries = []; io.tables.webhook_subscriptions[0].metadata = {}
    await enqueue(source); expect(await dispatchDueWebhookDeliveries()).toMatchObject({ sent: 1, failed: 0 })
    expect((JSON.parse(io.posts[0].body) as { data: Row }).data.revision_token).toBe(source.payload?.revision_token)
  })
})
