// poa-mail-review: #2, #3, #10, #12, #14
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/poaMailFakeDb'

const port = vi.hoisted(() => ({ db: null as unknown as { client: unknown } }))

vi.mock('@/lib/supabase/service', () => ({
  get supabaseService() { return port.db.client },
}))
vi.mock('@/lib/platform/outboundFreeze', () => ({ assertOutboundAllowed: async () => undefined }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: async () => undefined }))
vi.mock('@/lib/email/fullmaktPdf', () => ({ renderFullmaktPdfBase64: () => Buffer.from('%PDF-1.4').toString('base64') }))
vi.mock('@/lib/email/manualOperationsMailbox', async (orig) => ({
  ...(await orig<object>()),
  resolveManualOperationsMailbox: async () => ({ id: 'mbx', mailboxType: 'facility_information_request', fromEmail: 'ops@gridex.example', replyToEmail: null }),
}))

import { requestMissingFacilityInformation } from '@/lib/customer-operations/requestMissingFacilityInformationCore'

const CO = '11111111-1111-4111-8111-111111111111'
const REQ = '22222222-2222-4222-8222-222222222222'
const GO = '44444444-4444-4444-8444-444444444444'
const BASE_KEY = `manual-facility-request:${CO}:site-1:${GO}:hash-1:facility_identifier_lookup:${REQ}`

function poa(overrides: Record<string, unknown> = {}) {
  return {
    id: 'poa-1', company_id: CO, customer_id: 'cu-1', site_id: 'site-1', status: 'signed', scope: 'facility_information_lookup',
    scope_summary: {}, accepted_at: '2026-09-01T10:00:00Z', signer_name: 'Anna Kund', signer_identity_number: '199001011234',
    method: 'bankid', fullmakt_snapshot: { title: 'Fullmakt' }, source: 'admin', valid_from: '2026-09-01', valid_to: '2099-01-01',
    revoked_at: null, created_at: '2026-09-01T10:00:00Z', ...overrides,
  }
}

function seed(input: { poa?: Record<string, unknown>; request?: Record<string, unknown> | null; outbox?: Array<Record<string, unknown>> } = {}): FakeDb {
  return createFakeDb({
    customer_sites: [{ id: 'site-1', company_id: CO, customer_id: 'cu-1', grid_owner_id: GO, address_hash: 'hash-1', grid_area_code: 'ABC', street: 'Gatan 1', postal_code: '11122', city: 'Stockholm' }],
    customers: [{ id: 'cu-1', company_id: CO, customer_number: 'K1', full_name: 'Anna Kund', personal_number: '199001011234' }],
    companies: [{ id: CO, legal_name: 'Elbolaget AB' }],
    powers_of_attorney: [poa(input.poa)],
    grid_owner_contact_channels: [{ id: 'cc-1', grid_owner_id: GO, company_id: null, channel_type: 'facility_information_request', email: 'anlaggning@owner.example', source: 'platform_default', is_enabled: true, is_verified: true, verified_at: '2026-09-01T00:00:00Z' }],
    grid_owner_information_requests: input.request === null || input.request === undefined ? [] : [{
      id: REQ, company_id: CO, customer_id: 'cu-1', customer_site_id: 'site-1', request_type: 'facility_identifier_lookup', channel: 'manual_email',
      grid_owner_id: GO, site_address_hash: 'hash-1', case_reference: 'GX-FIR-X', metadata: {}, created_at: '2026-09-02T00:00:00Z', ...input.request,
    }],
    manual_email_outbox: input.outbox ?? [],
    power_of_attorney_events: [],
    ediel_mailboxes: [],
  })
}

const run = () => requestMissingFacilityInformation({ companyId: CO, customerId: 'cu-1', siteId: 'site-1', actorUserId: null })

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('GRIDEX_MANUAL_OPS_ENVIRONMENT', '')
  vi.stubEnv('MANUAL_GRID_OWNER_SAFE_RECIPIENT', '')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('baseline', () => {
  it('queues one outbox row and records the chosen contact channel on the request (#14)', async () => {
    const db = seed()
    port.db = db
    const result = await run()
    expect(result.status).toBe('manual_email_queued')
    expect(db.tables.manual_email_outbox).toHaveLength(1)
    const request = db.tables.grid_owner_information_requests[0]
    expect(request).toMatchObject({ status: 'manual_email_queued', recipient_contact_channel_id: 'cc-1', recipient_email: 'anlaggning@owner.example' })
    const insert = db.writes.find((w) => w.table === 'grid_owner_information_requests' && w.op === 'insert')!.payload as Record<string, unknown>
    expect(insert.recipient_contact_channel_id).toBe('cc-1')
    const attached = db.tables.power_of_attorney_events.find((e) => e.event_type === 'attached_to_email')!
    expect((attached.payload as Record<string, unknown>).to_email).toBe('anlaggning@owner.example')
    expect((attached.payload as Record<string, unknown>).recipient_contact_channel_id).toBe('cc-1')
  })
})

describe('#2 queue-time POA lifecycle', () => {
  for (const [label, overrides] of [
    ['revoked_at set', { revoked_at: '2026-09-15T00:00:00Z' }],
    ['valid_to passed', { valid_to: '2026-01-01' }],
    ['valid_from in the future', { valid_from: '2099-01-01' }],
  ] as const) {
    it(`blocks when ${label}`, async () => {
      const db = seed({ poa: overrides })
      port.db = db
      const result = await run()
      expect(result.status).toBe('blocked_missing_poa')
      expect(db.tables.manual_email_outbox).toHaveLength(0)
    })
  }
})

describe('#12 scope_summary false is a denial', () => {
  it('does not accept { facility_information_lookup: false }', async () => {
    const db = seed({ poa: { scope: 'customer_portal', scope_summary: { facility_information_lookup: false, supplier_switch: false } } })
    port.db = db
    expect((await run()).status).toBe('blocked_missing_poa')
    expect(db.tables.manual_email_outbox).toHaveLength(0)
  })

  it('accepts { facility_information_lookup: true }', async () => {
    port.db = seed({ poa: { scope: 'customer_portal', scope_summary: { facility_information_lookup: true } } })
    expect((await run()).status).toBe('manual_email_queued')
  })
})

describe('#3 outbox idempotency collision semantics', () => {
  it('queues a new attempt after a failed send instead of pretending it is queued', async () => {
    const db = seed({
      request: { status: 'needs_review' },
      outbox: [{ id: 'old-row', company_id: CO, request_id: REQ, status: 'failed', idempotency_key: BASE_KEY, to_email: 'fel@owner.example', created_at: '2026-09-03T00:00:00Z' }],
    })
    port.db = db
    const result = await run()
    expect(result.status).toBe('manual_email_queued')
    expect(db.tables.manual_email_outbox).toHaveLength(2)
    const fresh = db.tables.manual_email_outbox.find((row) => row.id !== 'old-row')!
    expect(fresh).toMatchObject({ status: 'queued', to_email: 'anlaggning@owner.example' })
    expect(String(fresh.idempotency_key)).toMatch(new RegExp(`^${BASE_KEY}:attempt:2:[0-9a-f]{16}$`))
    expect(result.emailOutboxId).toBe(fresh.id)
    expect(db.tables.grid_owner_information_requests[0].status).toBe('manual_email_queued')
  })

  it('reuses an active queued row without inserting', async () => {
    const db = seed({
      request: { status: 'manual_email_queued' },
      outbox: [{ id: 'active', company_id: CO, request_id: REQ, status: 'queued', idempotency_key: BASE_KEY, to_email: 'anlaggning@owner.example', created_at: '2026-09-03T00:00:00Z' }],
    })
    port.db = db
    const result = await run()
    expect(result).toMatchObject({ status: 'manual_email_queued', emailOutboxId: 'active' })
    expect(db.tables.manual_email_outbox).toHaveLength(1)
  })

  it('keeps needs_review when the previous delivery is uncertain', async () => {
    const db = seed({
      request: { status: 'needs_review' },
      outbox: [{ id: 'uncertain', company_id: CO, request_id: REQ, status: 'delivery_uncertain', idempotency_key: BASE_KEY, created_at: '2026-09-03T00:00:00Z' }],
    })
    port.db = db
    const result = await run()
    expect(result.status).toBe('needs_review')
    expect(db.tables.manual_email_outbox).toHaveLength(1)
    expect(db.tables.grid_owner_information_requests[0].status).toBe('needs_review')
  })

  it('never moves needs_review to queued when a concurrent writer holds a non-queued row', async () => {
    const db = seed({ request: { status: 'needs_review' } })
    // Simulate the race: the idempotency key exists but the row is not linked
    // to this request in our read (inserted concurrently as failed).
    db.tables.manual_email_outbox.push({ id: 'race', company_id: CO, request_id: 'other', status: 'failed', idempotency_key: BASE_KEY })
    port.db = db
    const result = await run()
    expect(result.status).toBe('needs_review')
    expect(db.tables.grid_owner_information_requests[0].status).toBe('needs_review')
  })

  it('does not queue a duplicate while the grid owner already has the request', async () => {
    const db = seed({
      request: { status: 'waiting_manual_response' },
      outbox: [{ id: 'sent', company_id: CO, request_id: REQ, status: 'sent', idempotency_key: BASE_KEY, created_at: '2026-09-03T00:00:00Z' }],
    })
    port.db = db
    const result = await run()
    expect(result.status).toBe('waiting_manual_response')
    expect(db.tables.manual_email_outbox).toHaveLength(1)
  })
})

describe('#10 environment fails closed', () => {
  it('does not queue a real grid-owner mail when NODE_ENV=production but VERCEL_ENV is preview', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('NODE_ENV', 'production')
    const db = seed()
    port.db = db
    const result = await run()
    expect(result.status).toBe('needs_review')
    expect(result.nextAction.code).toBe('manual_ops_environment_not_production')
    expect(db.tables.manual_email_outbox).toHaveLength(0)
  })
})
