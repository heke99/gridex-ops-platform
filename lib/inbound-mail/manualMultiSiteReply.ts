import { supabaseService } from '@/lib/supabase/service'
import { tenantSelect, tenantUpdate } from '@/lib/supabase/tenantQuery'
import { normalizeManualCommercialTerms } from '@/lib/inbound-mail/manualCommercialTerms'
import { normalizeManualFacilityFacts } from '@/lib/inbound-mail/manualFacilityFacts'
import { continueManualCommercialReply, markManualReplyContinuation, markManualReplyContinuationFailed, manualReplyReviewCodes, readAppliedManualReplyContext } from '@/lib/inbound-mail/manualReplyApplication'
import type { ManualFacilityExtractedPayload } from '@/lib/customer-operations/manualFacilityResponseParser'

type Row = Record<string, unknown>
function record(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {} }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }

export type ManualMultiSiteGroup = {
  facilityId: string
  meteringPointId?: string | null
  requestId?: string | null
  extracted: ManualFacilityExtractedPayload
  authoredText: string
  evidence?: Record<string, unknown>
  reasons?: string[]
}
export type ManualMultiSiteResult = {
  outcome: 'applied' | 'needs_review'
  appliedCount: number
  reviewCount: number
  results: Array<{ facilityId: string; siteId?: string; requestId?: string; outcome: 'applied' | 'needs_review'; reason?: string }>
}
export type ManualMultiSiteContinuation = { companyId: string; customerId: string; parentRequestId: string; inboundId: string }

/** Pure per-site normalization followed by one source-locked database command. */
export async function applyManualMultiSiteReply(input: {
  companyId: string; customerId: string; parentRequest: Row; inboundId: string; sourceHash: string; receivedAt: string; receivedAtSource?: 'imap_internal_date'
  groups: ManualMultiSiteGroup[]
}): Promise<ManualMultiSiteResult> {
  const parentRequestId = text(input.parentRequest.id)
  if (!parentRequestId || input.parentRequest.company_id !== input.companyId || input.parentRequest.customer_id !== input.customerId
    || !/^[a-f0-9]{64}$/.test(input.sourceHash) || input.groups.length < 1 || input.groups.length > 64) throw new Error('manual_multi_site_scope_invalid')
  const commercial = input.parentRequest.request_type === 'current_supplier_contract_information_request'
  const { followUpDueAt } = await import('@/lib/customer-operations/manualGridOwnerFollowUps')
  const nextFollowUpAt = commercial ? (await followUpDueAt(new Date(input.receivedAt), 5)).toISOString() : undefined
  const items = input.groups.map(group => {
    const reasons = [...(group.reasons ?? [])]
    if (!/^\d{18}$/.test(group.facilityId)) reasons.push('facility_id_invalid')
    if (group.extracted.facility_id && group.extracted.facility_id !== group.facilityId) reasons.push('facility_id_conflict')
    if (group.meteringPointId && group.extracted.metering_point_id && group.meteringPointId !== group.extracted.metering_point_id) reasons.push('metering_point_id_conflict')
    const extracted = { ...group.extracted, facility_id: group.facilityId,
      ...(group.meteringPointId ? { metering_point_id: group.meteringPointId } : {}) }
    let payload: Row
    if (commercial) {
      const normalized = normalizeManualCommercialTerms({ extracted, authoredText: group.authoredText,
        receivedAt: input.receivedAt, receivedAtSource: input.receivedAtSource })
      reasons.push(...normalized.reasons)
      payload = { terms: normalized.terms, evidence: normalized.evidence, extracted, nextFollowUpAt }
    } else {
      const normalized = normalizeManualFacilityFacts({ extracted, authoredText: group.authoredText })
      reasons.push(...normalized.reasons)
      payload = { facility_id: group.facilityId, metering_point_id: extracted.metering_point_id ?? null,
        grid_area_code: extracted.grid_area_code ?? null, price_area_code: extracted.price_area_code ?? null,
        facts: normalized.facts, extracted, raw_payload: { site_evidence: group.evidence ?? {}, authored_text: group.authoredText } }
    }
    return { facilityId: group.facilityId, ...(group.requestId ? { requestId: group.requestId } : {}), payload, reasons: [...new Set(reasons)] }
  })
  const { data, error } = await supabaseService.rpc('gridex_apply_manual_multi_site_reply_v1', {
    p_company_id: input.companyId, p_parent_request_id: parentRequestId, p_inbound_id: input.inboundId,
    p_payload: { sourceHash: input.sourceHash, items },
  })
  if (error) throw new Error(`manual_multi_site_application_failed:${error.code ?? 'unknown'}`)
  const result = record(data)
  if (result.ok !== true || !Array.isArray(result.results)) {
    return { outcome: 'needs_review', appliedCount: 0, reviewCount: input.groups.length,
      results: input.groups.map(group => ({ facilityId: group.facilityId, outcome: 'needs_review', reason: text(result.code) ?? 'manual_multi_site_application_rejected' })) }
  }
  const results: ManualMultiSiteResult['results'] = result.results.map(value => {
    const entry = record(value)
    if (!text(entry.facilityId) || !['applied', 'needs_review'].includes(String(entry.outcome))) throw new Error('manual_multi_site_result_invalid')
    return { facilityId: String(entry.facilityId), ...(text(entry.siteId) ? { siteId: String(entry.siteId) } : {}),
      ...(text(entry.requestId) ? { requestId: String(entry.requestId) } : {}),
      outcome: entry.outcome as 'applied' | 'needs_review', ...(text(entry.reason) ? { reason: String(entry.reason) } : {}) }
  })
  if (results.length !== input.groups.length || new Set(results.map(entry => entry.facilityId)).size !== results.length
    || results.some(entry => !input.groups.some(group => group.facilityId === entry.facilityId))
    || results.some(entry => entry.outcome === 'applied' && (!entry.siteId || !entry.requestId))) throw new Error('manual_multi_site_result_scope_invalid')
  const appliedCount = results.filter(entry => entry.outcome === 'applied').length
  const reviewCount = results.length - appliedCount
  if (appliedCount !== result.appliedCount || reviewCount !== result.reviewCount) throw new Error('manual_multi_site_result_counts_invalid')
  if (appliedCount > 0) await continueManualMultiSiteReply({ companyId: input.companyId, customerId: input.customerId, parentRequestId, inboundId: input.inboundId })
  return { outcome: appliedCount > 0 ? 'applied' : 'needs_review', appliedCount, reviewCount, results }
}

/** Retry effects per committed member, without another model call or source rewrite. */
export async function continueManualMultiSiteReply(input: ManualMultiSiteContinuation): Promise<void> {
  const source = await tenantSelect(input.companyId, 'manual_inbound_messages')
    .eq('id', input.inboundId).eq('customer_id', input.customerId).eq('request_id', input.parentRequestId)
    .eq('processing_state', 'applied').eq('resolution_status', 'matched').maybeSingle()
  if (source.error) throw source.error
  if (!source.data) return
  const automation = record(record(record(source.data).extracted_payload).manual_automation)
  const summary = record(automation.multi_site)
  if (summary.version !== 1 || summary.parentRequestId !== input.parentRequestId || summary.sourceHash !== automation.sourceHash) return
  for (const member of Object.values(record(automation.site_applications)).map(record)) {
    if (member.status !== 'applied' || member.parentRequestId !== input.parentRequestId || !text(member.requestId) || !text(member.siteId)) continue
    const scope = { companyId: input.companyId, customerId: input.customerId, inboundId: input.inboundId,
      requestId: String(member.requestId), siteId: String(member.siteId), memberOnly: true, allowPartial: true }
    const context = await readAppliedManualReplyContext(scope)
    if (!context || record(context.member?.continuation).status === 'completed') continue
    try {
    if (context.request.request_type === 'current_supplier_contract_information_request' && context.application.complete !== true) {
      if (context.member?.internalCreated !== true) continue
      const customerInfoRequestId = text(record(context.request.metadata).customer_info_request_id)
      if (!customerInfoRequestId) throw new Error('manual_multi_site_followup_context_invalid')
      if (['received', 'manual_response_received'].includes(String(context.request.status))) {
        // This is the first real clarification send, not an invented earlier
        // delivery. Keep the applied partial source intact and fence the move
        // to the existing queue adapter's legitimate ready state.
        const metadata = record(context.request.metadata)
        const prepared = await tenantUpdate(input.companyId, 'grid_owner_information_requests', {
          status: 'ready_to_send_manual_email', updated_at: new Date().toISOString(),
          metadata: { ...metadata, auto_send_allowed: true, manual_multi_site_clarification: {
            inboundId: input.inboundId, parentRequestId: input.parentRequestId, sourceHash: context.sourceHash, preparedAt: new Date().toISOString(),
          } },
        }).eq('id', scope.requestId).eq('customer_id', input.customerId).eq('customer_site_id', scope.siteId)
          .eq('status', String(context.request.status)).eq('poa_id', String(context.request.poa_id))
          .eq('metadata', JSON.stringify(metadata)).eq('parsed_payload', JSON.stringify(context.application)).select('id').maybeSingle()
        if (prepared.error) throw prepared.error
        if (!prepared.data) throw new Error('manual_multi_site_followup_context_changed')
      }
      const { queueManualSupplierInformationRequest } = await import('@/lib/customer-operations/manualSupplierInformationRequest')
      const queued = await queueManualSupplierInformationRequest({ companyId: input.companyId, customerId: input.customerId, siteId: scope.siteId,
        customerInfoRequestId, actorUserId: context.actorUserId })
      if (!queued.requestId || queued.status === 'needs_review') throw new Error('manual_multi_site_followup_not_queued')
      await markManualReplyContinuation({ ...scope, supplierSwitchRequestId: null })
    } else await continueManualCommercialReply(scope)
    } catch (error) {
      try { await markManualReplyContinuationFailed(scope) } catch { /* Preserve the original error for the canonical retry. */ }
      throw error
    }
  }
  await finishManualMultiSiteContinuation(input)
}

/** Clear a failed global marker only after every required committed effect is durable. */
async function finishManualMultiSiteContinuation(input: ManualMultiSiteContinuation): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const source = await tenantSelect(input.companyId, 'manual_inbound_messages').eq('id', input.inboundId)
      .eq('customer_id', input.customerId).eq('request_id', input.parentRequestId)
      .eq('processing_state', 'applied').eq('resolution_status', 'matched').maybeSingle()
    if (source.error) throw source.error
    if (!source.data) return
    const row = record(source.data), payload = record(row.extracted_payload), automation = record(payload.manual_automation)
    const summary = record(automation.multi_site)
    if (summary.version !== 1 || summary.parentRequestId !== input.parentRequestId || summary.sourceHash !== automation.sourceHash) return
    const members = Object.values(record(automation.site_applications)).map(record).filter(member => member.status === 'applied')
    if (!members.length) return
    const reviews: Row[] = []
    for (const member of members) {
      const context = await readAppliedManualReplyContext({ companyId: input.companyId, customerId: input.customerId, inboundId: input.inboundId,
        requestId: String(member.requestId), siteId: String(member.siteId), memberOnly: true, allowPartial: true })
      if (!context) return
      const requiresEffect = context.request.request_type !== 'current_supplier_contract_information_request'
        || context.application.complete === true || context.member?.internalCreated === true
      if (requiresEffect && record(context.member?.continuation).status !== 'completed') return
      const outcome = record(context.member?.continuation)
      if (outcome.status === 'completed' && outcome.reviewRequired === true) reviews.push(outcome)
    }
    if (record(automation.continuation).status === 'completed') return
    const continuation = { status: 'completed', sourceHash: automation.sourceHash, inboundId: input.inboundId,
      parentRequestId: input.parentRequestId, completedAt: new Date().toISOString(),
      ...(reviews.length ? { reviewRequired: true, reviewCount: reviews.length,
        reviewReasons: manualReplyReviewCodes(reviews.flatMap(outcome => Array.isArray(outcome.reviewReasons) ? outcome.reviewReasons : [])) } : {}) }
    const updated = await tenantUpdate(input.companyId, 'manual_inbound_messages', { extracted_payload: {
      ...payload, manual_automation: { ...automation, continuation },
    } }).eq('id', input.inboundId).eq('customer_id', input.customerId).eq('request_id', input.parentRequestId)
      .eq('customer_site_id', String(row.customer_site_id)).eq('processing_state', 'applied')
      .eq('extracted_payload', JSON.stringify(payload)).select('id').maybeSingle()
    if (updated.error) throw updated.error
    if (updated.data) return
  }
  throw new Error('manual_multi_site_continuation_changed')
}
