// poa-mail-review: #7
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/poaMailFakeDb'

const port = vi.hoisted(() => ({ db: null as unknown as { client: unknown } }))

vi.mock('@/lib/supabase/service', () => ({
  get supabaseService() { return port.db.client },
}))
vi.mock('@/lib/platform/outboundFreeze', () => ({ assertOutboundAllowed: async () => undefined }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: async () => undefined }))
vi.mock('@/lib/email/manualOperationsMailbox', async (orig) => ({
  ...(await orig<object>()),
  resolveManualOperationsMailbox: async () => ({ id: 'mbx', mailboxType: 'facility_information_request', fromEmail: 'ops@gridex.example', replyToEmail: null }),
}))

import { followUpDueAt, runManualGridOwnerFollowUpWatchdog } from '@/lib/customer-operations/manualGridOwnerFollowUps'

const CO = '11111111-1111-4111-8111-111111111111'
const REQ = '22222222-2222-4222-8222-222222222222'
const GO = '44444444-4444-4444-8444-444444444444'

function seed(input: { poa?: Record<string, unknown>; request?: Record<string, unknown>; calendar?: Array<Record<string, unknown>> } = {}): FakeDb {
  return createFakeDb({
    grid_owner_information_requests: [{
      id: REQ, company_id: CO, customer_id: 'cu-1', customer_site_id: 'site-1', grid_owner_id: GO, poa_id: 'poa-1',
      status: 'waiting_manual_response', channel: 'manual_email', case_reference: 'GX-FIR-ABC',
      sent_at: '2026-10-01T10:00:00Z', follow_up_count: 0, next_follow_up_at: null,
      metadata: { channel_type: 'facility_information_request' }, ...input.request,
    }],
    powers_of_attorney: [{ id: 'poa-1', company_id: CO, customer_id: 'cu-1', status: 'signed', accepted_at: '2026-09-01T10:00:00Z', valid_to: '2099-01-01', ...input.poa }],
    grid_owner_contact_channels: [{ id: 'cc-1', grid_owner_id: GO, company_id: null, channel_type: 'facility_information_request', email: 'anlaggning@owner.example', source: 'platform_default', is_enabled: true, is_verified: true, verified_at: '2026-09-01T00:00:00Z' }],
    customers: [{ id: 'cu-1', company_id: CO, full_name: 'Anna Kund' }],
    customer_sites: [{ id: 'site-1', company_id: CO, street: 'Gatan 1', postal_code: '11122', city: 'Stockholm' }],
    companies: [{ id: CO, legal_name: 'Elbolaget AB' }],
    ediel_market_calendar_entries: input.calendar ?? [],
    manual_email_outbox: [],
    ediel_mailboxes: [],
  })
}

const request = (db: FakeDb) => db.tables.grid_owner_information_requests[0]

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('GRIDEX_MANUAL_OPS_ENVIRONMENT', '')
  vi.stubEnv('MANUAL_GRID_OWNER_SAFE_RECIPIENT', '')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('#7 business-day due dates (Europe/Stockholm, market calendar)', () => {
  it('counts 5 and 10 Swedish business days from the Stockholm send date, skipping weekends and holidays', async () => {
    port.db = seed()
    // Thu 2026-10-01 → Fri 2, Mon 5, Tue 6, Wed 7, Thu 8 → 08:00 Stockholm (CEST) = 06:00Z
    expect((await followUpDueAt(new Date('2026-10-01T10:00:00Z'), 5)).toISOString()).toBe('2026-10-08T06:00:00.000Z')
    expect((await followUpDueAt(new Date('2026-10-01T10:00:00Z'), 10)).toISOString()).toBe('2026-10-15T06:00:00.000Z')
    // 23:30Z on Sep 30 is already Oct 1 in Stockholm.
    expect((await followUpDueAt(new Date('2026-09-30T23:30:00Z'), 5)).toISOString()).toBe('2026-10-08T06:00:00.000Z')
    port.db = seed({ calendar: [{ market: 'electricity', country: 'SE', calendar_date: '2026-10-05', is_business_day: false, label: 'Helgdag' }] })
    expect((await followUpDueAt(new Date('2026-10-01T10:00:00Z'), 5)).toISOString()).toBe('2026-10-09T06:00:00.000Z')
  })
})

describe('#7 reminder and escalation', () => {
  it('only schedules before the reminder is due', async () => {
    const db = seed()
    port.db = db
    const result = await runManualGridOwnerFollowUpWatchdog({ now: new Date('2026-10-07T12:00:00Z') })
    expect(result.scheduled).toBe(1)
    expect(db.tables.manual_email_outbox).toHaveLength(0)
    expect(request(db)).toMatchObject({ follow_up_count: 0, next_follow_up_at: '2026-10-08T06:00:00.000Z' })
  })

  it('queues one reminder, then one escalation, each with its own idempotency key', async () => {
    const db = seed()
    port.db = db
    const first = await runManualGridOwnerFollowUpWatchdog({ now: new Date('2026-10-09T10:00:00Z') })
    expect(first.reminders).toBe(1)
    expect(db.tables.manual_email_outbox).toHaveLength(1)
    expect(db.tables.manual_email_outbox[0]).toMatchObject({
      idempotency_key: `manual-facility-follow-up:${REQ}:reminder:1`, to_email: 'anlaggning@owner.example', status: 'queued', request_id: REQ,
    })
    expect(String(db.tables.manual_email_outbox[0].subject)).toContain('Påminnelse')
    expect(request(db)).toMatchObject({ follow_up_count: 1, next_follow_up_at: '2026-10-15T06:00:00.000Z' })

    const again = await runManualGridOwnerFollowUpWatchdog({ now: new Date('2026-10-09T11:00:00Z') })
    expect(again.reminders + again.escalations).toBe(0)
    expect(db.tables.manual_email_outbox).toHaveLength(1)

    const escalation = await runManualGridOwnerFollowUpWatchdog({ now: new Date('2026-10-15T07:00:00Z') })
    expect(escalation.escalations).toBe(1)
    expect(db.tables.manual_email_outbox[1]).toMatchObject({ idempotency_key: `manual-facility-follow-up:${REQ}:escalation:2` })
    expect(String(db.tables.manual_email_outbox[1].subject)).toContain('Eskalering')
    expect(request(db)).toMatchObject({ follow_up_count: 2, next_follow_up_at: null })

    const done = await runManualGridOwnerFollowUpWatchdog({ now: new Date('2026-11-30T07:00:00Z') })
    expect(done.scanned).toBe(0)
  })

  it('does not remind when the POA is no longer valid and flags the request', async () => {
    const db = seed({ poa: { revoked_at: '2026-10-05T00:00:00Z' } })
    port.db = db
    const result = await runManualGridOwnerFollowUpWatchdog({ now: new Date('2026-10-09T10:00:00Z') })
    expect(result.needsReview).toBe(1)
    expect(db.tables.manual_email_outbox).toHaveLength(0)
    expect(request(db)).toMatchObject({ status: 'needs_review', last_error_code: 'poa_not_valid' })
  })

  it('does not remind without a verified contact', async () => {
    const db = seed()
    db.tables.grid_owner_contact_channels = []
    port.db = db
    await runManualGridOwnerFollowUpWatchdog({ now: new Date('2026-10-09T10:00:00Z') })
    expect(db.tables.manual_email_outbox).toHaveLength(0)
    expect(request(db)).toMatchObject({ status: 'needs_review', last_error_code: 'grid_owner_contact_missing' })
  })

  it('is a no-op outside production', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const db = seed()
    port.db = db
    const result = await runManualGridOwnerFollowUpWatchdog({ now: new Date('2026-10-09T10:00:00Z') })
    expect(result.scanned).toBe(0)
    expect(db.writes).toHaveLength(0)
  })
})
