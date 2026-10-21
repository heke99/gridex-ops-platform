import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/poaMailFakeDb'

type Row = Record<string, unknown>
const scope = { companyId: 'tenant-a', customerId: 'customer-a', siteId: 'site-a', requestId: 'request-a', inboundId: 'mail-a' }
const receivedAt = '2026-10-21T12:00:00Z', sourceHash = 'a'.repeat(64)
const io = vi.hoisted(() => ({ db: null as unknown as FakeDb, rpc: vi.fn(), reconcile: vi.fn(), complete: true }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => io.db.client.from(table), rpc: io.rpc } }))
vi.mock('@/lib/customer-operations/supplierSwitchOrchestration', () => ({ reconcileSupplierSwitchAfterCustomerDataChange: io.reconcile }))
vi.mock('@/lib/customer-operations/manualGridOwnerFollowUps', () => ({ followUpDueAt: async () => new Date('2026-10-28T07:00:00Z') }))

import { extractManualFacilityFields } from '@/lib/customer-operations/manualFacilityResponseParser'
import { interpretManualMail } from '@/lib/inbound-mail/manualMailInterpretation'
import { applyManualCommercialReply } from '@/lib/inbound-mail/manualReplyApplication'
import { applyManualMultiSiteReply } from '@/lib/inbound-mail/manualMultiSiteReply'
import type { ManualMailAiResult } from '@/lib/inbound-mail/manualMailAiReader'

const object = (value: unknown) => value as Row
beforeEach(() => {
  vi.clearAllMocks(); io.complete = true
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No provider calls in this flow test') }))
  io.db = createFakeDb({
    grid_owner_information_requests: [{ id: scope.requestId, company_id: scope.companyId, customer_id: scope.customerId,
      customer_site_id: scope.siteId, request_type: 'current_supplier_contract_information_request', status: 'waiting_manual_response',
      metadata: {}, created_by: 'original-request-author' }],
    manual_inbound_messages: [{ id: scope.inboundId, company_id: scope.companyId, customer_id: scope.customerId,
      customer_site_id: scope.siteId, request_id: scope.requestId, resolution_status: 'matched', processing_state: 'matched',
      received_at: receivedAt, extracted_payload: { sender_credible: true, sender_verification: { status: 'verified' },
        manual_automation: { version: 1, sourceHash } } }],
  })
  io.reconcile.mockResolvedValue({ ok: true, supplierSwitchRequestId: 'same-switch' })
  // Finite SQL port only: actual SQL ownership/atomicity is independently
  // exercised by manual-mail-atomic-application.test.ts, not simulated here.
  io.rpc.mockImplementation(async (name: string, args: Row) => {
    expect(name).toBe('gridex_apply_manual_commercial_reply_v1')
    expect(args).toMatchObject({ p_company_id: scope.companyId, p_request_id: scope.requestId, p_inbound_id: scope.inboundId })
    const payload = object(args.p_payload)
    const application = { version: 1, ...scope, inbound_id: scope.inboundId, receivedAt, sourceHash,
      applied: true, complete: io.complete, terms: payload.terms }
    const request = io.db.tables.grid_owner_information_requests[0], source = io.db.tables.manual_inbound_messages[0]
    request.status = io.complete ? 'completed' : 'manual_response_received'; request.parsed_payload = application
    source.processing_state = 'applied'
    source.extracted_payload = { ...object(source.extracted_payload), manual_automation: { version: 1, sourceHash, application } }
    return { data: { ok: true, applied: true, complete: io.complete, customerId: scope.customerId, customerSiteId: scope.siteId }, error: null }
  })
})
afterEach(() => vi.unstubAllGlobals())

async function run(text: string, reading?: ManualMailAiResult) {
  const interpreted = interpretManualMail({ authoredText: text, extracted: extractManualFacilityFields(text), reading })
  expect(interpreted.reasons).toEqual([])
  return applyManualCommercialReply({ ...scope, request: io.db.tables.grid_owner_information_requests[0],
    authoredText: text, extracted: interpreted.extracted, receivedAt, sourceHash })
}

it('carries an explicit full-year date through extraction, atomic payload and scoped continuation', async () => {
  const result = await run('Kunden kan starta 2026-11-20\nBrytavgift: 0 kr')
  expect(result.outcome).toBe('applied')
  expect(io.rpc.mock.calls[0][1].p_payload).toMatchObject({ sourceHash,
    terms: { earliestStartDate: '2026-11-20', effectiveStartDate: '2026-11-20', terminationFee: '0 kr' },
    evidence: { earliestStartDate: 'Kunden kan starta 2026-11-20' } })
  expect(io.db.tables.manual_inbound_messages[0]).toMatchObject({ company_id: scope.companyId, customer_id: scope.customerId, customer_site_id: scope.siteId })
  expect(io.reconcile).toHaveBeenCalledExactlyOnceWith({ companyId: scope.companyId, customerId: scope.customerId, siteId: scope.siteId,
    actorUserId: 'original-request-author', source: 'manual_supplier_information_received' })
  expect(fetch).not.toHaveBeenCalled()
})

it('uses an existing quoted AI reading of an explicit date without a new model call', async () => {
  const quote = 'Kunden kan starta 2026-11-20'
  const reading: ManualMailAiResult = { status: 'completed', mode: 'read_only', review_required: true, model: 'gpt-6-luna',
    outcome: 'contract_information', outcome_quote: quote, review_reasons: [], fields: [{ field: 'earliest_start', value: '2026-11-20', quote }] }
  expect((await run(quote, reading)).outcome).toBe('applied')
  expect(io.rpc.mock.calls[0][1].p_payload.terms.effectiveStartDate).toBe('2026-11-20')
  expect(fetch).not.toHaveBeenCalled()
})

it('holds relative dates until the production adapter supplies trustworthy persisted receipt provenance', async () => {
  const result = await run('Kunden kan starta om 30 dagar')
  expect(result.outcome).toBe('needs_review')
  expect(io.rpc).not.toHaveBeenCalled(); expect(io.reconcile).not.toHaveBeenCalled()
  expect(io.db.tables.grid_owner_information_requests[0]).toMatchObject({ last_error_code: 'earliest_start_date_missing_receipt_basis' })
})

it('also holds each relative site date in the current multi-site adapter', async () => {
  io.rpc.mockImplementationOnce(async (name: string, args: Row) => {
    expect(name).toBe('gridex_apply_manual_multi_site_reply_v1')
    expect(args).toMatchObject({ p_company_id: scope.companyId, p_parent_request_id: scope.requestId, p_inbound_id: scope.inboundId })
    const items = object(args.p_payload).items as Row[]
    expect(items).toHaveLength(1)
    expect(items[0].reasons).toContain('earliest_start_date_missing_receipt_basis')
    expect(object(object(items[0].payload).terms).effectiveStartDate).toBeUndefined()
    // The actual SQL port receives a review item, never an approved date.
    return { data: { ok: true, appliedCount: 0, reviewCount: 1,
      results: [{ facilityId: '735999100000000001', outcome: 'needs_review', reason: 'earliest_start_date_missing_receipt_basis' }] }, error: null }
  })
  const result = await applyManualMultiSiteReply({ companyId: scope.companyId, customerId: scope.customerId,
    parentRequest: io.db.tables.grid_owner_information_requests[0], inboundId: scope.inboundId, sourceHash, receivedAt,
    groups: [{ facilityId: '735999100000000001', extracted: { earliest_supplier_start_date: 'om 30 dagar' }, authoredText: 'Kunden kan starta om 30 dagar' }] })
  expect(result).toMatchObject({ outcome: 'needs_review', appliedCount: 0, reviewCount: 1 })
  expect(io.reconcile).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
})

it('routes an interval to review before the atomic command or switch continuation', async () => {
  const result = await run('Tidigaste startdatum: inom 30 dagar')
  expect(result.outcome).toBe('needs_review')
  expect(io.rpc).not.toHaveBeenCalled(); expect(io.reconcile).not.toHaveBeenCalled()
  expect(io.db.tables.grid_owner_information_requests[0]).toMatchObject({ status: 'manual_response_received', last_error_code: 'earliest_start_date_invalid_or_ambiguous' })
})

it('does not derive a start from a notice duration or resume a partial reply', async () => {
  io.complete = false
  expect((await run('Uppsägningstid: 30 dagar')).outcome).toBe('applied')
  expect(io.rpc.mock.calls[0][1].p_payload.terms).toEqual({ noticePeriod: '30 dagar' })
  expect(io.reconcile).not.toHaveBeenCalled()
})

it('refuses a canonical result bound to another site', async () => {
  io.rpc.mockResolvedValue({ data: { ok: true, applied: true, complete: true, customerId: scope.customerId, customerSiteId: 'foreign-site' }, error: null })
  expect((await run('Kunden kan starta 2026-11-20')).outcome).toBe('needs_review')
  expect(io.reconcile).not.toHaveBeenCalled()
})

it.each(['Kunden kan börja 2026-12-20', 'Kunden får börja 2027-01-01'])
('stops the real extraction/application chain on a second start statement: %s', async other => {
  expect((await run(`Tidigaste startdatum: 2026-11-20\n${other}`)).outcome).toBe('needs_review')
  expect(io.rpc).not.toHaveBeenCalled(); expect(io.reconcile).not.toHaveBeenCalled()
})

it.each(['Uppsägningen kan börja om 30 dagar', 'Handläggningen kan börja om 30 dagar'])
('keeps a quoted AI candidate for another milestone away from the business command: %s', async quote => {
  const reading: ManualMailAiResult = { status: 'completed', mode: 'read_only', review_required: true, model: 'gpt-6-luna',
    outcome: 'contract_information', outcome_quote: quote, review_reasons: [], fields: [{ field: 'earliest_start', value: 'om 30 dagar', quote }] }
  expect((await run(quote, reading)).outcome).toBe('needs_review')
  expect(io.rpc).not.toHaveBeenCalled(); expect(io.reconcile).not.toHaveBeenCalled()
})
