// poa-mail-review: #2, #4, #11, #14, #18
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/poaMailFakeDb'

const port = vi.hoisted(() => ({
  db: null as unknown as { client: unknown },
  sends: [] as Array<Record<string, unknown>>,
  sendImpl: null as null | ((input: Record<string, unknown>) => Promise<{ providerMessageId: string; status: 'sent' }>),
}))

vi.mock('@/lib/supabase/service', () => ({
  get supabaseService() { return port.db.client },
}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/tenant/operationPolicy', () => ({
  getTenantOperationDecision: async () => ({ allowed: true, reason_code: 'ok', company_status: 'active' }),
}))
vi.mock('@/lib/email/providers', () => ({
  getEmailProvider: () => ({
    sendEmail: async (input: Record<string, unknown>) => {
      port.sends.push(input)
      return port.sendImpl ? port.sendImpl(input) : { providerMessageId: `msg-${port.sends.length}`, status: 'sent' as const }
    },
  }),
}))

import { processManualEmailOutbox } from '@/lib/email/manualEmailOutbox'

const CO = '11111111-1111-4111-8111-111111111111'
const REQ = '22222222-2222-4222-8222-222222222222'
const OUT = '33333333-3333-4333-8333-333333333333'
const GO = '44444444-4444-4444-8444-444444444444'
const PDF = Buffer.from('%PDF-1.4 fullmakt').toString('base64')

function seed(overrides: { poa?: Record<string, unknown>; contactEmail?: string } = {}): FakeDb {
  return createFakeDb({
    manual_email_outbox: [{
      id: OUT, company_id: CO, request_id: REQ, to_email: 'anlaggning@owner.example', actual_recipient_email: 'anlaggning@owner.example',
      from_email: 'ops@gridex.example', reply_to: 'ops@gridex.example', subject: 'S', body_html: '<p>x</p>', body_text: 'x',
      attachments: [{ filename: 'fullmakt.pdf', content: PDF, contentType: 'application/pdf', kind: 'power_of_attorney_generated_pdf' }],
      status: 'queued', external_delivery: true, next_attempt_at: '2000-01-01T00:00:00.000Z', queued_at: '2026-10-01T00:00:00.000Z',
      attempts: 0, idempotency_key: 'manual-facility-request:key', provider_idempotency_key: 'manual-facility-request:key',
      recipient_resolution: { resolution_mode: 'real_grid_owner_contact', selected_to_email: 'anlaggning@owner.example' },
    }],
    grid_owner_information_requests: [{
      id: REQ, company_id: CO, customer_id: 'cu-1', customer_site_id: 'site-1', status: 'manual_email_queued', grid_owner_id: GO,
      poa_id: 'poa-1', requires_poa: true, recipient_email: 'anlaggning@owner.example', recipient_contact_channel_id: null,
      metadata: { channel_type: 'facility_information_request' },
    }],
    powers_of_attorney: [{
      id: 'poa-1', company_id: CO, customer_id: 'cu-1', status: 'signed', accepted_at: '2026-09-01T10:00:00Z',
      valid_from: '2026-09-01', valid_to: '2099-01-01', revoked_at: null, ...overrides.poa,
    }],
    grid_owner_contact_channels: [{
      id: 'cc-1', grid_owner_id: GO, company_id: null, channel_type: 'facility_information_request', email: overrides.contactEmail ?? 'anlaggning@owner.example',
      source: 'platform_default', is_enabled: true, is_verified: true, verified_at: '2026-09-01T00:00:00Z',
    }],
    customer_sites: [{ id: 'site-1', company_id: CO }],
    customers: [{ id: 'cu-1', company_id: CO }],
    ediel_mailboxes: [],
  })
}

const outbox = (db: FakeDb) => db.tables.manual_email_outbox[0]
const request = (db: FakeDb) => db.tables.grid_owner_information_requests[0]

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('GRIDEX_MANUAL_OPS_ENVIRONMENT', '')
  port.sends = []
  port.sendImpl = null
})
afterEach(() => { vi.unstubAllEnvs() })

describe('#2 POA is re-checked right before the provider call', () => {
  for (const [label, poa] of [
    ['revoked', { revoked_at: '2026-10-02T00:00:00Z' }],
    ['expired valid_to', { valid_to: '2026-01-01' }],
    ['not yet valid', { valid_from: '2099-01-01' }],
    ['status revoked', { status: 'revoked' }],
  ] as const) {
    it(`stops a queued mail when the POA is ${label}`, async () => {
      port.db = seed({ poa })
      const result = await processManualEmailOutbox()
      expect(port.sends).toHaveLength(0)
      expect(result.failed).toBe(1)
      expect(outbox(port.db as FakeDb)).toMatchObject({ status: 'failed', last_error_code: 'poa_not_valid', attempts: 1 })
      expect(request(port.db as FakeDb)).toMatchObject({ status: 'needs_review', dispatch_error_code: 'poa_not_valid' })
    })
  }
})

describe('#4 a DB guard rejection on claim is dead-lettered, not retried forever', () => {
  it('marks the row failed with attempts persisted and flags the request', async () => {
    const db = seed()
    db.hooks.push(({ table, next }) =>
      table === 'manual_email_outbox' && ['queued', 'sending'].includes(String(next.status))
        ? { code: '23514', message: 'manual_facility_outbox_requires_canonical_geographic_site_owner' }
        : null)
    port.db = db
    const first = await processManualEmailOutbox()
    expect(port.sends).toHaveLength(0)
    expect(first.failed).toBe(1)
    expect(outbox(db)).toMatchObject({ status: 'failed', attempts: 1, last_error_code: 'outbox_guard_rejected' })
    expect(request(db)).toMatchObject({ status: 'needs_review', dispatch_error_code: 'outbox_guard_rejected' })
    const second = await processManualEmailOutbox()
    expect(second.scanned).toBe(0)
  })

  it('dead-letters when re-queueing after a transient send error hits the guard', async () => {
    const db = seed()
    port.db = db
    port.sendImpl = async () => {
      db.hooks.push(({ table, next }) =>
        table === 'manual_email_outbox' && String(next.status) === 'queued'
          ? { code: '23514', message: 'manual_grid_owner_outbox_requires_verified_site_owner' }
          : null)
      throw new Error('provider timeout')
    }
    await processManualEmailOutbox()
    expect(outbox(db)).toMatchObject({ status: 'failed', attempts: 1, last_error_code: 'outbox_guard_rejected', locked_by: null })
    expect(request(db).status).toBe('needs_review')
  })

  it('a transient send error keeps the row retryable with the attempt persisted', async () => {
    const db = seed()
    port.db = db
    port.sendImpl = async () => { throw new Error('provider timeout') }
    await processManualEmailOutbox()
    expect(outbox(db)).toMatchObject({ status: 'queued', attempts: 1, last_error_code: 'send_retry', locked_by: null })
    expect((outbox(db).attachments as Array<Record<string, unknown>>)[0].content).toBe(PDF)
  })
})

describe('#11 / #18 successful send', () => {
  it('sets an explicit GX-FIR Message-ID, stores it on the row and purges the PDF content', async () => {
    const db = seed()
    port.db = db
    const result = await processManualEmailOutbox()
    expect(result.sent).toBe(1)
    const sent = port.sends[0]
    const header = (sent.headers as Record<string, string>)['Message-ID']
    expect(header).toBe(`<GX-FIR-${REQ.replace(/-/g, '').toUpperCase()}-${OUT.replace(/-/g, '').toUpperCase()}@gridex.example>`)
    expect((sent.attachments as Array<Record<string, unknown>>)[0].content).toBe(PDF)
    const row = outbox(db)
    expect(row.status).toBe('sent')
    expect((row.recipient_resolution as Record<string, unknown>).rfc_message_id).toBe(header.slice(1, -1).toLowerCase())
    const attachment = (row.attachments as Array<Record<string, unknown>>)[0]
    expect(attachment.content).toBeUndefined()
    expect(attachment).toMatchObject({ filename: 'fullmakt.pdf', size_bytes: Buffer.from(PDF, 'base64').length })
    expect(attachment.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(request(db).status).toBe('waiting_manual_response')
  })
})

describe('#14 recipient is re-resolved at send time', () => {
  it('sends to the current verified contact and records the change', async () => {
    const db = seed({ contactEmail: 'ny-adress@owner.example' })
    port.db = db
    await processManualEmailOutbox()
    expect(port.sends[0].to).toBe('ny-adress@owner.example')
    expect(outbox(db)).toMatchObject({ to_email: 'ny-adress@owner.example', actual_recipient_email: 'ny-adress@owner.example', status: 'sent' })
    expect((outbox(db).recipient_resolution as Record<string, unknown>).recipient_changed_at_send).toMatchObject({
      previous_to_email: 'anlaggning@owner.example', current_to_email: 'ny-adress@owner.example',
    })
    expect(request(db)).toMatchObject({ recipient_email: 'ny-adress@owner.example', recipient_contact_channel_id: 'cc-1' })
  })

  it('stops the send when the contact was removed', async () => {
    const db = seed()
    db.tables.grid_owner_contact_channels[0].is_verified = false
    port.db = db
    await processManualEmailOutbox()
    expect(port.sends).toHaveLength(0)
    expect(outbox(db)).toMatchObject({ status: 'failed', last_error_code: 'grid_owner_contact_missing' })
  })
})

describe('#10 preview deployments never send or fail real grid-owner rows', () => {
  it('leaves the row queued when the environment is not production', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('NODE_ENV', 'production')
    const db = seed()
    port.db = db
    const result = await processManualEmailOutbox()
    expect(port.sends).toHaveLength(0)
    expect(result.skipped).toBe(1)
    expect(outbox(db)).toMatchObject({ status: 'queued', attempts: 0 })
  })
})
