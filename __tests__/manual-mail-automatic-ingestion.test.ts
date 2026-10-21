import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { createFakeDb } from './helpers/poaMailFakeDb'
import { getManualMailReviewQueue } from '@/lib/inbound-mail/manualMailReviewQueue'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof createFakeDb>, correlationInput: null as Row | null,
  apply: vi.fn(), continuation: vi.fn(), facility: vi.fn(), pauseCorrelation: null as (() => Promise<void>) | null,
  documentRouting: vi.fn(), documentEligible: vi.fn(), multiSite: vi.fn(), continueMultiSite: vi.fn() }))
vi.mock('@/lib/inbound-mail/manualMultiSiteReply', () => ({
  applyManualMultiSiteReply: (...args: unknown[]) => io.multiSite(...args),
  continueManualMultiSiteReply: (...args: unknown[]) => io.continueMultiSite(...args),
}))
vi.mock('@/lib/inbound-mail/manualInboundRouting', () => ({
  resolveManualDocumentRouting: (...args: unknown[]) => io.documentRouting(...args),
  isVerifiedManualDocumentSender: (...args: unknown[]) => io.documentEligible(...args),
}))
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
vi.mock('@/lib/inbound-mail/manualInboundCorrelation', async (original) => ({
  ...await original<typeof import('@/lib/inbound-mail/manualInboundCorrelation')>(),
  resolveManualInboundCorrelation: async (input: Row) => {
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
import { assessManualReply } from '@/lib/inbound-mail/manualReplyAssessment'
const request = { id: 'request-a', company_id: 'tenant-a', customer_id: 'customer-a', customer_site_id: 'site-a', created_by: 'actor-a',
  request_type: 'current_supplier_contract_information_request', status: 'waiting_manual_response', metadata: {}, case_reference: 'GX-FIR-ABCDEF12' }
const email = (bodyText: string, patch: Partial<ManualInboundEmail> = {}): ManualInboundEmail => ({
  mailbox: 'leverantorsbyte@gridex.se', fromEmail: 'support@example.org', subject: 'Re: GX-FIR-ABCDEF12', bodyText,
  providerMessageId: '<synthetic@example.org>', senderVerification: { version: 1, status: 'verified', method: 'dkim', raw_sha256: 'a'.repeat(64),
    from_email: 'support@example.org', signing_domain: 'example.org', signed_headers: ['from', 'subject'], verified_at: new Date().toISOString() }, ...patch,
})

// A JSON webhook cannot construct a symbol-keyed server observation. The
// actual poller constructs this only from the installed client's INTERNALDATE.
function receivedEmail(body: string, receivedAt = '2026-10-24T22:30:00.000Z', patch: Row = {}) {
  return Object.assign(email(body), { [Symbol.for('gridex.manual-mail.imap-receipt.v1')]: {
    version: 1, source: 'imap_internal_date', receivedAt,
    mailbox: 'leverantorsbyte@gridex.se', mailboxId: 'mailbox-a', mailboxFingerprint: 'b'.repeat(64),
    uidValidity: '1234', uid: 25, rawSha256: 'a'.repeat(64), ...patch,
  } })
}

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
  io.documentEligible.mockResolvedValue(true)
  io.multiSite.mockResolvedValue({ outcome: 'applied', results: [], appliedCount: 2, reviewCount: 0 })
  io.continueMultiSite.mockResolvedValue(undefined)
  io.documentRouting.mockImplementation(async (input: Row) => ({ resolutionStatus: 'matched', companyId: 'tenant-a', customerId: 'customer-a',
    requestId: 'request-a', request: { ...io.db.tables.grid_owner_information_requests[0] }, senderCredible: true,
    sites: [{ customerSiteId: 'site-a', facilityId: null, units: input.units }], reasons: [], evidence: { routing_version: 1 } }))
})
afterEach(() => vi.useRealTimers())

it('anchors a delayed first read to the original Stockholm receipt day before applying customer terms', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-28T12:00:00Z'))
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '0')
  vi.stubGlobal('fetch', () => { throw new Error('Receipt normalization must not call a provider') })
  const result = await ingestManualInboundEmail(receivedEmail('Kunden kan starta om 30 dagar\nBrytavgift: Ingen'))
  expect(result).toMatchObject({ processingState: 'applied', companyId: 'tenant-a', customerId: 'customer-a', customerSiteId: 'site-a' })
  expect(io.db.tables.manual_inbound_messages[0]).toMatchObject({ received_at: '2026-10-24T22:30:00.000Z',
    extracted_payload: { mailbox_receipt: { source: 'imap_internal_date', receivedAt: '2026-10-24T22:30:00.000Z' } } })
  expect(io.apply.mock.calls[0][1]).toMatchObject({ p_payload: { terms: { earliestStartDate: '2026-11-24', effectiveStartDate: '2026-11-24' } } })
  expect(io.continuation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ companyId: 'tenant-a', customerId: 'customer-a', siteId: 'site-a' }))
})

it('preserves the first receipt and exact date after an application failure and a changed later IMAP observation', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-28T12:00:00Z'))
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '0')
  const body = 'Kunden kan starta om 30 dagar\nBrytavgift: Ingen'
  io.apply.mockRejectedValueOnce(new Error('synthetic transaction unavailable'))
  try {
    await expect(ingestManualInboundEmail(receivedEmail(body))).rejects.toThrow('synthetic transaction unavailable')
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'))
    expect(await ingestManualInboundEmail(receivedEmail(body, '2026-10-28T23:30:00.000Z', { uid: 99 }))).toMatchObject({ processingState: 'applied' })
    expect(io.db.tables.manual_inbound_messages[0].received_at).toBe('2026-10-24T22:30:00.000Z')
    expect(io.apply.mock.calls.map(([, args]) => args.p_payload.terms.effectiveStartDate)).toEqual(['2026-11-24', '2026-11-24'])
  } finally { io.apply.mockReset() }
})

it('passes the same persisted receipt to the multi-site adapter without altering parent tenant or customer', async () => {
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '0')
  const first = 'Anläggnings-ID: 735999100000000001\nKunden kan starta om 30 dagar\nBrytavgift: Ingen'
  const second = 'Anläggnings-ID: 735999100000000002\nKunden kan starta om 31 dagar\nBrytavgift: Ingen'
  io.documentRouting.mockResolvedValue({ resolutionStatus: 'matched', companyId: 'tenant-a', customerId: 'customer-a',
    requestId: null, request: null, senderCredible: true, reasons: [],
    evidence: { site_requests: [{ customerSiteId: 'site-a', requestId: 'request-a' }, { customerSiteId: 'site-b', requestId: 'request-b' }] },
    sites: [{ customerSiteId: 'site-a', facilityId: '735999100000000001', bodyText: first, units: [] },
      { customerSiteId: 'site-b', facilityId: '735999100000000002', bodyText: second, units: [] }] })
  await ingestManualInboundEmail(receivedEmail(`${first}\n\n${second}`))
  expect(io.multiSite).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ companyId: 'tenant-a', customerId: 'customer-a',
    receivedAt: '2026-10-24T22:30:00.000Z', receivedAtSource: 'imap_internal_date', parentRequest: expect.objectContaining({ id: 'request-a' }),
    groups: [expect.objectContaining({ facilityId: '735999100000000001' }), expect.objectContaining({ facilityId: '735999100000000002' })] }))
  expect(io.db.tables.manual_inbound_messages[0]).toMatchObject({ company_id: 'tenant-a', customer_id: 'customer-a', request_id: 'request-a', customer_site_id: 'site-a' })
  expect(io.apply).not.toHaveBeenCalled()
})

it.each([
  { source: 'date_header' }, { rawSha256: 'c'.repeat(64) }, { mailbox: 'foreign@example.org' },
  { receivedAt: 'invalid' }, { uid: 0 }, { uidValidity: '' },
])('does not qualify an invalid server receipt: %j', async patch => {
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '0')
  expect(await ingestManualInboundEmail(receivedEmail('Kunden kan starta om 30 dagar', undefined, patch))).toMatchObject({ processingState: 'needs_review' })
  expect(io.apply).not.toHaveBeenCalled(); expect(io.continuation).not.toHaveBeenCalled()
})

it('cannot upgrade an earlier unqualified arrival using a later poll or webhook date fields', async () => {
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '0')
  const body = 'Kunden kan starta om 30 dagar'
  await ingestManualInboundEmail(Object.assign(email(body), { receivedAt: '2026-10-24T22:30:00.000Z', receivedAtSource: 'imap_internal_date' }))
  const original = io.db.tables.manual_inbound_messages[0]
  const firstReceived = original.received_at
  original.processing_state = 'matched' // A legitimate retry of this same persisted source.
  expect(await ingestManualInboundEmail(receivedEmail(body))).toMatchObject({ processingState: 'needs_review' })
  expect(original.received_at).toBe(firstReceived)
  expect(original.extracted_payload).not.toHaveProperty('mailbox_receipt')
  expect(io.apply).not.toHaveBeenCalled()
})

it('uses a complete original attachment as evidence and binds its hash before applying the exact customer terms', async () => {
  const text = 'Avtalsslut: 2027-03-31\nTidigaste start: 2027-04-01\nUppsägningstid: 1 månad\nBrytavgift: Ingen'
  const bytes = Buffer.from(text), sha256 = createHash('sha256').update(bytes).digest('hex')
  const message = email('Se bilagan.', { attachments: [{ filename: 'avtal.txt', contentType: 'text/plain', sizeBytes: bytes.length,
    mimePart: 1, sha256, sourceRole: 'attachment', contentBase64: bytes.toString('base64'), text }] })
  const result = await ingestManualInboundEmail(message)
  expect(result.processingState).toBe('applied')
  expect(io.documentRouting).toHaveBeenCalledWith(expect.objectContaining({ authoredText: 'Se bilagan.', units: [expect.objectContaining({ sha256, text })] }))
  expect(io.apply).toHaveBeenCalledWith('gridex_apply_manual_commercial_reply_v1', expect.objectContaining({ p_payload: expect.objectContaining({ terms: expect.objectContaining({ earliestStartDate: '2027-04-01' }) }) }))
  expect(io.db.tables.manual_inbound_messages[0].attachments).toEqual(message.attachments)
  expect(io.db.tables.manual_inbound_messages[0].extracted_payload).toMatchObject({ manual_automation: { documentSources: { sourceVersion: 2, manifest: [expect.objectContaining({ sha256 })] } } })
})

it('does not retain stale tenant/customer foreign keys when document routing identifies a conflict', async () => {
  const text = 'Personnummer: 200002020002\nTidigaste start: 2027-04-01'
  const bytes = Buffer.from(text), sha256 = createHash('sha256').update(bytes).digest('hex')
  io.documentRouting.mockResolvedValue({ resolutionStatus: 'ambiguous', companyId: null, customerId: null, requestId: null, request: null,
    senderCredible: false, sites: [], reasons: ['document_customer_conflict'], evidence: { routing_version: 1 } })
  const result = await ingestManualInboundEmail(email('Se bilagan.', { attachments: [{ filename: 'svar.txt', contentType: 'text/plain', sizeBytes: bytes.length,
    mimePart: 1, sha256, sourceRole: 'attachment', contentBase64: bytes.toString('base64'), text }] }))
  expect(result).toMatchObject({ resolutionStatus: 'ambiguous', companyId: null, customerId: null, processingState: 'needs_review' })
  expect(io.db.tables.manual_inbound_messages[0]).toMatchObject({ company_id: null, customer_id: null, request_id: null })
  expect(io.apply).not.toHaveBeenCalled()
  expect(io.continuation).not.toHaveBeenCalled()
})

it.each([
  'PNR: 197001010002',
  'Kund: 197001010002',
  '197001010002',
  'Gäller kund K0000002',
])('runs the real canonical identity guard for a body-only reply with %s', async identity => {
  const router = await vi.importActual<typeof import('@/lib/inbound-mail/manualInboundRouting')>('@/lib/inbound-mail/manualInboundRouting')
  io.documentRouting.mockImplementation(router.resolveManualDocumentRouting)
  const result = await ingestManualInboundEmail(email(`${identity}\nAvtalsslut: 2027-03-31\nTidigaste start: 2027-04-01\nBrytavgift: Ingen`))
  expect(result).toMatchObject({ processingState: 'needs_review', companyId: null, customerId: null })
  expect(io.documentRouting).toHaveBeenCalledOnce()
  expect(io.db.tables.manual_inbound_messages[0]).toMatchObject({ company_id: null, customer_id: null, request_id: null, customer_site_id: null, metering_point_id: null })
  expect(io.apply).not.toHaveBeenCalled()
  expect(io.continuation).not.toHaveBeenCalled()
})

it('transcribes the original PDF, applies its cited terms, and resumes a failed transaction without paying for either reading again', async () => {
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '1'); vi.stubEnv('OPENAI_API_KEY', 'synthetic')
  const pdf = await PDFDocument.create(); pdf.addPage()
  const bytes = Buffer.from(await pdf.save()), sha256 = createHash('sha256').update(bytes).digest('hex')
  const attachmentId = `part:1:${sha256}`
  const text = 'Avtalsslut: 2027-03-31\nTidigaste start: 2027-04-01\nBrytavgift: Ingen'
  const calls: Row[] = []
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); calls.push(body)
    const transcription = body.text.format.name === 'manual_mail_document_transcription'
    const content = transcription ? { pages: [{ attachment_id: attachmentId, page: 1, text, complete: true, uncertain: false }] }
      : { outcome: 'contract_information', outcome_source: 1, review_reasons: [], fields: [
        { field: 'earliest_start', value: '2027-04-01', source: 1 }, { field: 'termination_fee', value: 'Ingen', source: 1 }] }
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(content) }] }] }))
  })
  io.apply.mockRejectedValueOnce(new Error('synthetic transaction unavailable'))
  const message = email('Se bilagan.', { attachments: [{ filename: 'avtal.pdf', contentType: 'application/pdf', sizeBytes: bytes.length,
    mimePart: 1, sha256, sourceRole: 'attachment', contentBase64: bytes.toString('base64') }] })
  await expect(ingestManualInboundEmail(message)).rejects.toThrow('synthetic transaction unavailable')
  expect(calls).toHaveLength(2)
  expect(await ingestManualInboundEmail(message)).toMatchObject({ processingState: 'applied' })
  expect(calls).toHaveLength(2)
  const payload = io.db.tables.manual_inbound_messages[0].extracted_payload as Row
  expect(payload).toMatchObject({ manual_automation: { documentReading: { status: 'completed', context: { company_id: null } },
    documentSources: { manifest: [expect.objectContaining({ sha256 })] } }, ai_read_only: { source_version: 2 } })
})

it('retains an uncertain PDF for review without applying apparently clear body dates or retrying OCR', async () => {
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '1'); vi.stubEnv('OPENAI_API_KEY', 'synthetic')
  const pdf = await PDFDocument.create(); pdf.addPage()
  const bytes = Buffer.from(await pdf.save()), sha256 = createHash('sha256').update(bytes).digest('hex')
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({
    pages: [{ attachment_id: `part:1:${sha256}`, page: 1, text: 'Ett oläsligt förbehåll.', complete: true, uncertain: true }],
  }) }] }] })))
  vi.stubGlobal('fetch', fetcher)
  const message = email('Tidigaste start: 2027-04-01\nBrytavgift: Ingen', { attachments: [{ filename: 'villkor.pdf', contentType: 'application/pdf', sizeBytes: bytes.length,
    mimePart: 1, sha256, sourceRole: 'attachment', contentBase64: bytes.toString('base64') }] })
  expect(await ingestManualInboundEmail(message)).toMatchObject({ processingState: 'needs_review' })
  expect(io.db.tables.manual_inbound_messages[0]).toMatchObject({ company_id: null, customer_id: null, request_id: null })
  await ingestManualInboundEmail(message)
  expect(fetcher).toHaveBeenCalledOnce()
  expect(io.apply).not.toHaveBeenCalled()
  expect(io.db.tables.manual_inbound_messages[0].extracted_payload).toMatchObject({ manual_automation: { documentReading: { status: 'failed', reason: 'uncertain_document' } } })
})

it('recognizes a canonically verified personal number and Gridex customer number as the same customer', async () => {
  io.db.tables.customers = [{ id: 'customer-a', company_id: 'tenant-a', personal_number: '200001010001', customer_number: 'K00100043' }]
  const result = await ingestManualInboundEmail(email('Personnummer: 200001010001\nKundnummer: K00100043\nTidigaste start: 2027-04-01\nBrytavgift: Ingen'))
  expect(result.processingState).toBe('applied')
  expect(io.apply).toHaveBeenCalledOnce()
})

it('does not ignore a current HTML condition when the plain alternative contains a clear start date', async () => {
  const result = await ingestManualInboundEmail(email('Tidigaste start: 2027-04-01\nBrytavgift: Ingen', {
    bodyHtml: '<p>Tidigaste start: 2027-04-01<br>Brytavgift: Ingen</p><p>Detta gäller endast om uppsägningen bekräftas.</p>',
  }))
  expect(result.processingState).toBe('needs_review')
  expect(io.apply).not.toHaveBeenCalled()
})

it('reads once and sends each facility its own dates while retaining the original parent customer and request', async () => {
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '1'); vi.stubEnv('OPENAI_API_KEY', 'synthetic')
  const first = 'Anläggnings-ID: 735999100000000001\nTidigaste start: 2027-04-01\nBrytavgift: Ingen'
  const second = 'Anläggnings-ID: 735999100000000002\nTidigaste start: 2027-06-01\nBrytavgift: Ingen'
  io.documentRouting.mockResolvedValue({ resolutionStatus: 'matched', companyId: 'tenant-a', customerId: 'customer-a',
    requestId: null, request: null, senderCredible: true, reasons: [],
    evidence: { site_requests: [{ customerSiteId: 'site-a', requestId: 'request-a' }, { customerSiteId: 'site-b', requestId: 'request-b' }] },
    sites: [{ customerSiteId: 'site-a', facilityId: '735999100000000001', bodyText: first, units: [] },
      { customerSiteId: 'site-b', facilityId: '735999100000000002', bodyText: second, units: [] }] })
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({
    outcome: 'contract_information', outcome_source: 0, review_reasons: ['multiple_facilities'], fields: [
      { field: 'earliest_start', value: '2027-04-01', source: 0 }, { field: 'termination_fee', value: 'Ingen', source: 0 },
      { field: 'earliest_start', value: '2027-06-01', source: 1 }, { field: 'termination_fee', value: 'Ingen', source: 1 },
    ],
  }) }] }] })))
  vi.stubGlobal('fetch', fetcher)
  const result = await ingestManualInboundEmail(email(`${first}\n\n${second}`))
  expect(result.processingState).toBe('applied')
  expect(fetcher).toHaveBeenCalledOnce()
  expect(io.apply).not.toHaveBeenCalled()
  expect(io.multiSite).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ companyId: 'tenant-a', customerId: 'customer-a',
    parentRequest: expect.objectContaining({ id: 'request-a' }), groups: [
      expect.objectContaining({ facilityId: '735999100000000001', extracted: expect.objectContaining({ earliest_supplier_start_date: '2027-04-01' }), reasons: [] }),
      expect.objectContaining({ facilityId: '735999100000000002', extracted: expect.objectContaining({ earliest_supplier_start_date: '2027-06-01' }), reasons: [] }),
    ] }))
  expect(io.db.tables.manual_inbound_messages[0]).toMatchObject({ company_id: 'tenant-a', customer_id: 'customer-a', request_id: 'request-a', customer_site_id: 'site-a' })
})

it('quarantines reused Message-ID with different signed raw bytes and reply headers instead of changing the original tenant', async () => {
  const first = email('Tidigaste start: 2027-04-01\nBrytavgift: Ingen', { inReplyTo: '<thread-a@example.org>' })
  first.senderVerification = { ...first.senderVerification!, signed_headers: ['from', 'subject', 'in-reply-to'] }
  io.apply.mockRejectedValueOnce(new Error('transient transaction error'))
  await expect(ingestManualInboundEmail(first)).rejects.toThrow('transient transaction error')
  const originalId = io.db.tables.manual_inbound_messages[0].id
  io.db.tables.grid_owner_information_requests[0] = { ...request, id: 'request-b', company_id: 'tenant-b', customer_id: 'customer-b', customer_site_id: 'site-b' }
  const second = { ...first, inReplyTo: '<thread-b@example.org>', senderVerification: { ...first.senderVerification!, raw_sha256: 'b'.repeat(64) } }
  expect(await ingestManualInboundEmail(second)).toMatchObject({ processingState: 'needs_review', companyId: null, customerId: null })
  expect(io.db.tables.manual_inbound_messages).toHaveLength(2)
  expect(io.db.tables.manual_inbound_messages.find(row => row.id === originalId)).toMatchObject({ company_id: 'tenant-a', request_id: 'request-a', in_reply_to: first.inReplyTo })
  expect(io.apply).toHaveBeenCalledOnce()
})

it('surfaces an authenticated matched reply for review when its transaction keeps failing', async () => {
  io.apply.mockRejectedValueOnce(new Error('transaction unavailable'))
  await expect(ingestManualInboundEmail(email('Avtalsslut: 2027-03-31\nTidigaste start: 2027-04-01\nBrytavgift: Ingen'))).rejects.toThrow('transaction unavailable')
  const source = io.db.tables.manual_inbound_messages[0]
  expect(source).toMatchObject({ resolution_status: 'matched', processing_state: 'matched', company_id: 'tenant-a', customer_id: 'customer-a' })
  expect(io.continuation).not.toHaveBeenCalled()

  // Evaluate the emitted stale-state query against the real persisted source.
  // This is a PostgREST port contract, not a remote backend/transport test.
  const now = new Date(new Date(String(source.received_at)).getTime() + 60 * 60_000)
  let predicate = ''
  const q: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'range']) q[method] = () => q
  q.or = (value: string) => { predicate = value; return q }
  q.then = (resolve: (value: unknown) => unknown) => {
    const stale = predicate.match(/and\(processing_state\.in\.\(([^)]+)\),received_at\.lt\.([^)]*)\)/)
    const eligible = !!stale && stale[1].split(',').includes(String(source.processing_state))
      && String(source.received_at) < stale[2]
    return Promise.resolve(resolve({ data: eligible ? [source] : [], count: eligible ? 1 : 0, error: null }))
  }
  const result = await getManualMailReviewQueue({ from: () => q } as never, {}, now)
  expect(result.rows.map(row => row.id)).toContain(source.id)
  expect(result.total).toBe(1)
  source.processing_state = 'applied'
  expect((await getManualMailReviewQueue({ from: () => q } as never, {}, now)).rows).toHaveLength(0)
})

it('keeps proven sender signature identity out of customer facts while retaining the complete reply for semantic review', async () => {
  io.db.tables.customers = [{ id: 'customer-a', company_id: 'tenant-a', personal_number: '200001010001', org_number: null }]
  io.documentRouting.mockResolvedValue({ resolutionStatus: 'matched', companyId: 'tenant-a', customerId: 'customer-a', requestId: 'request-a',
    request: { ...request }, senderCredible: true, sites: [{ customerSiteId: 'site-a', facilityId: null, units: [] }], reasons: [],
    evidence: { sender_organization_numbers: ['5566778899'], body_identifiers: [{ kind: 'personal_number', value: '200001010001' }], document_identifiers: [] } })
  const result = await ingestManualInboundEmail(email('Personnummer: 200001010001\nTidigaste start: 2027-04-01\nBrytavgift: Ingen\n\nMed vänliga hälsningar\nKundservice Energi AB\nOrg.nr: 5566778899'))
  expect(result.processingState).toBe('applied')
  expect(io.apply.mock.calls[0][1].p_payload.extracted).not.toHaveProperty('org_number')
})

it('records a visible continuation failure when initial facility application commits before its next step throws', async () => {
  Object.assign(io.db.tables.grid_owner_information_requests[0], { request_type: 'facility_identifier_lookup', grid_owner_id: 'grid-a' })
  io.facility.mockImplementationOnce(async (input: Row) => {
    const automatic = input.automaticInbound as Row
    const source = io.db.tables.manual_inbound_messages.find(row => row.id === automatic.inboundId)!
    const payload = source.extracted_payload as Row
    const application = { version: 1, applied: true, inboundId: source.id, inbound_id: source.id, sourceHash: automatic.sourceHash,
      companyId: 'tenant-a', customerId: 'customer-a', siteId: 'site-a', requestId: 'request-a',
      result: { ok: true, requestId: 'request-a', customerId: 'customer-a', customerSiteId: 'site-a', facilityId: '735999100000000001' } }
    source.processing_state = 'applied'
    source.extracted_payload = { ...payload, manual_automation: { ...(payload.manual_automation as Row), application } }
    Object.assign(io.db.tables.grid_owner_information_requests[0], { status: 'completed', parsed_payload: application })
    throw new Error('post-commit continuation unavailable')
  })
  await expect(ingestManualInboundEmail(email('Anläggnings-ID: 735999100000000001\nNätområde: ABC\nElområde: SE3'))).rejects.toThrow('post-commit continuation unavailable')
  expect(io.db.tables.manual_inbound_messages[0].extracted_payload).toMatchObject({ manual_automation: { continuation: { status: 'failed', reason: 'continuation_failed' } } })
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
  expect(fetcher).not.toHaveBeenCalled(); expect(io.apply).not.toHaveBeenCalled()
})

it.each([
  ['Vi nekar er fullmakt. BankID-signatur saknas.', 'rejected'],
  ['Fullmakten saknar verifikatsnummer. Återkom med komplett fullmakt.', 'completion_requested'],
])('records the trusted deterministic counterpart hold without reserving or calling AI: %s', async (bodyText, outcome) => {
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '1'); vi.stubEnv('OPENAI_API_KEY', 'synthetic')
  const fetcher = vi.fn(async () => { throw new Error('Unexpected paid reading before the already determined hold.') })
  vi.stubGlobal('fetch', fetcher)
  // The database transaction is an external port here; its guard behavior is
  // exercised separately by the actual counterparty-hold SQL suite.
  io.apply.mockResolvedValue({ data: { ok: true, held: true, customerId: 'customer-a', customerSiteId: 'site-a' }, error: null })
  const result = await ingestManualInboundEmail(email(bodyText))
  expect(result.processingState).toBe('needs_review')
  expect(fetcher).not.toHaveBeenCalled()
  expect(io.db.tables.manual_inbound_messages[0].extracted_payload).not.toHaveProperty('ai_read_only')
  expect(io.apply).toHaveBeenCalledExactlyOnceWith('gridex_hold_manual_counterparty_reply_v1', expect.objectContaining({
    p_company_id: 'tenant-a', p_request_id: 'request-a', p_inbound_id: result.inboundId,
    p_assessment: expect.objectContaining({ outcome }),
  }))
  expect(io.facility).not.toHaveBeenCalled(); expect(io.continuation).not.toHaveBeenCalled()
})

it('does not wait for an earlier AI reservation before recording an already determined trusted rejection', async () => {
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '1'); vi.stubEnv('OPENAI_API_KEY', 'synthetic')
  const message = email('Vi nekar er fullmakt. BankID-signatur saknas.')
  const sourceHash = createHash('sha256').update(message.bodyText!).digest('hex')
  const attempt = { version: 1, attempt_id: 'pending-attempt', status: 'processing', mode: 'read_only', review_required: true,
    source_hash: sourceHash, started_at: '2026-10-18T10:00:00Z',
    context: { company_id: 'tenant-a', customer_id: 'customer-a', request_id: 'request-a' } }
  io.db.tables.manual_inbound_messages.push({ id: 'pending-rejection', mailbox: message.mailbox, provider_message_id: message.providerMessageId,
    from_email: message.fromEmail, subject: message.subject, body_text: message.bodyText, body_html: null, attachments: [],
    company_id: 'tenant-a', customer_id: 'customer-a', customer_site_id: 'site-a', request_id: 'request-a',
    resolution_status: 'matched', processing_state: 'matched', received_at: '2026-10-18T10:00:00Z',
    extracted_payload: { sender_credible: true, sender_verification: message.senderVerification,
      reply_assessment: assessManualReply(message.bodyText!, message.subject), mime_requires_review: false,
      manual_reply_structure_requires_review: false, customer_identity_review_reasons: [],
      manual_automation: { version: 1, sourceHash }, ai_read_only: attempt } })
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  io.apply.mockResolvedValue({ data: { ok: true, held: true, customerId: 'customer-a', customerSiteId: 'site-a' }, error: null })
  const result = await ingestManualInboundEmail(message)
  expect(result.processingState).toBe('needs_review')
  expect(io.apply).toHaveBeenCalledExactlyOnceWith('gridex_hold_manual_counterparty_reply_v1', expect.objectContaining({ p_inbound_id: 'pending-rejection' }))
  expect(fetcher).not.toHaveBeenCalled()
  expect((io.db.tables.manual_inbound_messages[0].extracted_payload as Row).ai_read_only).toEqual(attempt)
})

it('does not spend AI or record a counterpart hold when the authenticated rejection names another customer', async () => {
  io.db.tables.customers = [{ id: 'customer-a', company_id: 'tenant-a', personal_number: '200001010001', org_number: null }]
  vi.stubEnv('MANUAL_MAIL_AI_ENABLED', '1'); vi.stubEnv('OPENAI_API_KEY', 'synthetic')
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const result = await ingestManualInboundEmail(email('Personnummer: 200002020002\nVi nekar er fullmakt. BankID-signatur saknas.'))
  expect(result.processingState).toBe('needs_review')
  expect(fetcher).not.toHaveBeenCalled(); expect(io.apply).not.toHaveBeenCalled()
  expect(io.db.tables.grid_owner_information_requests[0].metadata).toEqual({})
  expect(io.db.tables.manual_inbound_messages[0].extracted_payload).toMatchObject({ customer_identity_review_reasons: ['customer_identity_mismatch'] })
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
