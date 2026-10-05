import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Only external database/notification/cache ports are replaced. The webhook,
// correlation, ingestion, parser, completion RPC adapter and orchestrator run.
type Row = Record<string, unknown>
type Result = { data: Row[] | Row | null; error: { code: string; message: string } | null }
const io = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), completionOk: true, completionCount: 0,
  tables: {} as Record<string, Row[]>, deniedRequestUpdate: false,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: async () => null }))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: async () => undefined }))
vi.mock('@/lib/customer-operations/customerIntakeOrchestrator', () => ({
  evaluateCustomerIntake: async () => { throw new Error('unexpected downstream intake evaluation') },
}))
vi.mock('@/lib/customer-operations/customerProcessNextStepEngine', () => ({
  evaluateAndRunNextCustomerStep: async () => { throw new Error('unexpected downstream supplier-switch evaluation') },
}))

import { resolveManualInboundCorrelation } from '@/lib/inbound-mail/manualInboundCorrelation'
import { ingestManualInboundEmail } from '@/lib/inbound-mail/manualInboundIngestion'
import { applyManualFacilityResponse } from '@/lib/customer-operations/manualFacilityResponseParser'
import { POST } from '@/app/api/webhooks/manual-inbound/route'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222'
const CUSTOMER = '33333333-3333-4333-8333-333333333333'
const SITE = '44444444-4444-4444-8444-444444444444'
const OWNER = '55555555-5555-4555-8555-555555555555'
const REQUEST = '66666666-6666-4666-8666-666666666666'
const CASE = 'GX-FIR-AABBCCDD'
const FACILITY = '735999000000000001'
const FROM = 'grid_owner@example.test'
const REPLY = '<outgoing-request@example.test>'

// A finite Data API double applies emitted filters and writes to rows. It does
// not simulate RLS or native SQL; these tests prove the TypeScript boundaries.
function ilike(value: unknown, pattern: string): boolean {
  let regex = '^'
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '\\' && i + 1 < pattern.length) regex += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (char === '%') regex += '.*'
    else if (char === '_') regex += '.'
    else regex += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${regex}$`, 'i').test(String(value ?? ''))
}

class Query implements PromiseLike<Result> {
  private filters: Array<(row: Row) => boolean> = []
  private values: Row | null = null
  private operation: 'read' | 'insert' | 'update' | 'upsert' = 'read'
  private maximum = Infinity
  private one = false
  constructor(private table: string) {}
  select() { return this }
  eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this }
  in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this }
  ilike(key: string, pattern: string) { this.filters.push(row => ilike(row[key], pattern)); return this }
  or(expression: string) {
    const alternatives = expression.split(',').map(value => value.split('.eq.'))
    this.filters.push(row => alternatives.some(([key, value]) => row[key] === value))
    return this
  }
  order() { return this }
  limit(maximum: number) { this.maximum = maximum; return this }
  maybeSingle() { this.one = true; return this }
  insert(values: Row) { this.operation = 'insert'; this.values = values; return this }
  update(values: Row) { this.operation = 'update'; this.values = values; return this }
  upsert(values: Row) { this.operation = 'upsert'; this.values = values; return this }
  private execute(): Result {
    const table = io.tables[this.table]
    if (!table) throw new Error(`undeclared Data API table: ${this.table}`)
    if (this.operation === 'update' && this.table === 'grid_owner_information_requests' && io.deniedRequestUpdate) {
      return { data: null, error: { code: '42501', message: 'request update denied' } }
    }
    let rows = table.filter(row => this.filters.every(filter => filter(row))).slice(0, this.maximum)
    if (this.operation === 'insert') {
      const row = { id: `insert-${table.length + 1}`, ...this.values }
      table.push(row); rows = [row]
    } else if (this.operation === 'update') rows.forEach(row => Object.assign(row, this.values))
    else if (this.operation === 'upsert') {
      const existing = table.find(row => row.idempotency_key === this.values?.idempotency_key)
      if (existing) Object.assign(existing, this.values)
      else table.push({ ...this.values })
    }
    return { data: this.one ? rows[0] ?? null : rows, error: null }
  }
  then<TResult1 = Result, TResult2 = never>(
    fulfilled?: ((result: Result) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve().then(() => this.execute()).then(fulfilled, rejected)
  }
}

function requestRow(overrides: Row = {}): Row {
  return { id: REQUEST, company_id: COMPANY, customer_id: CUSTOMER, customer_site_id: SITE,
    grid_owner_id: OWNER, request_type: 'facility_identifier_lookup', case_reference: CASE,
    recipient_email: FROM, status: 'waiting_manual_response', ...overrides }
}
function verifiedContact(company: string | null = COMPANY) {
  io.tables.grid_owner_contact_channels.push({ company_id: company, grid_owner_id: OWNER,
    email: FROM, channel_type: 'email', is_enabled: true, is_verified: true })
}
function outgoingReply(requestId = REQUEST, companyId = COMPANY) {
  io.tables.manual_email_outbox.push({ id: `outbox-${requestId}`, company_id: companyId,
    request_id: requestId, provider_message_id: REPLY })
}
function email(overrides: Row = {}) {
  return { mailbox: 'inbound@example.test', fromEmail: FROM, providerMessageId: 'incoming-1',
    subject: CASE, bodyText: `Anläggnings-ID: ${FACILITY}\nNätområde: ABC\nElområde: SE3`, ...overrides }
}
const parserInput = () => ({ companyId: COMPANY, request: io.tables.grid_owner_information_requests[0],
  senderCredible: true, extracted: { facility_id: FACILITY, grid_area_code: 'ABC', price_area_code: 'SE3' } })

beforeEach(() => {
  io.from.mockReset(); io.rpc.mockReset(); io.completionOk = true; io.completionCount = 0; io.deniedRequestUpdate = false
  io.tables = {
    grid_owner_information_requests: [requestRow()],
    customer_sites: [{ id: SITE, company_id: COMPANY, customer_id: CUSTOMER, grid_owner_id: OWNER,
      facility_id: null, grid_area_code: 'ABC', price_area_code: 'SE3', protected_identity: false }],
    platform_grid_areas: [{ id: 'area', grid_area_code: 'ABC', grid_owner_id: OWNER, price_area: 'SE3', is_active: true }],
    platform_runtime_readiness: [{ id: true, is_ready: true, blocking_issues: [], schema_fingerprint: 'a'.repeat(64),
      schema_version: '20260803093300-gridex-runtime-readiness-v3', capabilities: {} }],
    grid_owner_contact_channels: [], manual_email_outbox: [], communication_log_events: [],
    metering_points: [], customers: [], manual_inbound_messages: [], inbound_operation_events: [],
    customer_operation_events: [], manual_communication_mailboxes: [],
  }
  io.from.mockImplementation(table => new Query(table))
  io.rpc.mockImplementation(async (name, args: Row) => {
    if (name !== 'gridex_complete_facility_response') throw new Error(`undeclared RPC: ${name}`)
    io.completionCount++
    const request = io.tables.grid_owner_information_requests.find(row => row.id === args.p_request_id && row.company_id === args.p_company_id)
    if (!request) return { data: null, error: { code: '42501', message: 'wrong company' } }
    if (io.completionOk) {
      request.status = 'completed'
      const site = io.tables.customer_sites.find(row => row.id === request.customer_site_id && row.company_id === args.p_company_id)!
      site.facility_id = args.p_facility_id
    }
    return { error: null, data: { ok: io.completionOk, code: io.completionOk ? null : 'facility_data_conflict',
      requestId: REQUEST, customerId: CUSTOMER, customerSiteId: SITE, meteringPointRecordId: null,
      facilityId: FACILITY, gridAreaCode: 'ABC', priceAreaCode: 'SE3', operationId: null } }
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('manual inbound sender and tenant boundaries', () => {
  it('does not treat a copied case number and bare From recipient equality as sender credibility', async () => {
    const result = await resolveManualInboundCorrelation({ email: email(), caseReference: CASE, normalizedText: '', extracted: {} })
    expect(result).toMatchObject({ resolutionStatus: 'ignored', senderCredible: false })
  })
  it('accepts the recipient when case and reply headers bind to the same outbound request', async () => {
    outgoingReply()
    const result = await resolveManualInboundCorrelation({ email: email({ inReplyTo: REPLY }), caseReference: CASE, normalizedText: '', extracted: {} })
    expect(result).toMatchObject({ resolutionStatus: 'matched', senderCredible: true, requestId: REQUEST, companyId: COMPANY })
    expect(result.evidence).toMatchObject({ request_bound_by_reply: true })
  })
  it('keeps known reply references from another company from borrowing a valid case and verified contact', async () => {
    verifiedContact()
    io.tables.grid_owner_information_requests.push(requestRow({ id: 'foreign-request', company_id: OTHER_COMPANY, case_reference: 'GX-FIR-11223344' }))
    outgoingReply('foreign-request', OTHER_COMPANY)
    const result = await resolveManualInboundCorrelation({ email: email({ inReplyTo: REPLY }), caseReference: CASE, normalizedText: '', extracted: {} })
    expect(result.resolutionStatus).toBe('ambiguous')
    expect(result.senderCredible).toBe(false)
  })
  it('preserves same-company and global verified contact paths without reply headers', async () => {
    verifiedContact(null)
    const result = await resolveManualInboundCorrelation({ email: email(), caseReference: CASE, normalizedText: '', extracted: {} })
    expect(result).toMatchObject({ resolutionStatus: 'matched', senderCredible: true, companyId: COMPANY })
  })
  it('queries verified contact email addresses literally rather than allowing underscore wildcards', async () => {
    io.tables.grid_owner_contact_channels.push({ company_id: OTHER_COMPANY, grid_owner_id: 'other-owner',
      email: 'gridXowner@example.test', channel_type: 'email', is_enabled: true, is_verified: true })
    const result = await resolveManualInboundCorrelation({ email: email(), caseReference: CASE, normalizedText: '', extracted: {} })
    expect(result.evidence.verified_sender_tenant_ids).toEqual([])
  })
  it('retains tenant hints in evidence while refusing to bind ignored messages to tenant-readable entities', async () => {
    const result = await ingestManualInboundEmail(email({ fromEmail: 'unverified@example.test' }))
    expect(result).toMatchObject({ resolutionStatus: 'ignored', companyId: null, customerId: null, customerSiteId: null, requestId: null })
    expect(io.tables.manual_inbound_messages[0]).toMatchObject({ company_id: null, request_id: null,
      customer_id: null, customer_site_id: null, grid_owner_id: null, resolution_status: 'ignored' })
    expect(io.tables.manual_inbound_messages[0].correlation_evidence).toMatchObject({ request_id: REQUEST, customer_id: CUSTOMER, customer_site_id: SITE })
    expect(io.tables.inbound_operation_events[0]).toMatchObject({ company_id: null, business_object_id: null,
      customer_id: null, customer_site_id: null, grid_owner_id: null, business_event_fingerprint: null })
    expect(io.completionCount).toBe(0)
  })
})

describe('manual facility response canonical completion', () => {
  it('keeps a rejected canonical completion in review without reporting an applied facility or success event', async () => {
    io.completionOk = false
    const result = await applyManualFacilityResponse(parserInput())
    expect(result).toMatchObject({ outcome: 'needs_review', reasons: ['facility_data_conflict'] })
    expect(io.tables.grid_owner_information_requests[0]).toMatchObject({ status: 'needs_review', parsed_payload: { applied: false } })
    expect(io.tables.customer_sites[0].facility_id).toBeNull()
    expect(io.tables.customer_operation_events.map(row => row.event_code)).not.toContain('manual_facility_request.applied')
  })
  it('preserves the canonical completed request and matched ownership on a successful real ingestion', async () => {
    verifiedContact()
    const result = await ingestManualInboundEmail(email())
    expect(result).toMatchObject({ resolutionStatus: 'matched', processingState: 'applied', companyId: COMPANY,
      customerId: CUSTOMER, customerSiteId: SITE, requestId: REQUEST, parse: { outcome: 'applied' } })
    expect(io.tables.grid_owner_information_requests[0].status).toBe('completed')
    expect(io.tables.customer_sites[0].facility_id).toBe(FACILITY)
    expect(io.tables.manual_inbound_messages[0]).toMatchObject({ company_id: COMPANY, customer_id: CUSTOMER,
      customer_site_id: SITE, request_id: REQUEST, processing_state: 'applied' })
    expect(io.tables.inbound_operation_events[0]).toMatchObject({ company_id: COMPANY, business_object_id: REQUEST, processing_state: 'applied' })
    expect(io.tables.customer_operation_events.map(row => row.event_code)).toContain('manual_facility_request.applied')
  })
  it('retains one canonical completion and the same request state on provider-message replay', async () => {
    verifiedContact()
    await ingestManualInboundEmail(email())
    const replay = await ingestManualInboundEmail(email())
    expect(replay).toMatchObject({ resolutionStatus: 'matched', processingState: 'applied', requestId: REQUEST })
    expect(io.completionCount).toBe(1)
    expect(io.tables.grid_owner_information_requests[0].status).toBe('completed')
    expect(io.tables.manual_inbound_messages).toHaveLength(1)
  })
  it('retains the protected-identity guard before the canonical completion command', async () => {
    io.tables.customer_sites[0].protected_identity = true
    const result = await applyManualFacilityResponse(parserInput())
    expect(result).toMatchObject({ outcome: 'needs_review', reasons: ['protected_identity'] })
    expect(io.completionCount).toBe(0)
    expect(io.tables.customer_sites[0].facility_id).toBeNull()
  })
  it('does not mutate another company when the request evidence update is denied', async () => {
    io.deniedRequestUpdate = true
    await expect(applyManualFacilityResponse(parserInput())).rejects.toMatchObject({ code: '42501' })
    expect(io.completionCount).toBe(0)
    expect(io.tables.grid_owner_information_requests[0].status).toBe('waiting_manual_response')
  })
})

describe('manual webhook mailbox matching', () => {
  it('keeps an underscore mailbox literal from borrowing a different verified tenant mailbox', async () => {
    vi.stubEnv('MANUAL_INBOUND_WEBHOOK_SECRET', 'synthetic-pr204-webhook-secret')
    io.tables.manual_communication_mailboxes.push({ id: 'foreign-mailbox', company_id: OTHER_COMPANY,
      from_email: 'inXbound@example.test', reply_to_email: 'other@example.test', is_active: true, is_verified: true })
    const body = JSON.stringify({ message_id: 'webhook-1', mailbox: 'in_bound@example.test', from: 'unverified@example.test', text: 'General question' })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac('sha256', 'synthetic-pr204-webhook-secret').update(`${timestamp}.${body}`).digest('hex')
    const response = await POST(new NextRequest('https://unit.example.test/api/webhooks/manual-inbound', { method: 'POST', body,
      headers: { 'x-manual-inbound-timestamp': timestamp, 'x-gridex-signature': signature } }))
    expect(response.status).toBe(200)
    expect(io.tables.manual_inbound_messages[0].mailbox_company_id).toBeNull()
    expect(io.tables.manual_inbound_messages[0].company_id).toBeNull()
  })
})
