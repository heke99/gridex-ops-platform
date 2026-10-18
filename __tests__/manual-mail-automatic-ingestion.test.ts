import { beforeEach, expect, it, vi } from 'vitest'
import { createFakeDb } from './helpers/poaMailFakeDb'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof createFakeDb>, correlationInput: null as Row | null,
  apply: vi.fn(), continuation: vi.fn(), facility: vi.fn(), pauseCorrelation: null as (() => Promise<void>) | null }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => io.db.client.from(table),
  rpc: async (name: string, args: Row) => name === 'gridex_manual_inbound_source_retired_v1' ? { data: false, error: null } : io.apply(name, args),
} }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: async () => undefined }))
vi.mock('@/lib/customer-operations/supplierSwitchOrchestration', () => ({ reconcileSupplierSwitchAfterCustomerDataChange: (...args: unknown[]) => io.continuation(...args) }))
vi.mock('@/lib/customer-operations/manualFacilityResponseParser', async (original) => ({
  ...await original<typeof import('@/lib/customer-operations/manualFacilityResponseParser')>(),
  applyManualFacilityResponse: (...args: unknown[]) => io.facility(...args),
}))
vi.mock('@/lib/inbound-mail/manualInboundCorrelation', () => ({ resolveManualInboundCorrelation: async (input: Row) => {
  io.correlationInput = input
  const request = { ...io.db.tables.grid_owner_information_requests[0] }
  const pause = io.pauseCorrelation
  io.pauseCorrelation = null
  if (pause) await pause()
  return { resolutionStatus: 'matched', companyId: request.company_id, requestId: request.id, customerId: request.customer_id,
    customerSiteId: request.customer_site_id, meteringPointId: null, gridOwnerId: null, tenantResolutionMethod: 'case_reference',
    entityResolutionMethod: 'request', senderCredible: true, intent: 'contract_information_response', businessProcess: 'supplier_contract', intentConfidence: 1, evidence: {}, request }
} }))

import { ingestManualInboundEmail, type ManualInboundEmail } from '@/lib/inbound-mail/manualInboundIngestion'
const request = { id: 'request-a', company_id: 'tenant-a', customer_id: 'customer-a', customer_site_id: 'site-a', created_by: 'actor-a',
  request_type: 'current_supplier_contract_information_request', status: 'waiting_manual_response', metadata: {}, case_reference: 'GX-FIR-ABCDEF12' }
const email = (bodyText: string, patch: Partial<ManualInboundEmail> = {}): ManualInboundEmail => ({
  mailbox: 'leverantorsbyte@gridex.se', fromEmail: 'support@example.org', subject: 'Re: GX-FIR-ABCDEF12', bodyText,
  providerMessageId: '<synthetic@example.org>', senderVerification: { version: 1, status: 'verified', method: 'dkim', raw_sha256: 'a'.repeat(64),
    from_email: 'support@example.org', signing_domain: 'example.org', signed_headers: ['from', 'subject'], verified_at: new Date().toISOString() }, ...patch,
})

beforeEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks()
  io.db = createFakeDb({ grid_owner_information_requests: [{ ...request }], manual_inbound_messages: [], inbound_operation_events: [] })
  io.apply.mockImplementation(async (_name: string, args: Row) => {
    const row = io.db.tables.manual_inbound_messages.find((entry) => entry.id === args.p_inbound_id)!
    const payload = row.extracted_payload as Row
    const application = { version: 1, applied: true, complete: true, terms: (args.p_payload as Row).terms,
      inboundId: row.id, inbound_id: row.id, sourceHash: (args.p_payload as Row).sourceHash,
      companyId: 'tenant-a', customerId: 'customer-a', siteId: 'site-a', requestId: 'request-a' }
    row.processing_state = 'applied'
    row.extracted_payload = { ...payload, manual_automation: { ...(payload.manual_automation as Row),
      application } }
    Object.assign(io.db.tables.grid_owner_information_requests[0], { status: 'completed', parsed_payload: application })
    return { data: { ok: true, applied: true, complete: true, customerId: 'customer-a', customerSiteId: 'site-a', effectiveStartDate: '2027-04-01' }, error: null }
  })
  io.continuation.mockResolvedValue({ ok: true, blockedBeforeDispatch: false, supplierSwitchRequestId: 'switch-a' })
  io.facility.mockResolvedValue({ outcome: 'applied', confidence: 0.9, extracted: {}, reasons: [] })
  io.pauseCorrelation = null
})

it('normalizes an authenticated clear supplier reply and calls the exact tenant/source transaction before continuation', async () => {
  const result = await ingestManualInboundEmail(email('Avtalsslut: 2027-03-31\nTidigaste start: 2027-04-01\nUppsägningstid: 1 månad\nBrytavgift: Ingen'))
  expect(result.processingState).toBe('applied')
  expect(io.apply).toHaveBeenCalledOnce()
  expect(io.apply).toHaveBeenCalledWith('gridex_apply_manual_commercial_reply_v1', expect.objectContaining({
    p_company_id: 'tenant-a', p_request_id: 'request-a', p_inbound_id: result.inboundId,
    p_payload: expect.objectContaining({ sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/), terms: {
      contractEndDate: '2027-03-31', earliestStartDate: '2027-04-01', effectiveStartDate: '2027-04-01', noticePeriod: '1 månad', terminationFee: 'Ingen',
    } }),
  }))
  expect(io.continuation).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'tenant-a', customerId: 'customer-a', siteId: 'site-a' }))
})

it('uses the tool-free reading for an irregular reply and still normalizes its original dates on the server', async () => {
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '1'); vi.stubEnv('OPENAI_API_KEY', 'synthetic')
  const text = 'Kunden kan börja hos er tidigast den 1 april 2027.\nBrytavgift: Ingen'
  let calls = 0
  vi.stubGlobal('fetch', async () => { calls++; return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify({ outcome: 'contract_information', outcome_source: 0, review_reasons: [],
      fields: [{ field: 'earliest_start', value: '1 april 2027', source: 0 }, { field: 'termination_fee', value: 'Ingen', source: 0 }] }) }] }] })) })
  const result = await ingestManualInboundEmail(email(text))
  expect(result.processingState).toBe('applied')
  expect(io.apply.mock.calls[0][1]).toMatchObject({ p_payload: { terms: { earliestStartDate: '2027-04-01' } } })
  expect(calls).toBe(1)
  await ingestManualInboundEmail(email(text))
  expect(calls).toBe(1)
})

it.each([
  'Tidigaste start: 2027-04-01\nDetta förutsätter att kunden säger upp avtalet.',
  'Kunden kan inte starta den 2027-04-01.',
  'Avtalsslut: 2027-02-30',
])('does not apply conditional, negated or impossible dates: %s', async (bodyText) => {
  expect((await ingestManualInboundEmail(email(bodyText))).processingState).toBe('needs_review')
  expect(io.apply).not.toHaveBeenCalled(); expect(io.continuation).not.toHaveBeenCalled()
})

it('does not apply missing DKIM evidence or an attestation for a different author', async () => {
  await ingestManualInboundEmail(email('Tidigaste start: 2027-04-01', { senderVerification: undefined }))
  expect(io.apply).not.toHaveBeenCalled()
  io.db.tables.manual_inbound_messages = []
  await ingestManualInboundEmail(email('Tidigaste start: 2027-04-01', { fromEmail: 'other@example.org' }))
  expect(io.apply).not.toHaveBeenCalled()
})

it('never lets an unsigned rejection pause the real request or trigger a paid reading', async () => {
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '1'); vi.stubEnv('OPENAI_API_KEY', 'synthetic')
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const result = await ingestManualInboundEmail(email('Vi nekar er fullmakt. BankID-signatur saknas.', { senderVerification: undefined }))
  expect(result.processingState).toBe('needs_review')
  expect(io.db.tables.grid_owner_information_requests[0]).toMatchObject({ status: 'waiting_manual_response', metadata: {} })
  expect(fetcher).not.toHaveBeenCalled()
})

it('ignores unsigned subject and thread correlation even when DKIM authenticates the body', async () => {
  const proof = email('').senderVerification!
  await ingestManualInboundEmail(email('Tidigaste start: 2027-04-01', { inReplyTo: '<wrong@example.org>', references: ['<wrong@example.org>'],
    senderVerification: { ...proof, signed_headers: ['from'] } }))
  expect(io.correlationInput).toMatchObject({ caseReference: null, email: { inReplyTo: null, references: [] } })
  expect(String(io.correlationInput?.normalizedText)).not.toContain('GX-FIR-ABCDEF12')
})

it('automatically stores valid partial facts but does not release a supplier switch', async () => {
  io.apply.mockResolvedValue({ data: { ok: true, applied: true, complete: false, customerId: 'customer-a', customerSiteId: 'site-a' }, error: null })
  expect((await ingestManualInboundEmail(email('Uppsägningstid: 30 dagar'))).processingState).toBe('applied')
  expect(io.apply).toHaveBeenCalledOnce(); expect(io.continuation).not.toHaveBeenCalled()
})

it('preserves a current rejection returned by the atomic command without running the next step', async () => {
  io.apply.mockResolvedValue({ data: { ok: false, code: 'manual_reply_current_hold' }, error: null })
  expect((await ingestManualInboundEmail(email('Tidigaste start: 2027-04-01'))).processingState).toBe('needs_review')
  expect(io.continuation).not.toHaveBeenCalled()
})

it('does not let a late concurrent normalization erase an applied source or its date proof', async () => {
  let release!: () => void
  let entered!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const ready = new Promise<void>((resolve) => { entered = resolve })
  io.pauseCorrelation = async () => { entered(); await held }
  const message = email('Tidigaste start: 2027-04-01\nBrytavgift: Ingen')
  const late = ingestManualInboundEmail(message)
  await ready
  expect((await ingestManualInboundEmail(message)).processingState).toBe('applied')
  const source = io.db.tables.manual_inbound_messages[0]
  const proof = JSON.stringify(source.extracted_payload)
  io.db.tables.grid_owner_information_requests[0].status = 'completed'
  release()
  expect((await late).processingState).toBe('applied')
  expect(source.processing_state).toBe('applied')
  expect(JSON.stringify(source.extracted_payload)).toBe(proof)
  expect(io.apply).toHaveBeenCalledOnce()
})

it('quarantines changed content that reuses a Message-ID and preserves the original applied evidence', async () => {
  await ingestManualInboundEmail(email('Tidigaste start: 2027-04-01\nBrytavgift: Ingen'))
  const original = io.db.tables.manual_inbound_messages[0]
  const proof = JSON.stringify(original)
  const collision = await ingestManualInboundEmail(email('Tidigaste start: 2027-01-01\nBrytavgift: Ingen'))
  expect(collision.processingState).toBe('needs_review')
  expect(collision.inboundId).not.toBe(original.id)
  expect(collision.companyId).toBeNull()
  expect(io.db.tables.manual_inbound_messages).toHaveLength(2)
  expect(JSON.stringify(original)).toBe(proof)
  expect(io.apply).toHaveBeenCalledOnce()
})

it('ignores an unsigned rejection subject on a cryptographically verified facility answer', async () => {
  io.db.tables.grid_owner_information_requests[0].request_type = 'facility_identifier_lookup'
  const proof = email('').senderVerification!
  const result = await ingestManualInboundEmail(email('Anläggnings-ID: 735999100000000001\nNätområde: LKR', {
    subject: 'Fullmakten är inte godkänd', senderVerification: { ...proof, signed_headers: ['from'] },
  }))
  expect(result.processingState).toBe('applied')
  expect(io.facility).toHaveBeenCalledOnce()
  expect(io.db.tables.grid_owner_information_requests[0].metadata).toEqual({})
})

it('does not apply a reply while another worker is still reading its global conditions', async () => {
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '1'); vi.stubEnv('OPENAI_API_KEY', 'synthetic')
  let release!: () => void
  let started!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const ready = new Promise<void>((resolve) => { started = resolve })
  const fetcher = vi.fn(async () => {
    started(); await held
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify({ outcome: 'contract_information', outcome_source: 0, review_reasons: ['uncertain'], fields: [] }) }] }] }))
  })
  vi.stubGlobal('fetch', fetcher)
  const message = email('Tidigaste start: 2027-04-01\nBrytavgift: Ingen')
  const first = ingestManualInboundEmail(message)
  await ready
  try {
    await expect(ingestManualInboundEmail(message)).rejects.toThrow('manual_mail_reading_in_progress')
    expect(io.apply).not.toHaveBeenCalled()
  } finally { release() }
  expect((await first).processingState).toBe('needs_review')
  expect(fetcher).toHaveBeenCalledOnce()
})

it.each([
  'Tidigaste start: 2027-04-01\nBrytavgift: Ingen\n> Vilket startdatum gäller?\nDatumet gäller endast om kunden först säger upp avtalet.',
])('preserves later authored conditions after inline quoted questions', async (bodyText) => {
  expect((await ingestManualInboundEmail(email(bodyText))).processingState).toBe('needs_review')
  expect(io.apply).not.toHaveBeenCalled()
})

it('preserves authored HTML conditions after a closed quoted block', async () => {
  const result = await ingestManualInboundEmail(email('', { bodyText: undefined,
    bodyHtml: '<p>Tidigaste start: 2027-04-01</p><p>Brytavgift: Ingen</p><blockquote><p>Vilket datum gäller?</p></blockquote><p>Datumet gäller endast om kunden först säger upp avtalet.</p>' }))
  expect(result.processingState).toBe('needs_review')
  expect(io.apply).not.toHaveBeenCalled()
})

it.each([
  { bodyHtml: '<p>Tidigaste start: 2027-04-01</p><p>Brytavgift: Ingen</p><blockquote>Oklar citering', bodyText: undefined },
  { bodyText: 'Tidigaste start: 2027-04-01\nBrytavgift: Ingen', mimeRequiresReview: true },
])('never infers or applies a structurally incomplete source, including on replay: %j', async (patch) => {
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '1'); vi.stubEnv('OPENAI_API_KEY', 'synthetic')
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const message = email('', patch)
  expect((await ingestManualInboundEmail(message)).processingState).toBe('needs_review')
  expect((await ingestManualInboundEmail(message)).processingState).toBe('needs_review')
  expect(io.apply).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
  expect(io.db.tables.manual_inbound_messages[0].extracted_payload).toMatchObject({ manual_reply_structure_requires_review: true })
})

it('does not spend an inference or apply a reply naming another customer identity in the correct thread', async () => {
  io.db.tables.customers = [{ id: 'customer-a', company_id: 'tenant-a', personal_number: '200001010001', org_number: null }]
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '1'); vi.stubEnv('OPENAI_API_KEY', 'synthetic')
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const result = await ingestManualInboundEmail(email('Personnummer: 200002020002\nTidigaste start: 2027-04-01\nBrytavgift: Ingen'))
  expect(result.processingState).toBe('needs_review')
  expect(fetcher).not.toHaveBeenCalled(); expect(io.apply).not.toHaveBeenCalled()
})

it('accepts a matching explicitly labelled customer identity with ordinary formatting', async () => {
  io.db.tables.customers = [{ id: 'customer-a', company_id: 'tenant-a', personal_number: '200001010001', org_number: null }]
  const result = await ingestManualInboundEmail(email('Person-/organisationsnummer: 20000101-0001\nTidigaste start: 2027-04-01\nBrytavgift: Ingen'))
  expect(result.processingState).toBe('applied')
  expect(io.apply).toHaveBeenCalledWith('gridex_apply_manual_commercial_reply_v1', expect.objectContaining({
    p_payload: expect.objectContaining({ extracted: expect.objectContaining({ customer_identity_number: '200001010001' }) }),
  }))
})
