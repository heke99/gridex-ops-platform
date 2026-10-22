import { supabaseService } from '@/lib/supabase/service'
import { tenantSelect, tenantUpdate } from '@/lib/supabase/tenantQuery'
import { normalizeManualCommercialTerms } from '@/lib/inbound-mail/manualCommercialTerms'
import { reconcileSupplierSwitchAfterCustomerDataChange } from '@/lib/customer-operations/supplierSwitchOrchestration'
import type { ManualFacilityExtractedPayload, ManualFacilityParseResult } from '@/lib/customer-operations/manualFacilityResponseParser'
import { isDeepStrictEqual } from 'node:util'

type Row = Record<string, unknown>
function record(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {} }

export async function reviewManualReply(input: {
  companyId: string; request: Row; inboundId: string; extracted: ManualFacilityExtractedPayload; reasons: string[]
}): Promise<void> {
  if (input.request.company_id !== input.companyId) throw new Error('manual_reply_scope_mismatch')
  const metadata = record(input.request.metadata)
  const response = await tenantUpdate(input.companyId, 'grid_owner_information_requests', {
    status: 'manual_response_received', next_follow_up_at: null, received_at: new Date().toISOString(),
    parsed_payload: { ...input.extracted, applied: false, review_reason: 'commercial_terms_require_review',
      reasons: input.reasons, inbound_id: input.inboundId },
    last_error_code: input.reasons[0] ?? 'manual_reply_requires_review',
    last_error_message: 'Svaret är sparat. Automatisk tillämpning kräver verifierad avsändare, entydig kundkoppling och tydliga uppgifter.',
    updated_at: new Date().toISOString(),
  }).eq('id', String(input.request.id))
    .eq('metadata', JSON.stringify(metadata))
    .in('status', ['manual_email_queued', 'manual_email_sent', 'waiting_manual_response', 'manual_response_received'])
  if (response.error) throw response.error
}

export type ManualReplyContinuationInput = {
  inboundId: string; companyId: string; customerId: string; siteId: string; requestId: string; actorUserId?: string | null
  /** Internal batch continuation; callers still prove every stored binding. */
  memberOnly?: boolean
  allowPartial?: boolean
}

/** Shared by the normal post-commit path and retry; mutable site hints are not proof. */
export async function readAppliedManualReplyContext(input: ManualReplyContinuationInput): Promise<{
  payload: Row; automation: Row; application: Row; request: Row; actorUserId: string | null; sourceHash: string
  member?: Row; sourceRequestId: string; sourceSiteId: string
} | null> {
  const source = await tenantSelect(input.companyId, 'manual_inbound_messages')
    .eq('id', input.inboundId).eq('customer_id', input.customerId)
    .eq('processing_state', 'applied').eq('resolution_status', 'matched').maybeSingle()
  if (source.error) throw source.error
  if (!source.data) return null
  const payload = record(record(source.data).extracted_payload)
  const automation = record(payload.manual_automation)
  const sourceRow = record(source.data)
  const member = record(record(automation.site_applications)[input.requestId])
  const isMember = member.version === 1 && member.status === 'applied'
  const sourceRequestId = String(sourceRow.request_id ?? '')
  const sourceSiteId = String(sourceRow.customer_site_id ?? '')
  if (isMember) {
    if (member.parentRequestId !== sourceRequestId || member.requestId !== input.requestId
      || member.companyId !== input.companyId || member.customerId !== input.customerId || member.siteId !== input.siteId
      || member.sourceHash !== automation.sourceHash) return null
    const parent = await tenantSelect(input.companyId, 'grid_owner_information_requests')
      .eq('id', sourceRequestId).eq('customer_id', input.customerId).eq('customer_site_id', sourceSiteId).maybeSingle()
    if (parent.error) throw parent.error
    const parentRow = record(parent.data)
    if (!parent.data || record(record(parentRow.metadata).counterparty_reply).requires_review === true
      || ['cancelled', 'failed', 'closed', 'needs_review'].includes(String(parentRow.status))) return null
  } else if (sourceRequestId !== input.requestId || sourceSiteId !== input.siteId) return null
  const application = record(isMember ? member.application : automation.application)
  const sourceHash = automation.sourceHash
  if (payload.sender_credible !== true || record(payload.sender_verification).status !== 'verified'
    || typeof sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(sourceHash)
    || application.version !== 1 || application.applied !== true || application.sourceHash !== sourceHash
    || application.inboundId !== input.inboundId || application.inbound_id !== input.inboundId
    || application.companyId !== input.companyId || application.customerId !== input.customerId
    || application.siteId !== input.siteId || application.requestId !== input.requestId) return null
  const found = await tenantSelect(input.companyId, 'grid_owner_information_requests')
    .eq('id', input.requestId).eq('customer_id', input.customerId)
    .eq('customer_site_id', input.siteId).maybeSingle()
  if (found.error) throw found.error
  const request = record(found.data)
  const hold = record(record(request.metadata).counterparty_reply)
  if (request.id !== input.requestId || request.company_id !== input.companyId || request.customer_id !== input.customerId
    || request.customer_site_id !== input.siteId
    || (request.status !== 'completed' && !(input.allowPartial && isMember && application.complete === false
      && ['received', 'manual_response_received', 'ready_to_send_manual_email', 'manual_email_queued', 'manual_email_sent', 'waiting_manual_response'].includes(String(request.status))))
    || (isMember && (member.powerOfAttorneyId !== request.poa_id || member.requestType !== request.request_type))
    || hold.requires_review === true || hold.hold === true || !isDeepStrictEqual(request.parsed_payload, application)) return null
  return { payload, automation, application, request, actorUserId: typeof request.created_by === 'string' ? request.created_by : null, sourceHash,
    ...(isMember ? { member } : {}), sourceRequestId, sourceSiteId }
}

/** Mark only the sibling continuation, preserving the committed application and paid reading. */
export async function markManualReplyContinuation(input: ManualReplyContinuationInput & { supplierSwitchRequestId?: string | null }): Promise<void> {
  await writeManualReplyContinuation(input, 'completed')
}

/** Store safe review metadata; never persist downstream error text. */
export async function markManualReplyContinuationFailed(input: ManualReplyContinuationInput): Promise<void> {
  await writeManualReplyContinuation(input, 'failed')
}

async function writeManualReplyContinuation(input: ManualReplyContinuationInput & { supplierSwitchRequestId?: string | null }, status: 'completed' | 'failed'): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const context = await readAppliedManualReplyContext(input)
    if (!context) { if (status === 'failed') return; throw new Error('manual_reply_continuation_context_changed') }
    if (record(context.member ? context.member.continuation : context.automation.continuation).status === 'completed') return
    const continuation = { status, sourceHash: context.sourceHash, inboundId: input.inboundId, requestId: input.requestId,
      ...(context.member ? { parentRequestId: context.sourceRequestId } : {}),
      ...(status === 'completed' ? { completedAt: new Date().toISOString(), supplierSwitchRequestId: input.supplierSwitchRequestId ?? null }
        : { failedAt: new Date().toISOString(), reason: 'continuation_failed' }) }
    const automation = context.member ? { ...context.automation, ...(status === 'failed' ? { continuation } : {}), site_applications: {
      ...record(context.automation.site_applications), [input.requestId]: { ...context.member, continuation },
    } } : { ...context.automation, continuation }
    const updated = await tenantUpdate(input.companyId, 'manual_inbound_messages', { extracted_payload: {
      ...context.payload, manual_automation: automation,
    } }).eq('id', input.inboundId).eq('customer_id', input.customerId)
      .eq('customer_site_id', context.sourceSiteId).eq('request_id', context.sourceRequestId).eq('processing_state', 'applied')
      .eq('extracted_payload', JSON.stringify(context.payload)).select('id').maybeSingle()
    if (updated.error) throw updated.error
    if (updated.data) return
  }
  throw new Error('manual_reply_continuation_changed')
}

/** Resume either applied mail adapter without a new inference or noncanonical data write. */
export async function continueManualCommercialReply(input: ManualReplyContinuationInput): Promise<void> {
  try { await continueManualCommercialReplyAttempt(input) }
  catch (error) {
    try { await markManualReplyContinuationFailed(input) } catch { /* Preserve the original failure and its canonical retry. */ }
    throw error
  }
}

async function continueManualCommercialReplyAttempt(input: ManualReplyContinuationInput): Promise<void> {
  if (!input.memberOnly) {
    const source = await tenantSelect(input.companyId, 'manual_inbound_messages').eq('id', input.inboundId)
      .eq('customer_id', input.customerId).eq('request_id', input.requestId).eq('processing_state', 'applied').maybeSingle()
    if (source.error) throw source.error
    if (record(record(record(source.data).extracted_payload).manual_automation).multi_site) {
      const { continueManualMultiSiteReply } = await import('@/lib/inbound-mail/manualMultiSiteReply')
      await continueManualMultiSiteReply({ companyId: input.companyId, customerId: input.customerId,
        parentRequestId: input.requestId, inboundId: input.inboundId })
      return
    }
  }
  const context = await readAppliedManualReplyContext(input)
  if (!context || record(context.member ? context.member.continuation : context.automation.continuation).status === 'completed') return
  if (context.request.request_type !== 'current_supplier_contract_information_request') {
    const result = record(context.application.result)
    if (!['facility_identifier_lookup', 'facility_lookup'].includes(String(context.request.request_type)) || result.ok !== true
      || result.requestId !== input.requestId || result.customerId !== input.customerId || result.customerSiteId !== input.siteId) return
    const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
    const { completeFacilityLookupAndRunNextSteps } = await import('@/lib/customer-operations/facilityResponseOrchestrator')
    const completion = await completeFacilityLookupAndRunNextSteps({
      companyId: input.companyId, requestId: input.requestId, actorUserId: context.actorUserId, source: 'system',
      facilityId: text(result.facilityId), meteringPointId: text(result.meteringPointExternalId),
      gridAreaCode: text(result.gridAreaCode) ?? text(context.request.grid_area_code),
      priceAreaCode: text(result.priceAreaCode) ?? text(context.request.price_area),
      sourcePartyGridOwnerId: text(context.request.grid_owner_id), rawPayload: record(context.request.received_payload),
      automaticInbound: { inboundId: input.inboundId, sourceHash: context.sourceHash },
    })
    if (!completion.ok) throw new Error('manual_facility_continuation_failed')
    await markManualReplyContinuation({ ...input, supplierSwitchRequestId: completion.supplierSwitchResult?.supplierSwitchRequestId ?? null })
    return
  }
  if (context.application.complete !== true) return
  const result = await reconcileSupplierSwitchAfterCustomerDataChange({
    companyId: input.companyId, customerId: input.customerId, siteId: input.siteId,
    actorUserId: context.actorUserId, source: 'manual_supplier_information_received',
  })
  await markManualReplyContinuation({ ...input, supplierSwitchRequestId: result?.supplierSwitchRequestId ?? null })
}

export async function applyManualCommercialReply(input: {
  companyId: string; customerId: string; siteId: string; request: Row; inboundId: string;
  extracted: ManualFacilityExtractedPayload; authoredText: string; receivedAt: string; receivedAtSource?: 'imap_internal_date'; sourceHash: string;
}): Promise<ManualFacilityParseResult> {
  const normalized = normalizeManualCommercialTerms(input)
  if (!normalized.ok) {
    await reviewManualReply({ ...input, reasons: normalized.reasons })
    return { outcome: 'needs_review', confidence: 0, extracted: input.extracted, reasons: normalized.reasons }
  }
  const { followUpDueAt } = await import('@/lib/customer-operations/manualGridOwnerFollowUps')
  const nextFollowUpAt = (await followUpDueAt(new Date(input.receivedAt), 5)).toISOString()
  const { data, error } = await supabaseService.rpc('gridex_apply_manual_commercial_reply_v1', {
    p_company_id: input.companyId, p_request_id: String(input.request.id), p_inbound_id: input.inboundId,
    p_payload: { sourceHash: input.sourceHash, terms: normalized.terms, evidence: normalized.evidence, extracted: input.extracted, nextFollowUpAt },
  })
  if (error) throw new Error(`manual_reply_application_failed:${error.code ?? 'unknown'}`)
  const result = record(data)
  if (result.ok !== true || result.applied !== true || result.customerId !== input.customerId || result.customerSiteId !== input.siteId) {
    const reasons = [typeof result.code === 'string' ? result.code : 'manual_reply_application_invalid_result']
    await reviewManualReply({ ...input, reasons })
    return { outcome: 'needs_review', confidence: 0, extracted: input.extracted, reasons }
  }
  if (result.complete === true) {
    await continueManualCommercialReply({ inboundId: input.inboundId, companyId: input.companyId,
      customerId: input.customerId, siteId: input.siteId, requestId: String(input.request.id),
      actorUserId: typeof input.request.created_by === 'string' ? input.request.created_by : null })
  }
  return { outcome: 'applied', confidence: 1, extracted: input.extracted, reasons: [],
    nextStepDecision: result.complete === true ? 'supplier_terms_complete' : 'supplier_terms_partially_received' }
}
