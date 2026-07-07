// lib/customer-operations/manualFacilityResponseParser.ts
//
// Parses a grid-owner manual e-mail reply and, when it is safe to do so,
// applies the facility data to the customer site / metering point and runs the
// next-step engine. When anything is uncertain (low confidence, invalid format,
// conflict with existing data, protected identity, cross-tenant ambiguity) the
// request is routed to needs_review and NOTHING is applied automatically.

import { supabaseService } from '@/lib/supabase/service'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'
import { completeFacilityLookupAndRunNextSteps } from '@/lib/customer-operations/facilityResponseOrchestrator'

type JsonRecord = Record<string, unknown>

export type ManualFacilityExtractedPayload = {
  facility_id?: string | null
  metering_point_id?: string | null
  grid_area_code?: string | null
  price_area_code?: string | null
  annual_consumption?: string | null
  current_supplier?: string | null
  notice_period?: string | null
  current_contract_end_date?: string | null
  metering_method?: string | null
  reporting_frequency?: string | null
}

export type ManualFacilityParseResult = {
  outcome: 'applied' | 'needs_review'
  confidence: number
  extracted: ManualFacilityExtractedPayload
  reasons: string[]
  nextStepDecision?: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const PRICE_AREAS = new Set(['SE1', 'SE2', 'SE3', 'SE4'])

// Swedish facility/anläggnings-id (GSRN) is an 18-digit numeric, commonly
// 735999xxxxxxxxxxxx. We accept 16-18 digits and treat 18 as strongest.
function isValidFacilityId(value: string | null): boolean {
  if (!value) return false
  return /^\d{16,18}$/.test(value.replace(/\s/g, ''))
}

function isValidGridAreaCode(value: string | null): boolean {
  if (!value) return false
  return /^[A-Z0-9]{3,8}$/.test(value.toUpperCase())
}

function matchAfterLabel(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n\\r]+)`, 'i')
    const match = text.match(re)
    if (match && match[1]) {
      const cleaned = match[1].trim().replace(/[.;]+$/, '').trim()
      if (cleaned) return cleaned
    }
  }
  return null
}

// Heuristic extraction from a (Swedish) e-mail body. Pure + deterministic.
export function extractManualFacilityFields(bodyText: string): ManualFacilityExtractedPayload {
  const text = String(bodyText ?? '')
  const facilityRaw =
    matchAfterLabel(text, ['anläggnings-?id', 'anlaggnings-?id', 'facility[\\s_-]*id', 'gsrn']) ?? null
  const facilityDigits = facilityRaw ? facilityRaw.replace(/[^\d]/g, '') : null

  const meteringRaw = matchAfterLabel(text, ['mätpunkts-?id', 'matpunkts-?id', 'metering[\\s_-]*point[\\s_-]*id', 'mätpunkt'])
  const meteringDigits = meteringRaw ? meteringRaw.replace(/[^\d]/g, '') : null

  const gridAreaRaw = matchAfterLabel(text, ['nätområde', 'natomrade', 'nätavräkningsområde', 'områdes-?id', 'grid[\\s_-]*area'])
  const gridArea = gridAreaRaw ? gridAreaRaw.toUpperCase().replace(/[^A-Z0-9]/g, '') : null

  const priceAreaRaw = matchAfterLabel(text, ['elområde', 'elomrade', 'price[\\s_-]*area', 'budområde'])
  const priceArea = priceAreaRaw ? priceAreaRaw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) : null

  const annual = matchAfterLabel(text, ['årsenergi', 'arsenergi', 'årsförbrukning', 'annual[\\s_-]*consumption'])
  const currentSupplier = matchAfterLabel(text, ['befintligt elhandelsföretag', 'nuvarande leverantör', 'current[\\s_-]*supplier', 'elhandelsföretag'])
  const noticePeriod = matchAfterLabel(text, ['uppsägningstid', 'uppsagningstid', 'notice[\\s_-]*period'])
  const contractEnd = matchAfterLabel(text, ['slutdatum', 'avtalsslut', 'contract[\\s_-]*end'])
  const meteringMethod = matchAfterLabel(text, ['mätmetod', 'matmetod', 'metering[\\s_-]*method'])
  const reportingFrequency = matchAfterLabel(text, ['rapporteringsfrekvens', 'reporting[\\s_-]*frequency'])

  return {
    facility_id: facilityDigits && facilityDigits.length >= 16 ? facilityDigits : null,
    metering_point_id: meteringDigits && meteringDigits.length >= 16 ? meteringDigits : null,
    grid_area_code: gridArea || null,
    price_area_code: priceArea && PRICE_AREAS.has(priceArea) ? priceArea : null,
    annual_consumption: annual,
    current_supplier: currentSupplier,
    notice_period: noticePeriod,
    current_contract_end_date: contractEnd,
    metering_method: meteringMethod,
    reporting_frequency: reportingFrequency,
  }
}

export function scoreManualFacilityPayload(payload: ManualFacilityExtractedPayload): number {
  let score = 0
  if (isValidFacilityId(clean(payload.facility_id))) score += 0.55
  if (isValidGridAreaCode(clean(payload.grid_area_code))) score += 0.2
  if (clean(payload.price_area_code)) score += 0.1
  if (clean(payload.annual_consumption)) score += 0.05
  if (clean(payload.current_supplier)) score += 0.05
  if (clean(payload.metering_point_id)) score += 0.05
  return Math.min(score, 1)
}

// Applies a parsed grid-owner reply against a request. Tenant ownership is
// derived from the request (company_id), never from the inbound message.
export async function applyManualFacilityResponse(input: {
  companyId: string
  request: JsonRecord
  extracted: ManualFacilityExtractedPayload
  rawPayload?: JsonRecord
  senderCredible: boolean
  actorUserId?: string | null
  source?: string | null
}): Promise<ManualFacilityParseResult> {
  const reasons: string[] = []
  const confidence = scoreManualFacilityPayload(input.extracted)
  const requestId = String(input.request.id)
  const siteId = clean(input.request.customer_site_id)
  const customerId = clean(input.request.customer_id)

  const facilityId = clean(input.extracted.facility_id)
  const gridAreaCode = clean(input.extracted.grid_area_code)

  // Load site to check protected identity + conflicts.
  let site: JsonRecord | null = null
  if (siteId) {
    const { data } = await supabaseService
      .from('customer_sites')
      .select('id,company_id,customer_id,facility_id,grid_area_code,price_area_code,protected_identity')
      .eq('company_id', input.companyId)
      .eq('id', siteId)
      .maybeSingle()
    site = (data as JsonRecord | null) ?? null
  }

  const protectedIdentity = site?.protected_identity === true
  const existingFacility = clean(site?.facility_id)
  const conflict = Boolean(existingFacility && facilityId && existingFacility !== facilityId)

  // Grid owners commonly reply with only the anläggnings-ID. When the reply
  // omits the grid area but the site already carries a validated one, merge
  // from site context instead of forcing a manual review of a valid reply.
  const siteGridAreaCode = clean(site?.grid_area_code)
  const effectiveGridAreaCode = isValidGridAreaCode(gridAreaCode) ? gridAreaCode : siteGridAreaCode
  const effectiveConfidence = Math.max(
    confidence,
    scoreManualFacilityPayload({ ...input.extracted, grid_area_code: effectiveGridAreaCode ?? input.extracted.grid_area_code }),
  )

  if (!input.senderCredible) reasons.push('sender_not_credible')
  if (protectedIdentity) reasons.push('protected_identity')
  if (!isValidFacilityId(facilityId)) reasons.push('facility_id_invalid_or_missing')
  if (!isValidGridAreaCode(gridAreaCode) && !isValidGridAreaCode(effectiveGridAreaCode)) reasons.push('grid_area_code_unknown')
  if (conflict) reasons.push('facility_id_conflict')
  if (!site) reasons.push('site_not_found')
  if (effectiveConfidence < 0.7) reasons.push('low_confidence')

  const safe = reasons.length === 0

  const now = new Date().toISOString()
  const parsedPayload = { ...input.extracted, confidence: effectiveConfidence, applied: safe, grid_area_code_source: effectiveGridAreaCode && !isValidGridAreaCode(gridAreaCode) ? 'site_context' : 'reply' }

  if (!safe) {
    await supabaseService
      .from('grid_owner_information_requests')
      .update({
        status: 'needs_review',
        received_payload: input.rawPayload ?? {},
        parsed_payload: parsedPayload,
        confidence_score: effectiveConfidence,
        received_at: now,
        updated_at: now,
      })
      .eq('id', requestId)
      .then(() => undefined, () => undefined)

    if (customerId && siteId) {
      // Stable idempotency: keyed on the inbound message identity so repeated
      // parsing of the same reply does not create duplicate timeline events.
      // Falls back to the timestamp only when no message identity exists
      // (e.g. manual admin re-parse without a provider message id).
      const inboundMessageIdentity = clean(input.rawPayload?.provider_message_id)
      await emitCustomerOperationEvent({
        companyId: input.companyId,
        customerId,
        customerSiteId: siteId,
        actorUserId: input.actorUserId ?? null,
        eventType: 'manual_facility_request.needs_review',
        title: 'Svar behöver granskas',
        message: 'Svar från nätägaren har tagits emot men behöver granskas innan uppgifterna kan användas.',
        status: 'needs_review',
        severity: 'warning',
        actionRequired: true,
        source: input.source ?? 'manual_facility_response_parser',
        payload: { request_id: requestId, confidence, reasons },
        idempotencyKey: `manual_facility_request.needs_review:${requestId}:${inboundMessageIdentity ?? now}`,
      }).catch(() => undefined)
    }

    return { outcome: 'needs_review', confidence, extracted: input.extracted, reasons }
  }

  // Safe apply: persist parse evidence first (columns the canonical workflow
  // does not manage), then run the ONE facility completion path shared with
  // inbound Z02 and admin manual completion. That path completes the request,
  // updates site + metering point, clears customer_info_requests blockers,
  // refreshes the intake orchestrator and runs the next-step engine.
  await supabaseService
    .from('grid_owner_information_requests')
    .update({
      parsed_payload: parsedPayload,
      confidence_score: effectiveConfidence,
      facility_verification_status: 'manually_verified_by_grid_owner',
      updated_at: now,
    })
    .eq('id', requestId)
    .eq('company_id', input.companyId)
    .then(() => undefined, () => undefined)

  const meteringPointId = clean(input.extracted.metering_point_id)

  let nextStepDecision: string | null = null
  try {
    const completion = await completeFacilityLookupAndRunNextSteps({
      companyId: input.companyId,
      requestId,
      actorUserId: input.actorUserId ?? null,
      source: 'system',
      facilityId,
      meteringPointId,
      gridAreaCode: effectiveGridAreaCode,
      priceAreaCode: clean(input.extracted.price_area_code),
      note: 'Automatiskt tolkat svar från nätägarens e-post.',
      rawPayload: { ...(input.rawPayload ?? {}), extracted: input.extracted as unknown as JsonRecord },
    })
    nextStepDecision = completion.supplierSwitchResult?.decision ?? completion.intakeDecision?.state ?? null
  } catch (error) {
    // Completion failed (e.g. request/site linkage issue): fall back to
    // needs_review so an operator can finish manually — never half-applied.
    await supabaseService
      .from('grid_owner_information_requests')
      .update({
        status: 'needs_review',
        received_payload: input.rawPayload ?? {},
        parsed_payload: { ...parsedPayload, applied: false, completion_error: error instanceof Error ? error.message : 'unknown' },
        received_at: now,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('company_id', input.companyId)
      .then(() => undefined, () => undefined)
    return {
      outcome: 'needs_review',
      confidence,
      extracted: input.extracted,
      reasons: ['completion_failed'],
    }
  }

  if (customerId && siteId) {
    await emitCustomerOperationEvent({
      companyId: input.companyId,
      customerId,
      customerSiteId: siteId,
      actorUserId: input.actorUserId ?? null,
      eventType: 'manual_facility_request.applied',
      title: 'Anläggningsuppgifter mottagna',
      message: 'Anläggningsuppgifter från nätägaren är mottagna och har uppdaterats.',
      status: 'completed',
      severity: 'info',
      source: input.source ?? 'manual_facility_response_parser',
      payload: { request_id: requestId, confidence, facility_id: facilityId, grid_area_code: gridAreaCode },
      idempotencyKey: `manual_facility_request.applied:${requestId}`,
    }).catch(() => undefined)
  }

  return { outcome: 'applied', confidence, extracted: input.extracted, reasons: [], nextStepDecision }
}
