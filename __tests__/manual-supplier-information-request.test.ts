import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import { createFakeDb, type FakeDb } from './helpers/poaMailFakeDb'

type Row = Record<string, unknown>
const port = vi.hoisted(() => ({ db: null as unknown as { client: unknown }, sends: [] as Row[] }))
vi.mock('@/lib/supabase/service', () => ({ get supabaseService() { return port.db.client } }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/tenant/operationPolicy', () => ({ getTenantOperationDecision: async () => ({ allowed: true }) }))
// Timeline/notification effects are external to the review transition asserted here.
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: async () => undefined }))
vi.mock('@/lib/email/providers', () => ({ getEmailProvider: () => ({ sendEmail: async (mail: Row) => {
  port.sends.push(mail); return { providerMessageId: 'synthetic-provider-id' }
} }) }))

import { queueManualSupplierInformationRequest } from '@/lib/customer-operations/manualSupplierInformationRequest'
import { findCurrentSupplierManualContact, readManualSupplierSendContext } from '@/lib/customer-operations/manualGridOwnerSendGuards'
import { processManualEmailOutbox } from '@/lib/email/manualEmailOutbox'
import { resolveManualInboundCorrelation } from '@/lib/inbound-mail/manualInboundCorrelation'
import { runManualGridOwnerFollowUpWatchdog } from '@/lib/customer-operations/manualGridOwnerFollowUps'
import { queueCustomerInfoRequestForDispatch } from '@/lib/onboarding/infoRequests'
import { ensurePoaPdfArchive } from '@/lib/customers/poaDocuments'
import { resolveManualReplyReview } from '@/lib/inbound-mail/manualReplyReview'
import { recordManualCounterpartyReply } from '@/lib/inbound-mail/manualCounterpartyReply'
import { assessManualReply } from '@/lib/inbound-mail/manualReplyAssessment'
import { renderFullmaktPdf } from '@/lib/email/fullmaktPdf'

const CO = '11111111-1111-4111-8111-111111111111'
const input = { companyId: CO, customerId: 'customer-1', siteId: 'site-1', customerInfoRequestId: 'cir-1', actorUserId: null }

function seed(): FakeDb {
  return createFakeDb({
    companies: [{ id: CO, legal_name: 'Synthetic El AB', org_number: '559999-9984', status: 'active', is_active: true }],
    customers: [{ id: 'customer-1', company_id: CO, full_name: 'Synthetic Customer', personal_number: '199001011234', customer_number: 'K0001' }],
    customer_sites: [{ id: 'site-1', company_id: CO, customer_id: 'customer-1', current_supplier_id: 'supplier-1', street: 'Gatan 1', postal_code: '11122', city: 'Stockholm', address_hash: 'hash-1', facility_data_status: 'facility_verified', protected_identity: false }],
    electricity_suppliers: [{ id: 'supplier-1', company_id: null, name: 'Synthetic supplier', is_active: true, platform_market_actor_id: 'actor-1' }],
    platform_market_actors: [{ id: 'actor-1', status: 'active', match_status: 'verified' }],
    platform_actor_roles: [{ actor_id: 'actor-1', actor_role: 'electricity_supplier', is_active: true }],
    platform_actor_contacts: [{ id: 'contact-1', actor_id: 'actor-1', contact_type: 'poa', channel: 'email', email: 'fullmakt@supplier.example', is_verified: true, verified_at: '2026-01-01T10:00:00Z', valid_from: '2026-01-01', valid_to: null, source: 'manual_admin' }],
    customer_info_requests: [{ id: 'cir-1', company_id: CO, customer_id: 'customer-1', site_id: 'site-1', metering_point_id: null, authorization_document_id: 'doc-1', request_type: 'supplier_contract_information', target_party_type: 'current_supplier', status: 'ready_to_send', verified_payload: {}, requested_data_categories: ['binding_period', 'notice_period'], grid_owner_data_request_id: null, outbound_request_id: null, ediel_message_id: null }],
    customer_authorization_documents: [{ id: 'doc-1', company_id: CO, customer_id: 'customer-1', site_id: 'site-1', metering_point_id: null, power_of_attorney_id: 'poa-1', customer_contract_id: null, document_type: 'power_of_attorney', status: 'active' }],
    authorization_scopes: [{ id: 'scope-1', company_id: CO, customer_id: 'customer-1', authorization_document_id: 'doc-1', status: 'active', revoked_at: null, valid_from: '2026-01-01', valid_to: '2030-12-31', covers_current_supplier_contract: true, created_at: '2026-01-01T00:00:00Z' }],
    powers_of_attorney: [{ id: 'poa-1', company_id: CO, customer_id: 'customer-1', site_id: 'site-1', customer_site_id: 'site-1', document_id: 'doc-1', status: 'signed', scope: 'current_supplier_contract', signed_scope_snapshot: ['current_supplier_contract'], accepted_at: '2026-01-01T10:00:00Z', signed_at: '2026-01-01T10:00:00Z', signer_name: 'Synthetic Customer', signer_identity_number: '199001011234', method: 'website_acceptance', fullmakt_snapshot: { legal_text: { title: 'Fullmakt', body: 'Synthetic accepted contract information scope.' } }, source: 'admin', valid_from: '2026-01-01', valid_to: '2030-12-31', revoked_at: null, evidence_payload: { verification_reference: 'synthetic-verification-1' }, metadata: {}, document_path: null, updated_at: null }],
    manual_communication_mailboxes: [{ id: 'mailbox-1', company_id: null, mailbox_type: 'manual_supplier_switch', environment: 'production', from_email: 'leverantorsbyte@gridex.example', is_active: true, is_verified: true }],
    grid_owner_information_requests: [], manual_email_outbox: [], metering_points: [], grid_owner_contact_channels: [], customer_contracts: [], ediel_mailboxes: [], market_calendar_days: [],
  })
}

let db: FakeDb
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T12:00:00Z'))
  vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('GRIDEX_MANUAL_OPS_ENVIRONMENT', '')
  vi.stubEnv('MANUAL_GRID_OWNER_SAFE_RECIPIENT', '')
  db = seed(); port.db = db; port.sends = []
  // Finite external RPC port for these outbox/review tests. The real SQL
  // authentication, locking and ordering are exercised by the hold SQL suite.
  Object.assign(db.client, { rpc: async (name: string, args: Row) => {
    if (name !== 'gridex_hold_manual_counterparty_reply_v1') throw new Error(`Unexpected supplier RPC ${name}`)
    const request = db.tables.grid_owner_information_requests.find((row) => row.id === args.p_request_id && row.company_id === args.p_company_id)
    const source = db.tables.manual_inbound_messages?.find((row) => row.id === args.p_inbound_id)
    const payload = source?.extracted_payload as Row | undefined
    const verification = payload?.sender_verification as Row | undefined
    const metadata = request?.metadata as Row | undefined
    const site = db.tables.customer_sites.find((row) => row.id === request?.customer_site_id && row.company_id === args.p_company_id && row.customer_id === request?.customer_id)
    const noHold = { data: { ok: false, held: false }, error: null }
    if (!request || !source || request.request_type !== 'current_supplier_contract_information_request'
      || !['manual_email_queued', 'manual_email_sent', 'waiting_manual_response', 'needs_review', 'ready_to_send_manual_email', 'completed'].includes(String(request.status))
      || source.company_id !== args.p_company_id || source.request_id !== request.id
      || source.customer_id !== request.customer_id || source.customer_site_id !== request.customer_site_id
      || source.resolution_status !== 'matched' || payload?.sender_credible !== true
      || verification?.status !== 'verified' || verification?.method !== 'dkim'
      || !isDeepStrictEqual(payload?.reply_assessment, args.p_assessment)
      || !site || site.current_supplier_id !== metadata?.supplier_id || !Number.isFinite(Date.parse(String(source.received_at)))) return noHold
    const previous = (metadata?.counterparty_reply ?? {}) as Row
    if (previous.inbound_id !== source.id && request.received_at && Date.parse(String(source.received_at)) <= Date.parse(String(request.received_at))) return noHold
    const hold = { ...(args.p_assessment as Row), requires_review: true, inbound_id: source.id, poa_id: request.poa_id,
      received_at: source.received_at, sourceHash: (payload?.manual_automation as Row).sourceHash }
    Object.assign(request, { status: request.status === 'completed' ? 'completed' : 'needs_review', received_at: source.received_at,
      next_follow_up_at: null, metadata: { ...metadata, counterparty_reply: hold }, updated_at: new Date().toISOString() })
    site.current_supplier_response_status = 'manual_review'
    const cir = db.tables.customer_info_requests.find((row) => row.id === metadata?.customer_info_request_id && row.company_id === args.p_company_id)
    if (cir) {
      cir.status = 'manual_review_required'
      cir.verified_payload = { ...(cir.verified_payload as Row), counterparty_reply: hold }
      cir.blocker_code = 'current_supplier_poa_completion_required'
      cir.blocker_details = { manual_supplier_request_id: request.id, inbound_id: source.id }
    }
    return { data: { ok: true, held: true, customerId: request.customer_id, customerSiteId: request.customer_site_id }, error: null }
  } })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

function afterContactRead(change: () => void): void {
  const from = db.client.from
  db.client.from = (table) => {
    const query = from(table)
    if (table !== 'platform_actor_contacts') return query
    const thenable = query as { then: (resolved: (value: unknown) => unknown, rejected?: (reason: unknown) => unknown) => unknown }
    const then = thenable.then.bind(thenable)
    thenable.then = (resolved, rejected) => then((value) => { change(); return resolved(value) }, rejected)
    return query
  }
}

function assessedReply(text: string) {
  const assessment = assessManualReply(text)
  if (!assessment) throw new Error('Synthetic counterpart reply must produce a review assessment.')
  return assessment
}

async function recordSupplierReview(request: Row, inboundId: string, text: string) {
  const assessment = assessedReply(text)
  ;(db.tables.manual_inbound_messages ??= []).push({ id: inboundId, company_id: CO, request_id: request.id,
    customer_id: request.customer_id, customer_site_id: request.customer_site_id, resolution_status: 'matched',
    received_at: new Date().toISOString(), extracted_payload: { sender_credible: true,
      sender_verification: { version: 1, status: 'verified', method: 'dkim' }, reply_assessment: assessment,
      manual_automation: { version: 1, sourceHash: 'a'.repeat(64) } } })
  await recordManualCounterpartyReply({ companyId: CO, request, inboundId, assessment })
}

describe('supplier inquiry queue', () => {
  it('dispatches the public CIR supplier branch through the real manual outbox', async () => {
    const requestId = '22222222-2222-4222-8222-222222222222'
    db.tables.customer_info_requests[0].id = requestId
    const result = await queueCustomerInfoRequestForDispatch({ companyId: CO, actorUserId: '33333333-3333-4333-8333-333333333333', requestId })
    expect(result.status).toBe('ready_to_send')
    expect(db.tables.manual_email_outbox).toHaveLength(1)
    expect(db.tables.grid_owner_information_requests[0].request_type).toBe('current_supplier_contract_information_request')
    expect(db.tables.grid_owner_data_requests ?? []).toHaveLength(0)
  })

  it('creates a real separate supplier conversation and archives its exact authorized POA', async () => {
    const result = await queueManualSupplierInformationRequest(input)
    expect(result.status).toBe('queued')
    expect(db.tables.grid_owner_information_requests).toHaveLength(1)
    const request = db.tables.grid_owner_information_requests[0]
    expect(request).toMatchObject({ company_id: CO, customer_id: 'customer-1', customer_site_id: 'site-1', grid_owner_id: null,
      request_type: 'current_supplier_contract_information_request', poa_id: 'poa-1', status: 'manual_email_queued',
      metadata: { target_party: 'current_supplier', customer_info_request_id: 'cir-1', supplier_id: 'supplier-1', supplier_actor_id: 'actor-1', supplier_contact_id: 'contact-1' } })
    expect(db.tables.manual_email_outbox).toHaveLength(1)
    const mail = db.tables.manual_email_outbox[0]
    expect(mail.to_email).toBe('fullmakt@supplier.example')
    expect(String(mail.subject)).toContain('Handelsuppgifter')
    expect(String(mail.subject)).toContain(String(request.case_reference))
    expect(String(mail.body_text)).toContain('Verifikatsnummer: synthetic-verification-1')
    expect((mail.attachments as Row[])[0]).toMatchObject({ poa_id: 'poa-1', kind: 'power_of_attorney_archived_pdf' })
    expect(db.storageUploads).toHaveLength(1)
    expect(port.sends).toHaveLength(0)
  })

  it('deduplicates repeated queue calls without a second message', async () => {
    const first = await queueManualSupplierInformationRequest(input)
    const second = await queueManualSupplierInformationRequest(input)
    expect(second.requestId).toBe(first.requestId)
    expect(second.emailOutboxId).toBe(first.emailOutboxId)
    expect(db.tables.grid_owner_information_requests).toHaveLength(1)
    expect(db.tables.manual_email_outbox).toHaveLength(1)
  })

  it.each([
    ['missing stable supplier', () => { db.tables.customer_sites[0].current_supplier_id = null }],
    ['foreign tenant supplier', () => { db.tables.electricity_suppliers[0].company_id = 'other-company' }],
    ['inactive supplier', () => { db.tables.electricity_suppliers[0].is_active = false }],
    ['unverified actor', () => { db.tables.platform_market_actors[0].match_status = 'needs_review' }],
    ['wrong actor role', () => { db.tables.platform_actor_roles[0].actor_role = 'grid_owner' }],
    ['unverified contact', () => { db.tables.platform_actor_contacts[0].is_verified = false }],
    ['contact without verification timestamp', () => { db.tables.platform_actor_contacts[0].verified_at = null }],
    ['expired contact', () => { db.tables.platform_actor_contacts[0].valid_to = '2026-10-17' }],
    ['ambiguous contacts', () => { db.tables.platform_actor_contacts.push({ ...db.tables.platform_actor_contacts[0], id: 'contact-2', email: 'other@supplier.example' }) }],
    ['revoked POA', () => { db.tables.powers_of_attorney[0].revoked_at = '2026-10-17T10:00:00Z' }],
    ['wrong immutable scope', () => { db.tables.powers_of_attorney[0].signed_scope_snapshot = ['facility_information_lookup'] }],
    ['foreign customer site', () => { db.tables.customer_sites[0].customer_id = 'other-customer' }],
    ['protected customer', () => { db.tables.customer_sites[0].protected_identity = true }],
  ])('requires review for %s and never queues customer data', async (_label, mutate) => {
    mutate()
    const result = await queueManualSupplierInformationRequest(input)
    expect(result.status).toBe('needs_review')
    expect(result.blockerCode).toBeTruthy()
    expect(db.tables.manual_email_outbox).toHaveLength(0)
    expect(port.sends).toHaveLength(0)
  })

  it('does not infer a supplier from a matching display name or raw email', async () => {
    db.tables.customer_sites[0].current_supplier_id = null
    db.tables.customer_sites[0].current_supplier_name = 'Synthetic supplier'
    db.tables.electricity_suppliers[0].contract_email = 'fullmakt@supplier.example'
    expect((await queueManualSupplierInformationRequest(input)).status).toBe('needs_review')
    expect(db.tables.manual_email_outbox).toHaveLength(0)
  })

  it('never resumes a conversation held after a counterpart rejection', async () => {
    await queueManualSupplierInformationRequest(input)
    const request = db.tables.grid_owner_information_requests[0]
    request.status = 'needs_review'
    request.metadata = { ...(request.metadata as Row), counterparty_reply: { requires_review: true } }
    expect((await queueManualSupplierInformationRequest(input)).status).toBe('needs_review')
    expect(db.tables.manual_email_outbox).toHaveLength(1)
  })

  it('does not label downloaded old PDF bytes with a concurrently changed POA fingerprint', async () => {
    await ensurePoaPdfArchive({ companyId: CO, customerId: 'customer-1', powerOfAttorneyId: 'poa-1' })
    const storageFrom = db.client.storage.from
    db.client.storage.from = (bucket) => {
      const storage = storageFrom(bucket)
      return { ...storage, download: async (path) => {
        const bytes = await storage.download(path)
        db.tables.powers_of_attorney[0].fullmakt_snapshot = { legal_text: { title: 'Fullmakt', body: 'Changed legal text after the original PDF was downloaded.' } }
        return bytes
      } }
    }
    const result = await queueManualSupplierInformationRequest(input)
    expect(result.status).toBe('needs_review')
    expect(result.blockerCode).toBe('poa_document_evidence_changed')
    expect(db.tables.manual_email_outbox).toHaveLength(0)
  })

  it('creates exactly one new attempt after the actual counterpart review is resolved', async () => {
    await queueManualSupplierInformationRequest(input)
    await processManualEmailOutbox({ companyId: CO })
    const initial = db.tables.manual_email_outbox[0]
    const initialKey = initial.idempotency_key
    const request = db.tables.grid_owner_information_requests[0]
    vi.setSystemTime(new Date('2026-10-18T13:00:00Z'))
    await recordSupplierReview(request, 'reply-review-1', 'Fullmakten saknar verifikatsnummer. Återkom med komplettering.')
    vi.setSystemTime(new Date('2026-10-18T14:00:00Z'))
    await resolveManualReplyReview({ companyId: CO, requestId: String(request.id), powerOfAttorneyId: 'poa-1', actorUserId: CO, note: 'Verifikatsnummer och komplett underlag är kontrollerade.' })
    expect(request.status).toBe('ready_to_send_manual_email')
    const result = await queueManualSupplierInformationRequest(input)
    expect(result.status).toBe('queued')
    expect(db.tables.manual_email_outbox).toHaveLength(2)
    expect(initial.status).toBe('sent')
    expect(initial.idempotency_key).toBe(initialKey)
    const corrected = db.tables.manual_email_outbox[1]
    expect(corrected.idempotency_key).not.toBe(initialKey)
    expect((corrected.recipient_resolution as Row).review_resolution_key).toBeTruthy()
    const replay = await queueManualSupplierInformationRequest(input)
    expect(replay.emailOutboxId).toBe(result.emailOutboxId)
    expect(db.tables.manual_email_outbox).toHaveLength(2)
    expect((await processManualEmailOutbox({ companyId: CO })).sent).toBe(1)
    expect(port.sends).toHaveLength(2)
    await queueManualSupplierInformationRequest(input)
    expect(db.tables.manual_email_outbox).toHaveLength(2)
  })

  it('does not retry an uncertain delivery merely because a counterpart review was resolved', async () => {
    await queueManualSupplierInformationRequest(input)
    const request = db.tables.grid_owner_information_requests[0]
    db.tables.manual_email_outbox[0].status = 'delivery_uncertain'
    vi.setSystemTime(new Date('2026-10-18T13:00:00Z'))
    await recordSupplierReview(request, 'reply-review-1', 'Fullmakten saknar verifikatsnummer. Återkom med komplettering.')
    vi.setSystemTime(new Date('2026-10-18T14:00:00Z'))
    await resolveManualReplyReview({ companyId: CO, requestId: String(request.id), powerOfAttorneyId: 'poa-1', actorUserId: CO, note: 'Kompletterat underlag har kontrollerats.' })
    expect((await queueManualSupplierInformationRequest(input)).status).toBe('needs_review')
    expect(db.tables.manual_email_outbox).toHaveLength(1)
    expect(db.tables.manual_email_outbox[0].status).toBe('delivery_uncertain')
  })

  it('rejects changed PDF bytes even when the POA fingerprint and storage path stayed the same', async () => {
    const archive = await ensurePoaPdfArchive({ companyId: CO, customerId: 'customer-1', powerOfAttorneyId: 'poa-1' })
    db.storageFiles.set(`customer-documents/${archive.path}`, renderFullmaktPdf({ legalText: 'Different valid synthetic PDF, not the archived original.' }))
    const result = await queueManualSupplierInformationRequest(input)
    expect(result.status).toBe('needs_review')
    expect(result.blockerCode).toBe('poa_document_evidence_changed')
    expect(db.tables.manual_email_outbox).toHaveLength(0)
  })

  it('replaces only an old queued attempt after a fresh approved review', async () => {
    await queueManualSupplierInformationRequest(input)
    const old = db.tables.manual_email_outbox[0]
    const request = db.tables.grid_owner_information_requests[0]
    vi.setSystemTime(new Date('2026-10-18T13:00:00Z'))
    await recordSupplierReview(request, 'reply-review-1', 'Fullmakten saknar verifikatsnummer. Återkom med komplettering.')
    vi.setSystemTime(new Date('2026-10-18T14:00:00Z'))
    await resolveManualReplyReview({ companyId: CO, requestId: String(request.id), powerOfAttorneyId: 'poa-1', actorUserId: CO, note: 'Kompletterat underlag har kontrollerats.' })
    expect((await queueManualSupplierInformationRequest(input)).status).toBe('queued')
    expect(db.tables.manual_email_outbox).toHaveLength(2)
    expect(old.status).toBe('failed')
    expect((old.attachments as Row[])[0].content).toBeUndefined()
    expect(db.tables.manual_email_outbox[1].status).toBe('queued')
  })

  it('keeps a newer review hold that arrives while a corrected attempt reads the archived PDF', async () => {
    await queueManualSupplierInformationRequest(input)
    const old = db.tables.manual_email_outbox[0]
    const request = db.tables.grid_owner_information_requests[0]
    vi.setSystemTime(new Date('2026-10-18T13:00:00Z'))
    await recordSupplierReview(request, 'reply-review-1', 'Fullmakten saknar verifikatsnummer. Återkom med komplettering.')
    vi.setSystemTime(new Date('2026-10-18T14:00:00Z'))
    await resolveManualReplyReview({ companyId: CO, requestId: String(request.id), powerOfAttorneyId: 'poa-1', actorUserId: CO, note: 'Kompletterat underlag har kontrollerats.' })
    const storageFrom = db.client.storage.from
    db.client.storage.from = (bucket) => {
      const storage = storageFrom(bucket)
      return { ...storage, download: async (path) => {
        const bytes = await storage.download(path)
        await recordSupplierReview(request, 'newer-hold', 'Fullmakten är ogiltig. Återkom med ny fullmakt.')
        return bytes
      } }
    }
    expect((await queueManualSupplierInformationRequest(input)).status).toBe('needs_review')
    expect(db.tables.manual_email_outbox).toHaveLength(1)
    expect(old.status).toBe('queued')
    expect(request.status).toBe('needs_review')
    expect(((request.metadata as Row).counterparty_reply as Row).inbound_id).toBe('newer-hold')
    expect(port.sends).toHaveLength(0)
  })
})

describe('completed commercial review resolution', () => {
  it('resumes the same completed conversation after review when no active sibling exists', async () => {
    await queueManualSupplierInformationRequest(input)
    await processManualEmailOutbox({ companyId: CO })
    const request = db.tables.grid_owner_information_requests[0]
    request.status = 'completed'
    vi.setSystemTime(new Date('2026-10-18T13:00:00Z'))
    await recordSupplierReview(request, 'late-denial', 'Fullmakten saknar verifikatsnummer. Återkom med komplettering.')
    expect(request.status).toBe('completed')
    vi.setSystemTime(new Date('2026-10-18T14:00:00Z'))
    await resolveManualReplyReview({ companyId: CO, requestId: String(request.id), powerOfAttorneyId: 'poa-1', actorUserId: CO,
      note: 'Kompletterat original och verifikatsnummer har kontrollerats.' })
    expect(request.status).toBe('ready_to_send_manual_email')
    expect((await queueManualSupplierInformationRequest(input)).status).toBe('queued')
    expect(db.tables.grid_owner_information_requests).toHaveLength(1)
    expect(db.tables.manual_email_outbox).toHaveLength(2)
    expect((db.tables.customer_info_requests[0].verified_payload as Row).counterparty_reply).toMatchObject({
      requires_review: false, inbound_id: 'late-denial', reviewed_by: CO,
    })
  })

  it('keeps a different CIR hold after the conversation itself was reviewed', async () => {
    await queueManualSupplierInformationRequest(input)
    await processManualEmailOutbox({ companyId: CO })
    const request = db.tables.grid_owner_information_requests[0]
    vi.setSystemTime(new Date('2026-10-18T13:00:00Z'))
    await recordSupplierReview(request, 'reviewed-denial', 'Fullmakten saknar verifikatsnummer. Återkom med komplettering.')
    vi.setSystemTime(new Date('2026-10-18T14:00:00Z'))
    await resolveManualReplyReview({ companyId: CO, requestId: String(request.id), powerOfAttorneyId: 'poa-1', actorUserId: CO,
      note: 'Kompletteringen är kontrollerad mot originalet.' })
    const cir = db.tables.customer_info_requests[0]
    const payload = cir.verified_payload as Row
    cir.verified_payload = { ...payload, counterparty_reply: { ...(payload.counterparty_reply as Row), inbound_id: 'different-denial' } }
    const before = structuredClone(cir)
    expect((await queueManualSupplierInformationRequest(input)).status).toBe('needs_review')
    expect(cir).toEqual(before)
    expect(db.tables.manual_email_outbox).toHaveLength(1)
  })

  it('keeps a newer CIR hold arriving during archived document retrieval', async () => {
    await queueManualSupplierInformationRequest(input)
    await processManualEmailOutbox({ companyId: CO })
    const request = db.tables.grid_owner_information_requests[0]
    vi.setSystemTime(new Date('2026-10-18T13:00:00Z'))
    await recordSupplierReview(request, 'reviewed-denial', 'Fullmakten saknar verifikatsnummer. Återkom med komplettering.')
    vi.setSystemTime(new Date('2026-10-18T14:00:00Z'))
    await resolveManualReplyReview({ companyId: CO, requestId: String(request.id), powerOfAttorneyId: 'poa-1', actorUserId: CO,
      note: 'Kompletteringen är kontrollerad mot originalet.' })
    const cir = db.tables.customer_info_requests[0]
    const storageFrom = db.client.storage.from
    db.client.storage.from = (bucket) => {
      const storage = storageFrom(bucket)
      return { ...storage, download: async (path) => {
        const bytes = await storage.download(path)
        const payload = cir.verified_payload as Row
        cir.verified_payload = { ...payload, counterparty_reply: { ...(payload.counterparty_reply as Row), inbound_id: 'newer-denial' } }
        return bytes
      } }
    }
    expect((await queueManualSupplierInformationRequest(input)).status).toBe('needs_review')
    expect((cir.verified_payload as Row).counterparty_reply).toMatchObject({ requires_review: true, inbound_id: 'newer-denial' })
    expect(db.tables.manual_email_outbox).toHaveLength(1)
  })

  it('clears the exact reviewed hold while preserving completed status, facts, site blocker and newer conversation', async () => {
    await queueManualSupplierInformationRequest(input)
    const request = db.tables.grid_owner_information_requests[0]
    request.status = 'completed'
    request.parsed_payload = { applied: true, original_terms: 'preserved' }
    request.metadata = { ...(request.metadata as Row), counterparty_reply: { requires_review: true, inbound_id: 'late-denial', sourceHash: 'a'.repeat(64) } }
    db.tables.customer_sites[0].current_supplier_response_status = 'manual_review'
    const sibling = { ...request, id: 'newer-conversation', status: 'waiting_manual_response', metadata: {} }
    db.tables.grid_owner_information_requests.push(sibling)
    const beforeSibling = structuredClone(sibling)
    await resolveManualReplyReview({ companyId: CO, requestId: String(request.id), powerOfAttorneyId: 'poa-1', actorUserId: CO,
      note: 'Det senare avslaget har granskats och dokumenterats.' })
    expect(request).toMatchObject({ status: 'completed', parsed_payload: { applied: true, original_terms: 'preserved' },
      metadata: { counterparty_reply: { requires_review: false, inbound_id: 'late-denial', sourceHash: 'a'.repeat(64), reviewed_by: CO } } })
    expect(sibling).toEqual(beforeSibling)
    expect(db.tables.customer_sites[0].current_supplier_response_status).toBe('manual_review')
    expect(db.tables.manual_email_outbox).toHaveLength(1)
    expect(port.sends).toHaveLength(0)
  })

  it('keeps a newer completed-conversation hold when it arrives during review', async () => {
    await queueManualSupplierInformationRequest(input)
    const request = db.tables.grid_owner_information_requests[0]
    request.status = 'completed'
    request.metadata = { ...(request.metadata as Row), counterparty_reply: { requires_review: true, inbound_id: 'first-denial' } }
    const from = db.client.from
    db.client.from = (table) => {
      const query = from(table) as Record<string, unknown>
      if (table === 'grid_owner_information_requests') {
        const update = query.update as (patch: Row) => unknown
        query.update = (patch: Row) => {
          request.metadata = { ...(request.metadata as Row), counterparty_reply: { requires_review: true, inbound_id: 'newer-denial' } }
          request.updated_at = '2026-10-18T12:01:00Z'
          return update(patch)
        }
      }
      return query
    }
    await expect(resolveManualReplyReview({ companyId: CO, requestId: String(request.id), powerOfAttorneyId: 'poa-1', actorUserId: CO,
      note: 'Det första avslaget har kontrollerats.' })).rejects.toThrow('Ärendet ändrades samtidigt')
    expect(request).toMatchObject({ status: 'completed', metadata: { counterparty_reply: { requires_review: true, inbound_id: 'newer-denial' } } })
  })

  it('keeps completed noncommercial requests outside the new review transition', async () => {
    await queueManualSupplierInformationRequest(input)
    const request = db.tables.grid_owner_information_requests[0]
    request.status = 'completed'; request.request_type = 'facility_information_request'
    request.metadata = { ...(request.metadata as Row), counterparty_reply: { requires_review: true, inbound_id: 'facility-denial' } }
    await resolveManualReplyReview({ companyId: CO, requestId: String(request.id), powerOfAttorneyId: 'poa-1', actorUserId: CO,
      note: 'Separat handläggning krävs för detta ärende.' })
    expect(request).toMatchObject({ status: 'completed', metadata: { counterparty_reply: { requires_review: true } } })
  })
})

describe('purpose-aware supplier send guards', () => {
  it('rejects immutable POA scope changed while verified contacts are read', async () => {
    await queueManualSupplierInformationRequest(input)
    let changed = false
    afterContactRead(() => { changed = true; db.tables.powers_of_attorney[0].signed_scope_snapshot = ['facility_information_lookup'] })
    const context = await readManualSupplierSendContext({ companyId: CO, request: db.tables.grid_owner_information_requests[0] })
    expect(changed).toBe(true)
    expect(context).toBeNull()
  })

  it('rejects a scope grant revoked while verified contacts are read', async () => {
    await queueManualSupplierInformationRequest(input)
    afterContactRead(() => { db.tables.authorization_scopes[0].revoked_at = '2026-10-18T12:00:00Z' })
    expect(await readManualSupplierSendContext({ companyId: CO, request: db.tables.grid_owner_information_requests[0] })).toBeNull()
  })

  it('checks immutable coverage on the final POA read rather than only earlier authority', async () => {
    await queueManualSupplierInformationRequest(input)
    const from = db.client.from
    db.client.from = (table) => {
      const query = from(table)
      if (table !== 'powers_of_attorney') return query
      const one = query as { maybeSingle: () => Promise<unknown> }
      const maybeSingle = one.maybeSingle.bind(one)
      one.maybeSingle = () => {
        db.tables.powers_of_attorney[0].signed_scope_snapshot = ['facility_information_lookup']
        return maybeSingle()
      }
      return query
    }
    expect(await readManualSupplierSendContext({ companyId: CO, request: db.tables.grid_owner_information_requests[0] })).toBeNull()
  })

  it('preserves the existing scope-summary fallback only when immutable scopes are absent', async () => {
    db.tables.powers_of_attorney[0].signed_scope_snapshot = []
    db.tables.powers_of_attorney[0].scope_summary = { scopes: ['current_supplier_contract'] }
    expect((await queueManualSupplierInformationRequest(input)).status).toBe('queued')
    expect(await readManualSupplierSendContext({ companyId: CO, request: db.tables.grid_owner_information_requests[0] })).toBeTruthy()
  })

  it('also notices a grant revoked during the last direct POA read', async () => {
    await queueManualSupplierInformationRequest(input)
    const from = db.client.from
    db.client.from = (table) => {
      const query = from(table)
      if (table !== 'powers_of_attorney') return query
      const one = query as { maybeSingle: () => Promise<unknown> }
      const maybeSingle = one.maybeSingle.bind(one)
      one.maybeSingle = () => {
        db.tables.authorization_scopes[0].revoked_at = '2026-10-18T12:00:00Z'
        return maybeSingle()
      }
      return query
    }
    expect(await readManualSupplierSendContext({ companyId: CO, request: db.tables.grid_owner_information_requests[0] })).toBeNull()
  })

  it('blocks the actual provider when immutable authorization changes during worker contact IO', async () => {
    await queueManualSupplierInformationRequest(input)
    afterContactRead(() => { db.tables.powers_of_attorney[0].signed_scope_snapshot = ['facility_information_lookup'] })
    expect((await processManualEmailOutbox({ companyId: CO })).failed).toBe(1)
    expect(port.sends).toHaveLength(0)
  })

  it('does not queue a reminder after the scope grant is revoked during contact IO', async () => {
    await queueManualSupplierInformationRequest(input)
    Object.assign(db.tables.grid_owner_information_requests[0], { status: 'waiting_manual_response', sent_at: '2026-10-01T10:00:00Z', next_follow_up_at: '2026-10-10T06:00:00Z', follow_up_count: 0 })
    afterContactRead(() => { db.tables.authorization_scopes[0].revoked_at = '2026-10-18T12:00:00Z' })
    const result = await runManualGridOwnerFollowUpWatchdog()
    expect(result.needsReview).toBe(1)
    expect(result.reminders).toBe(0)
    expect(db.tables.manual_email_outbox).toHaveLength(1)
    expect(port.sends).toHaveLength(0)
  })

  it('finds only a verified actor contact for the exact site supplier', async () => {
    const contact = await findCurrentSupplierManualContact({ companyId: CO, customerId: 'customer-1', siteId: 'site-1' })
    expect(contact).toMatchObject({ email: 'fullmakt@supplier.example', supplierId: 'supplier-1', actorId: 'actor-1', contactChannelId: 'contact-1' })
  })

  it('rechecks exact scope/document linkage before a queued supplier message can send', async () => {
    await queueManualSupplierInformationRequest(input)
    const request = db.tables.grid_owner_information_requests[0]
    expect(await readManualSupplierSendContext({ companyId: CO, request })).toBeTruthy()
    db.tables.authorization_scopes[0].covers_current_supplier_contract = false
    expect(await readManualSupplierSendContext({ companyId: CO, request })).toBeNull()
  })

  it('sends via the real worker without reverting the verified facility status', async () => {
    await queueManualSupplierInformationRequest(input)
    const result = await processManualEmailOutbox({ companyId: CO })
    expect(result.sent).toBe(1)
    expect(port.sends[0].to).toBe('fullmakt@supplier.example')
    expect(db.tables.customer_sites[0].facility_data_status).toBe('facility_verified')
    expect(db.tables.grid_owner_information_requests[0].status).toBe('waiting_manual_response')
  })

  it('blocks the provider if the site supplier changes after queueing', async () => {
    await queueManualSupplierInformationRequest(input)
    db.tables.customer_sites[0].current_supplier_id = 'different-supplier'
    const result = await processManualEmailOutbox({ companyId: CO })
    expect(result.failed).toBe(1)
    expect(port.sends).toHaveLength(0)
  })

  it('accepts an exact verified supplier reply tied to the actual outgoing thread', async () => {
    await queueManualSupplierInformationRequest(input)
    const request = db.tables.grid_owner_information_requests[0]
    db.tables.manual_email_outbox[0].provider_message_id = 'outbound-1'
    const result = await resolveManualInboundCorrelation({ email: { fromEmail: 'fullmakt@supplier.example', inReplyTo: '<outbound-1>' }, caseReference: String(request.case_reference), normalizedText: 'Avtalsslut: 2027-03-31', extracted: { current_contract_end_date: '2027-03-31' } })
    expect(result.resolutionStatus).toBe('matched')
    expect(result.senderCredible).toBe(true)
    expect(result.companyId).toBe(CO)
    expect(result.customerId).toBe('customer-1')
  })

  it('does not confuse a supplier actor with a grid owner using the same support mailbox', async () => {
    await queueManualSupplierInformationRequest(input)
    const request = db.tables.grid_owner_information_requests[0]
    db.tables.customer_sites[0].grid_owner_id = 'actual-grid-owner'
    db.tables.grid_owner_contact_channels.push({ id: 'unrelated-owner-contact', grid_owner_id: 'supplier-associated-network-company', company_id: null, email: 'fullmakt@supplier.example', is_enabled: true, is_verified: true })
    db.tables.manual_email_outbox[0].provider_message_id = 'outbound-1'
    const result = await resolveManualInboundCorrelation({ email: { fromEmail: 'fullmakt@supplier.example', inReplyTo: '<outbound-1>' }, caseReference: String(request.case_reference), normalizedText: 'Avtalsslut: 2027-03-31', extracted: { current_contract_end_date: '2027-03-31' } })
    expect(result.resolutionStatus).toBe('matched')
    expect(result.senderCredible).toBe(true)
  })

  it('never treats a supplier case reference alone as a trusted reply thread', async () => {
    await queueManualSupplierInformationRequest(input)
    const request = db.tables.grid_owner_information_requests[0]
    const result = await resolveManualInboundCorrelation({ email: { fromEmail: 'fullmakt@supplier.example' }, caseReference: String(request.case_reference), normalizedText: 'Avtalsslut: 2027-03-31', extracted: { current_contract_end_date: '2027-03-31' } })
    expect(result.senderCredible).toBe(false)
  })

  it('stops a queued message when the conversation was moved to review', async () => {
    await queueManualSupplierInformationRequest(input)
    db.tables.grid_owner_information_requests[0].status = 'needs_review'
    const result = await processManualEmailOutbox({ companyId: CO })
    expect(result.failed).toBe(1)
    expect(port.sends).toHaveLength(0)
  })

  it('queues a supplier reminder to the same actor contact, never a grid owner', async () => {
    await queueManualSupplierInformationRequest(input)
    const request = db.tables.grid_owner_information_requests[0]
    Object.assign(request, { status: 'waiting_manual_response', sent_at: '2026-10-01T10:00:00Z', next_follow_up_at: '2026-10-10T06:00:00Z', follow_up_count: 1 })
    const result = await runManualGridOwnerFollowUpWatchdog()
    expect(result.escalations).toBe(1)
    expect(db.tables.manual_email_outbox).toHaveLength(2)
    expect(db.tables.manual_email_outbox[1].to_email).toBe('fullmakt@supplier.example')
    expect(String(db.tables.manual_email_outbox[1].body_text)).toContain('bindningstid')
    expect(String(db.tables.manual_email_outbox[1].body_text)).toContain('uppsägningstid')
  })

  it('follows up an applied partial reply by asking only for missing mandatory facts', async () => {
    await queueManualSupplierInformationRequest(input)
    const request = db.tables.grid_owner_information_requests[0]
    Object.assign(request, { status: 'manual_response_received', sent_at: '2026-10-01T10:00:00Z', next_follow_up_at: '2026-10-10T06:00:00Z', follow_up_count: 0,
      parsed_payload: { complete: false, responseStatus: 'waiting_response', sourceHash: 'partial-reply-1', missingFields: ['termination_fee'], terms: { earliestStartDate: '2027-01-01' } } })
    db.tables.customer_info_requests[0].status = 'partially_received'
    const result = await runManualGridOwnerFollowUpWatchdog()
    expect(result.reminders).toBe(1)
    const mail = db.tables.manual_email_outbox[1]
    expect(String(mail.body_text)).toContain('Tack för ert svar')
    expect(String(mail.body_text)).toContain('brytavgift')
    expect(String(mail.body_text)).not.toContain('bindningstid')
    expect(String(mail.body_text)).not.toContain('Vi har inte fått')
    expect((mail.recipient_resolution as Row).follow_up_reply_source_hash).toBe('partial-reply-1')
    expect(request.status).toBe('manual_response_received')
  })

  it('stops a queued partial reminder when a newer complete reply has arrived', async () => {
    await queueManualSupplierInformationRequest(input)
    const request = db.tables.grid_owner_information_requests[0]
    Object.assign(request, { status: 'manual_response_received', sent_at: '2026-10-01T10:00:00Z', next_follow_up_at: '2026-10-10T06:00:00Z', follow_up_count: 0,
      parsed_payload: { complete: false, responseStatus: 'waiting_response', sourceHash: 'partial-reply-1', missingFields: ['termination_fee'], terms: { earliestStartDate: '2027-01-01' } } })
    db.tables.customer_info_requests[0].status = 'partially_received'
    await runManualGridOwnerFollowUpWatchdog()
    expect(db.tables.manual_email_outbox).toHaveLength(2)
    db.tables.manual_email_outbox[0].status = 'sent'
    request.parsed_payload = { complete: true, sourceHash: 'complete-reply-2' }
    db.tables.customer_info_requests[0].status = 'ready_for_switch'
    const result = await processManualEmailOutbox({ companyId: CO })
    expect(result.failed).toBe(1)
    expect(port.sends).toHaveLength(0)
  })
})
