import { tenantDb } from '@/lib/supabase/tenantDb'
import { tenantSelect, tenantUpdate, tenantInsert } from '@/lib/supabase/tenantQuery'
import { createHash, randomUUID } from 'node:crypto'
import { assertOutboundAllowed } from '@/lib/platform/outboundFreeze'
import { resolveCurrentInfoRequestScopeAuthorization } from '@/lib/onboarding/infoRequestAuthorization'
import { findCurrentSupplierManualContact, readManualSupplierSendContext, MANUAL_SUPPLIER_INFORMATION_REQUEST_TYPE } from './manualGridOwnerSendGuards'
import { hasExternallySendablePoa } from '@/lib/customers/poaReadiness'
import { ensurePoaVerificationReference } from '@/lib/customers/poaEvidenceCompletion'
import { ensurePoaPdfArchive } from '@/lib/customers/poaDocuments'
import { poaMailEvidence, poaMailEvidenceFingerprint, poaMailEvidenceIssues } from '@/lib/email/poaMailEvidence'
import { resolveManualOperationsMailbox } from '@/lib/email/manualOperationsMailbox'
import { resolveManualRecipient } from './requestMissingFacilityInformationCore'
import { renderManualEmailTemplate } from '@/lib/email/manualGridOwnerTemplates'

type Row = Record<string, unknown>
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const clean = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const OPEN = ['draft', 'ready_to_send', 'ready_to_send_manual_email', 'manual_email_queued', 'manual_email_sent', 'waiting_manual_response', 'manual_response_received', 'needs_review']

function resolvedReview(request: Row): { key: string; at: number } | null {
  const reply = record(record(request.metadata).counterparty_reply)
  if (reply.requires_review !== false) return null
  const reviewedAt = clean(reply.reviewed_at)
  const replacedAt = clean(reply.resolved_at)
  const reviewed = reviewedAt && clean(reply.reviewed_by) && (clean(reply.resolution_note)?.length ?? 0) >= 8
  const replaced = replacedAt && reply.resolved_with_poa_id === request.poa_id && clean(reply.poa_id) && reply.poa_id !== request.poa_id
  const resolvedAt = reviewed ? reviewedAt : replaced ? replacedAt : null
  const at = resolvedAt ? Date.parse(resolvedAt) : NaN
  if (!resolvedAt || !Number.isFinite(at) || at > Date.now()) return null
  const key = createHash('sha256').update(JSON.stringify({ inboundId: clean(reply.inbound_id) ?? 'legacy', resolvedAt,
    poaId: request.poa_id, reviewedBy: reviewed ? reply.reviewed_by : null })).digest('hex').slice(0, 32)
  return { key, at }
}

export type ManualSupplierInformationRequestResult = {
  status: 'queued' | 'waiting_response' | 'needs_review'; requestId: string | null; caseReference: string | null
  emailOutboxId: string | null; blockerCode: string | null; blockerReason: string | null
}

/** Queues only; the shared outbox worker performs and audits provider delivery. */
export async function queueManualSupplierInformationRequest(input: {
  companyId: string; customerId: string; siteId: string; customerInfoRequestId: string; actorUserId?: string | null
}): Promise<ManualSupplierInformationRequestResult> {
  let request: Row | null = null
  const result = (status: ManualSupplierInformationRequestResult['status'], blockerCode: string | null = null, blockerReason: string | null = null, outboxId: string | null = null): ManualSupplierInformationRequestResult => ({
    status, requestId: clean(request?.id), caseReference: clean(request?.case_reference), emailOutboxId: outboxId, blockerCode, blockerReason,
  })
  const cirResult = await tenantSelect(input.companyId, 'customer_info_requests', '*')
    .eq('company_id', input.companyId).eq('customer_id', input.customerId).eq('site_id', input.siteId).eq('id', input.customerInfoRequestId).maybeSingle()
  if (cirResult.error) throw cirResult.error
  const cir = cirResult.data as (Row & Parameters<typeof resolveCurrentInfoRequestScopeAuthorization>[0]) | null
  if (!cir || cir.target_party_type !== 'current_supplier' || ['cancelled', 'rejected', 'received', 'completed', 'ready_for_switch'].includes(String(cir.status))) {
    return result('needs_review', 'supplier_information_request_invalid', 'En aktuell kund- och anläggningsbunden handelsförfrågan saknas.')
  }
  const cirPayload = record(cir.verified_payload)
  const fail = async (code: string, message: string): Promise<ManualSupplierInformationRequestResult> => {
    const updated = await tenantUpdate(input.companyId, 'customer_info_requests', { status: 'manual_review_required', blocker_code: code, blocker_reason: message,
      updated_by: input.actorUserId ?? null, updated_at: new Date().toISOString() })
      .eq('company_id', input.companyId).eq('customer_id', input.customerId).eq('id', input.customerInfoRequestId)
      .eq('status', String(cir.status)).eq('verified_payload', JSON.stringify(cirPayload)).select('id')
    if (updated.error) throw updated.error
    return result('needs_review', code, message)
  }
  const [siteResult, customerResult, companyResult, contact, authority] = await Promise.all([
    tenantSelect(input.companyId, 'customer_sites', '*').eq('company_id', input.companyId).eq('customer_id', input.customerId).eq('id', input.siteId).maybeSingle(),
    tenantSelect(input.companyId, 'customers', '*').eq('company_id', input.companyId).eq('id', input.customerId).maybeSingle(),
    tenantDb(input.companyId).unscoped().from('companies').select('*').eq('id', input.companyId).maybeSingle(),
    findCurrentSupplierManualContact(input),
    resolveCurrentInfoRequestScopeAuthorization(cir),
  ])
  for (const response of [siteResult, customerResult, companyResult]) if (response.error) throw response.error
  const site = siteResult.data as Row | null, customer = customerResult.data as Row | null, company = companyResult.data as Row | null
  if (!site || !customer || site.protected_identity === true || customer.protected_identity === true) return fail('supplier_customer_context_invalid', 'Kundens anläggning saknas eller kräver skyddad handläggning.')
  if (!contact) return fail('supplier_contact_not_verified', 'Nuvarande elhandlare saknar entydig, giltig och verifierad kontaktväg för fullmaktsärenden.')
  const documentId = clean(cir.authorization_document_id) ?? authority.supplierDocumentId
  if (!documentId || !authority.scopes.some((scope) => scope.authorization_document_id === documentId && scope.covers_current_supplier_contract)) {
    return fail('supplier_contract_authorization_missing', 'Giltig fullmakt med uttrycklig behörighet för nuvarande elhandelsavtal saknas.')
  }
  const doc = await tenantSelect(input.companyId, 'customer_authorization_documents', 'id,power_of_attorney_id')
    .eq('company_id', input.companyId).eq('customer_id', input.customerId).eq('site_id', input.siteId).eq('id', documentId).maybeSingle()
  if (doc.error) throw doc.error
  const document = record(doc.data)
  if (!document.power_of_attorney_id) return fail('supplier_contract_poa_missing', 'Handelsförfrågan saknar en dokumentbunden fullmakt.')
  if (!cir.authorization_document_id) {
    const bound = await tenantUpdate(input.companyId, 'customer_info_requests', { authorization_document_id: documentId, updated_at: new Date().toISOString() })
      .eq('company_id', input.companyId).eq('id', input.customerInfoRequestId).is('authorization_document_id', null).eq('status', String(cir.status)).select('id').maybeSingle()
    if (bound.error) throw bound.error
    if (!bound.data) return result('needs_review', 'supplier_authorization_changed', 'Behörighetsunderlaget ändrades samtidigt. Läs om ärendet.')
    cir.authorization_document_id = documentId
  }
  const mailbox = await resolveManualOperationsMailbox({ companyId: input.companyId, channelType: 'supplier_switch_manual' })
  if (!mailbox) return fail('manual_mailbox_required', 'Verifierad avsändarbrevlåda för manuella handelsförfrågningar saknas.')
  await assertOutboundAllowed({ companyId: input.companyId, channel: 'manual_email' })
  const recipient = { ...resolveManualRecipient(contact), contact_source_table: 'platform_actor_contacts', actual_supplier_contact_email: contact.email, resolution_mode: 'real_current_supplier_contact' }
  if (!recipient.externally_sendable) return fail('supplier_environment_not_sendable', 'Miljön eller säker mottagarinställning tillåter inte extern handelsförfrågan.')
  if (!clean(company?.org_number)) return fail('tenant_organization_number_missing', 'Ombudets organisationsnummer saknas.')

  const existing = await tenantSelect(input.companyId, 'grid_owner_information_requests', '*')
    .eq('company_id', input.companyId).eq('customer_id', input.customerId).eq('customer_site_id', input.siteId)
    .eq('request_type', MANUAL_SUPPLIER_INFORMATION_REQUEST_TYPE).in('status', OPEN).maybeSingle()
  if (existing.error) throw existing.error
  request = existing.data as Row | null
  const routeMetadata = { target_party: 'current_supplier', customer_info_request_id: input.customerInfoRequestId, supplier_id: contact.supplierId,
    supplier_actor_id: contact.actorId, supplier_contact_id: contact.contactChannelId, authorization_document_id: documentId, channel_type: 'supplier_switch_manual' }
  if (request && (record(request.metadata).customer_info_request_id !== input.customerInfoRequestId
    || record(record(request.metadata).counterparty_reply).requires_review === true)) return fail('supplier_conversation_requires_review', 'En annan eller blockerad handelsförfrågan finns redan för anläggningen.')
  if (!request) {
    const id = randomUUID(), now = new Date().toISOString()
    const created = await tenantInsert(input.companyId, 'grid_owner_information_requests', { id, company_id: input.companyId, customer_id: input.customerId,
      customer_site_id: input.siteId, grid_owner_id: null, request_type: MANUAL_SUPPLIER_INFORMATION_REQUEST_TYPE,
      channel: 'manual_email', status: 'ready_to_send_manual_email', case_reference: `GX-FIR-${id.replaceAll('-', '').toUpperCase()}`,
      poa_id: document.power_of_attorney_id, requires_poa: true, recipient_email: contact.email,
      recipient_contact_channel_id: null, from_email: mailbox.fromEmail, reply_to: mailbox.replyToEmail ?? mailbox.fromEmail,
      site_address_hash: clean(site.address_hash), requested_fields: ['contract_status', 'current_contract_end_date', 'binding_period', 'notice_period', 'earliest_supplier_start_date', 'cancellation_deadline', 'cancellation_registered', 'termination_fee'],
      metadata: routeMetadata, created_by: input.actorUserId ?? null, updated_by: input.actorUserId ?? null, updated_at: now,
    }).select('*').maybeSingle()
    if (created.error) {
      if (String(created.error.code) !== '23505') throw created.error
      return result('needs_review', 'supplier_conversation_created_concurrently', 'En handelsförfrågan skapades samtidigt. Läs om ärendet innan återköning.')
    }
    request = created.data as Row | null
  }
  if (!request) throw new Error('Handelsförfrågan kunde inte skapas.')
  let context = await readManualSupplierSendContext({ companyId: input.companyId, request })
  if (!context) return fail('supplier_authority_or_route_changed', 'Handelsförfrågans behörighet eller verifierade mottagare har ändrats.')
  let poa = await ensurePoaVerificationReference({ companyId: input.companyId, customerId: input.customerId, powerOfAttorneyId: String(context.poa.id) })
  if (!hasExternallySendablePoa(poa, { customerIdentity: clean(customer.personal_number) ?? clean(customer.org_number) }) || poaMailEvidenceIssues(poa).length) {
    return fail('poa_not_externally_sendable', 'Fullmakten saknar verifierbart signeringsunderlag för extern leverans.')
  }
  const oldOutbox = await tenantSelect(input.companyId, 'manual_email_outbox', 'id,status,sent_at,idempotency_key,recipient_resolution,attachments')
    .eq('company_id', input.companyId).eq('request_id', String(request.id)).order('created_at', { ascending: false })
  if (oldOutbox.error) throw oldOutbox.error
  const rows = (oldOutbox.data ?? []) as Row[]
  const review = resolvedReview(request)
  const baseIdempotencyKey = `manual-supplier-information:${input.companyId}:${request.id}`
  const idempotencyKey = review ? `${baseIdempotencyKey}:review:${review.key}` : baseIdempotencyKey
  if (rows.some((row) => row.status === 'delivery_uncertain')) return fail('supplier_previous_delivery_requires_review', 'Ett tidigare handelsutskick har oklar leverans och måste kontrolleras före nytt försök.')
  const sameAttempt = rows.find((row) => row.idempotency_key === idempotencyKey)
  if (sameAttempt) {
    if (['queued', 'sending', 'sent'].includes(String(sameAttempt.status))) return result(sameAttempt.status === 'sent' ? 'waiting_response' : 'queued', null, null, String(sameAttempt.id))
    return fail('supplier_previous_delivery_requires_review', 'Det granskade utskicket har redan behandlats och kräver ny handläggning före nytt försök.')
  }
  if (rows.length) {
    if (!review || request.status !== 'ready_to_send_manual_email') {
      const sent = rows.find((row) => row.status === 'sent')
      return sent ? result('waiting_response', null, null, String(sent.id))
        : fail('supplier_previous_delivery_requires_review', 'Ett tidigare handelsutskick kräver en uttryckligt godkänd granskning före nytt försök.')
    }
    if (rows.some((row) => row.status === 'sending')) return fail('supplier_previous_delivery_requires_review', 'Ett tidigare handelsutskick behandlas fortfarande. Kontrollera leveransen före omsändning.')
    if (rows.some((row) => row.status === 'sent' && (!clean(row.sent_at) || !Number.isFinite(Date.parse(String(row.sent_at))) || Date.parse(String(row.sent_at)) >= review.at))) {
      return fail('supplier_review_not_newer_than_delivery', 'Granskningen är inte verifierat senare än det senaste levererade utskicket.')
    }
  }
  const initialMetadata = JSON.stringify(record(request.metadata))
  const initialStatus = String(request.status)
  const preArchiveFingerprint = poaMailEvidenceFingerprint(poa)
  let archive: Awaited<ReturnType<typeof ensurePoaPdfArchive>>
  try { archive = await ensurePoaPdfArchive({ companyId: input.companyId, customerId: input.customerId, powerOfAttorneyId: String(poa.id) }) }
  catch { return fail('poa_document_archive_required', 'Fullmaktens godkända original kunde inte verifieras och arkiveras.') }
  const freshRequest = await tenantSelect(input.companyId, 'grid_owner_information_requests', '*')
    .eq('company_id', input.companyId).eq('id', String(request.id)).eq('poa_id', String(request.poa_id))
    .eq('status', initialStatus).eq('metadata', initialMetadata).maybeSingle()
  if (freshRequest.error) throw freshRequest.error
  if (!freshRequest.data) return fail('supplier_conversation_changed', 'Handelsärendet ändrades under dokumenthanteringen. Utskicket stoppades.')
  request = freshRequest.data as Row
  context = await readManualSupplierSendContext({ companyId: input.companyId, request })
  if (!context) return fail('supplier_authority_or_route_changed', 'Behörighet eller mottagare ändrades under dokumenthanteringen.')
  poa = context.poa
  const archivedProof = record(record(poa.metadata).document_archive)
  if (poaMailEvidenceFingerprint(poa) !== preArchiveFingerprint || archivedProof.evidence_sha256 !== preArchiveFingerprint
    || poa.document_path !== archive.path || archivedProof.path !== archive.path
    || archivedProof.sha256 !== createHash('sha256').update(archive.pdf).digest('hex')) {
    return fail('poa_document_evidence_changed', 'Fullmaktens dokument och godkännandeverifikat hör inte längre till samma oförändrade underlag. Kontrollera originalet före utskick.')
  }
  // A new reviewed attempt replaces only still-queued older attempts. In-flight
  // or uncertain deliveries were blocked above and are never silently retried.
  for (const row of rows.filter((entry) => entry.status === 'queued')) {
    const attachments = Array.isArray(row.attachments) ? row.attachments as Row[] : []
    const stopped = await tenantUpdate(input.companyId, 'manual_email_outbox', { status: 'failed', last_error_code: 'superseded_by_reviewed_supplier_attempt', next_attempt_at: null,
      attachments: attachments.map((attachment) => { const audit = { ...attachment }; delete audit.content; return audit }) })
      .eq('company_id', input.companyId).eq('id', String(row.id)).eq('status', 'queued').select('id').maybeSingle()
    if (stopped.error) throw stopped.error
    if (!stopped.data) return fail('supplier_previous_delivery_requires_review', 'Det tidigare utskicket ändrades samtidigt och kan redan behandlas.')
  }
  const rendered = renderManualEmailTemplate('current_supplier_contract_information_request', {
    case_reference: String(request.case_reference), customer_number: clean(customer.customer_number),
    customer_name: clean(customer.company_name) ?? clean(customer.full_name) ?? [clean(customer.first_name), clean(customer.last_name)].filter(Boolean).join(' '),
    customer_identity: clean(customer.personal_number) ?? clean(customer.org_number), site_address: clean(site.street), postal_code: clean(site.postal_code), city: clean(site.city),
    tenant_company_name: clean(company?.legal_name) ?? clean(company?.name), tenant_organization_number: clean(company?.org_number),
    ops_sender_name: clean(process.env.MANUAL_GRID_OWNER_SENDER_NAME) ?? 'Gridex Operations', poa_reference: clean(poa.reference) ?? String(poa.id),
    poa_verification_number: poaMailEvidence(poa).verificationReference,
  })
  const linked = await tenantUpdate(input.companyId, 'customer_info_requests', { status: 'ready_to_send', authorization_document_id: documentId,
    verified_payload: { ...cirPayload, manual_supplier_request_id: request.id, supplier_id: contact.supplierId, supplier_actor_id: contact.actorId, supplier_contact_id: contact.contactChannelId },
    blocker_code: null, blocker_reason: null, requested_at: new Date().toISOString(), updated_by: input.actorUserId ?? null, updated_at: new Date().toISOString() })
    .eq('company_id', input.companyId).eq('id', input.customerInfoRequestId).eq('status', String(cir.status)).eq('verified_payload', JSON.stringify(cirPayload)).select('id').maybeSingle()
  if (linked.error) throw linked.error
  if (!linked.data) return result('needs_review', 'supplier_information_request_changed', 'Kundens uppgiftsbegäran ändrades samtidigt.')
  const queued = await tenantInsert(input.companyId, 'manual_email_outbox', { company_id: input.companyId, request_id: request.id,
    to_email: context.contact.email, actual_recipient_email: context.contact.email, from_email: mailbox.fromEmail, reply_to: mailbox.replyToEmail ?? mailbox.fromEmail,
    subject: rendered.subject, body_html: rendered.bodyHtml, body_text: rendered.bodyText,
    attachments: [{ filename: `fullmakt-${request.case_reference}.pdf`, content: archive.pdf.toString('base64'), contentType: 'application/pdf', kind: 'power_of_attorney_archived_pdf', poa_id: poa.id, poa_document_path: archive.path, poa_evidence_fingerprint: poaMailEvidenceFingerprint(poa) }],
    status: 'queued', provider: 'resend', idempotency_key: idempotencyKey, provider_idempotency_key: idempotencyKey, external_delivery: true,
    next_attempt_at: new Date().toISOString(), queued_at: new Date().toISOString(), recipient_resolution: { ...recipient, supplier_id: contact.supplierId, supplier_actor_id: contact.actorId, supplier_contact_id: contact.contactChannelId, contact_channel_type: 'supplier_switch_manual',
      ...(review ? { review_resolution_key: review.key } : {}) },
  }).select('id').maybeSingle()
  if (queued.error) {
    if (String(queued.error.code) === '23505') {
      const winner = await tenantSelect(input.companyId, 'manual_email_outbox', 'id,status').eq('company_id', input.companyId).eq('idempotency_key', idempotencyKey).maybeSingle()
      if (winner.error) throw winner.error
      const winnerRow = record(winner.data)
      return winner.data && ['queued', 'sending', 'sent'].includes(String(winnerRow.status))
        ? result(winnerRow.status === 'sent' ? 'waiting_response' : 'queued', null, null, String(winnerRow.id))
        : result('needs_review', 'supplier_queue_race_requires_review', 'Det samtidiga utskicket kräver granskning.')
    }
    throw queued.error
  }
  const advanced = await tenantUpdate(input.companyId, 'grid_owner_information_requests', { status: 'manual_email_queued', ...(review ? { follow_up_count: 0, next_follow_up_at: null } : {}), updated_at: new Date().toISOString() })
    .eq('company_id', input.companyId).eq('id', String(request.id)).eq('metadata', JSON.stringify(record(request.metadata)))
    .in('status', ['draft', 'ready_to_send', 'ready_to_send_manual_email']).select('id').maybeSingle()
  if (advanced.error) throw advanced.error
  if (!advanced.data) {
    const stopped = await tenantUpdate(input.companyId, 'manual_email_outbox', { status: 'failed', last_error_code: 'supplier_conversation_changed', attachments: [], next_attempt_at: null })
      .eq('company_id', input.companyId).eq('id', String(queued.data?.id)).eq('status', 'queued').select('id')
    if (stopped.error) throw stopped.error
    return result('needs_review', 'supplier_conversation_changed', 'Handelsärendet ändrades samtidigt; utskicket stoppades.')
  }
  return result('queued', null, null, clean(queued.data?.id))
}
