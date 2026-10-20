import { tenantDb } from '@/lib/supabase/tenantDb'
import { tenantSelect, tenantUpdate } from '@/lib/supabase/tenantQuery'
import { supabaseService } from '@/lib/supabase/service'
import { createCustomerInfoRequest } from '@/lib/onboarding/infoRequests'
import { queueManualSupplierInformationRequest } from '@/lib/customer-operations/manualSupplierInformationRequest'
import { MISSING_AUTOMATION_USER_BLOCKER_CODE, resolveAutomationActorId } from '@/lib/customer-operations/automationConfig'
import { requireUuid } from '@/lib/validation/uuid'
import { findOpenSupplierSwitchRequestForSite } from '@/lib/operations/db'
import { canonicalProdatSubtypeForMessage } from '@/lib/ediel/rulebook/canonicalEdielFacade'

export type EnsureManualSupplierInformationResult = {
  status: 'ready' | 'waiting_response' | 'needs_review' | 'not_applicable'
  requestId?: string
  blockerCode?: string
}

type Row = Record<string, unknown>
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const clean = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const OPEN = ['draft', 'ready_to_send', 'ready_to_send_manual_email', 'manual_email_queued', 'manual_email_sent', 'waiting_manual_response', 'manual_response_received', 'needs_review']
const CLOSED_CIR = new Set(['cancelled', 'rejected', 'received', 'completed', 'ready_for_switch'])
const HELD_SITE = new Set(['manual_review', 'manual_review_required', 'needs_review', 'blocked', 'rejected', 'completion_requested', 'not_free_to_switch'])

/** Establish a separate supplier inquiry before any normal post-facility switch
 * continuation. This queues through the canonical owner and never sends mail. */
export async function ensureManualSupplierInformationForSite(input: {
  companyId: string
  customerId: string
  siteId: string
  actorUserId?: string | null
  operationId?: string | null
  sourceRequestId?: string | null
}): Promise<EnsureManualSupplierInformationResult> {
  const companyId = requireUuid(input.companyId, 'company_id')
  const customerId = requireUuid(input.customerId, 'customer_id')
  const siteId = requireUuid(input.siteId, 'site_id')
  const scope = { companyId, customerId, siteId }
  const review = (blockerCode: string, requestId?: string): EnsureManualSupplierInformationResult => ({ status: 'needs_review', blockerCode, ...(requestId ? { requestId } : {}) })
  const [siteRead, customerRead] = await Promise.all([
    tenantSelect(companyId, 'customer_sites', '*').eq('company_id', companyId).eq('customer_id', customerId).eq('id', siteId).maybeSingle(),
    tenantSelect(companyId, 'customers', '*').eq('company_id', companyId).eq('id', customerId).maybeSingle(),
  ])
  if (siteRead.error) throw siteRead.error
  if (customerRead.error) throw customerRead.error
  const site = siteRead.data as Row | null, customer = customerRead.data as Row | null
  if (!site || !customer || site.id !== siteId || site.company_id !== companyId || site.customer_id !== customerId
    || customer.id !== customerId || customer.company_id !== companyId) return review('supplier_customer_context_invalid')

  // Match the canonical creator: reuse the exact durable request when one is
  // open; otherwise a site's move-in date creates a move-in, not a normal
  // switch. The previous occupant's contract must never become its prerequisite.
  const existingSwitch = await findOpenSupplierSwitchRequestForSite(supabaseService, scope)
  if (existingSwitch) {
    if (existingSwitch.company_id !== companyId || existingSwitch.customer_id !== customerId || existingSwitch.site_id !== siteId) {
      return review('supplier_customer_context_invalid')
    }
    const subtype = canonicalProdatSubtypeForMessage('Z03', existingSwitch.prodat_variant ?? existingSwitch.prodat_reason)
    if (existingSwitch.request_type === 'move_in' || existingSwitch.request_type === 'move_out_takeover'
      || subtype === 'LK' || subtype === 'C' || existingSwitch.status === 'cancellation_requested') return { status: 'not_applicable' }
  } else if (site.move_in_date) {
    return { status: 'not_applicable' }
  }

  const moveInDate = clean(site.move_in_date)
  let responseStatus = clean(site.current_supplier_response_status)
  const originalSupplierId = clean(site.current_supplier_id)
  const held = responseStatus !== null && (HELD_SITE.has(responseStatus) || /(?:manual|review|block|reject|completion)/i.test(responseStatus))
  const setStatus = async (status: 'waiting_response' | 'manual_review'): Promise<boolean> => {
    if (held) return status === 'manual_review'
    let query = tenantUpdate(companyId, 'customer_sites', { current_supplier_response_status: status, updated_at: new Date().toISOString() })
      .eq('company_id', companyId).eq('customer_id', customerId).eq('id', siteId)
    query = originalSupplierId ? query.eq('current_supplier_id', originalSupplierId) : query.is('current_supplier_id', null)
    query = responseStatus ? query.eq('current_supplier_response_status', responseStatus) : query.is('current_supplier_response_status', null)
    query = site.metadata == null ? query.is('metadata', null) : query.eq('metadata', JSON.stringify(site.metadata))
    query = moveInDate ? query.eq('move_in_date', moveInDate) : query.is('move_in_date', null)
    const changed = await query.select('id').maybeSingle()
    if (changed.error) throw changed.error
    if (!changed.data) return false
    responseStatus = status
    return true
  }
  const hold = async (code: string, requestId?: string) => {
    const applied = await setStatus('manual_review')
    return review(applied ? code : 'supplier_site_changed', requestId)
  }
  if (held) return review('supplier_information_already_requires_review')
  if (site.protected_identity === true || customer.protected_identity === true || site.is_active === false || customer.is_active === false) return hold('supplier_customer_context_invalid')
  if (!originalSupplierId) return hold('supplier_identity_missing')
  const supplierRead = await tenantDb(companyId).unscoped().from('electricity_suppliers').select('id,company_id,name,is_active')
    .eq('id', originalSupplierId).or(`company_id.is.null,company_id.eq.${companyId}`).eq('is_active', true).maybeSingle()
  if (supplierRead.error) throw supplierRead.error
  const supplier = supplierRead.data as Row | null
  if (!supplier || supplier.id !== originalSupplierId || (supplier.company_id != null && supplier.company_id !== companyId)
    || supplier.is_active !== true || !clean(supplier.name)) return hold('supplier_identity_not_usable')

  if (responseStatus === 'free_to_switch') {
    const snapshot = record(site.metadata).manual_supplier_terms
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return hold('supplier_terms_not_verified')
    const verified = await supabaseService.rpc('gridex_manual_supplier_terms_verified_v1', {
      p_company_id: companyId, p_customer_id: customerId, p_site_id: siteId, p_snapshot: snapshot,
    })
    if (verified.error) throw verified.error
    return verified.data === true ? { status: 'ready' } : hold('supplier_terms_not_verified')
  }
  let actorUserId: string
  try { actorUserId = resolveAutomationActorId(input.actorUserId) }
  catch { return hold(MISSING_AUTOMATION_USER_BLOCKER_CODE) }
  // Place the switch hold before creating or queueing anything. A concurrent
  // supplier response or operator hold wins this compare-and-set.
  if (!await setStatus('waiting_response')) return review('supplier_site_changed')

  const conversations = await tenantSelect(companyId, 'grid_owner_information_requests', 'id,metadata,status')
    .eq('company_id', companyId).eq('customer_id', customerId).eq('customer_site_id', siteId)
    .eq('request_type', 'current_supplier_contract_information_request').in('status', OPEN).limit(2)
  if (conversations.error) throw conversations.error
  const rows = (conversations.data ?? []) as Row[]
  if (rows.length > 1) return hold('supplier_conversation_ambiguous')
  const conversation = rows[0]
  let cir: Row | null = null
  if (conversation) {
    const binding = record(conversation.metadata)
    const cirId = clean(binding.customer_info_request_id)
    if (binding.supplier_id !== originalSupplierId || !cirId || conversation.status === 'needs_review'
      || record(binding.counterparty_reply).requires_review === true) return hold('supplier_conversation_requires_review', clean(conversation.id) ?? undefined)
    const existing = await tenantSelect(companyId, 'customer_info_requests', '*')
      .eq('company_id', companyId).eq('customer_id', customerId).eq('site_id', siteId).eq('id', cirId)
      .eq('request_type', 'current_supplier_contract_info').eq('target_party_type', 'current_supplier').maybeSingle()
    if (existing.error) throw existing.error
    cir = existing.data as Row | null
    if (!cir) return hold('supplier_information_request_invalid', clean(conversation.id) ?? undefined)
  } else {
    cir = await createCustomerInfoRequest({ ...scope, actorUserId,
      requestType: 'current_supplier_contract_info', targetPartyType: 'current_supplier',
      targetPartyName: String(supplier.name), currentSupplierName: String(supplier.name),
      requestedDataCategories: ['current_supplier_contract_information'],
      automationKey: `manual-supplier:${companyId}:${siteId}:${originalSupplierId}`, automationOrigin: 'manual_facility_reply',
      operationId: input.operationId ?? null, externalReference: input.sourceRequestId ?? null,
    }) as unknown as Row
    if (cir.automation_key !== `manual-supplier:${companyId}:${siteId}:${originalSupplierId}`) return hold('supplier_information_request_invalid')
  }
  const cirId = clean(cir.id)
  const cirPayload = record(cir.verified_payload)
  if (!cirId || cir.company_id !== companyId || cir.customer_id !== customerId || cir.site_id !== siteId
    || cir.target_party_type !== 'current_supplier' || cir.request_type !== 'current_supplier_contract_info'
    || CLOSED_CIR.has(String(cir.status)) || /(?:manual.*review|review|block|missing_authorization)/i.test(String(cir.status))
    || (cirPayload.supplier_id != null && cirPayload.supplier_id !== originalSupplierId)) return hold('supplier_information_request_invalid')
  if (cirPayload.supplier_id == null) {
    const bound = await tenantUpdate(companyId, 'customer_info_requests', { verified_payload: { ...cirPayload, supplier_id: originalSupplierId }, updated_at: new Date().toISOString() })
      .eq('company_id', companyId).eq('customer_id', customerId).eq('site_id', siteId).eq('id', cirId)
      .eq('status', String(cir.status)).eq('verified_payload', JSON.stringify(cirPayload)).select('id').maybeSingle()
    if (bound.error) throw bound.error
    if (!bound.data) return hold('supplier_information_request_changed')
  }
  // Recheck the exact supplier immediately before the canonical queue adapter.
  let freshQuery = tenantSelect(companyId, 'customer_sites', 'id,current_supplier_id,current_supplier_response_status,move_in_date')
    .eq('company_id', companyId).eq('customer_id', customerId).eq('id', siteId).eq('current_supplier_id', originalSupplierId)
    .eq('current_supplier_response_status', 'waiting_response')
  freshQuery = moveInDate ? freshQuery.eq('move_in_date', moveInDate) : freshQuery.is('move_in_date', null)
  const fresh = await freshQuery.maybeSingle()
  if (fresh.error) throw fresh.error
  if (!fresh.data) return review('supplier_site_changed')
  const queued = await queueManualSupplierInformationRequest({ ...scope, customerInfoRequestId: cirId, actorUserId })
  if (queued.status === 'needs_review') return hold(queued.blockerCode ?? 'supplier_information_requires_review', queued.requestId ?? undefined)
  if (!queued.requestId) return hold('supplier_information_request_invalid')
  return { status: 'waiting_response', requestId: queued.requestId }
}
