// lib/customer-operations/manualFacilityResponseParser.ts
//
// Parses a grid-owner manual e-mail reply and, when it is safe to do so,
// applies the facility data to the customer site / metering point and runs the
// next-step engine. When anything is uncertain (low confidence, invalid format,
// conflict with existing data, protected identity, cross-tenant ambiguity) the
// request is routed to needs_review and NOTHING is applied automatically.

import { supabaseService } from '@/lib/supabase/service'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'
import { evaluateAndRunNextCustomerStep } from '@/lib/customer-operations/customerProcessNextStepEngine'

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

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist/i.test(message)
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

  if (!input.senderCredible) reasons.push('sender_not_credible')
  if (protectedIdentity) reasons.push('protected_identity')
  if (!isValidFacilityId(facilityId)) reasons.push('facility_id_invalid_or_missing')
  if (!isValidGridAreaCode(gridAreaCode)) reasons.push('grid_area_code_unknown')
  if (conflict) reasons.push('facility_id_conflict')
  if (!site) reasons.push('site_not_found')
  if (confidence < 0.7) reasons.push('low_confidence')

  const safe = reasons.length === 0

  const now = new Date().toISOString()
  const parsedPayload = { ...input.extracted, confidence, applied: safe }

  if (!safe) {
    await supabaseService
      .from('grid_owner_information_requests')
      .update({
        status: 'needs_review',
        received_payload: input.rawPayload ?? {},
        parsed_payload: parsedPayload,
        confidence_score: confidence,
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

  // Safe apply: update site, optionally metering point, complete request.
  const sitePatch: JsonRecord = {
    facility_id: facilityId,
    facility_data_status: 'manually_verified_by_grid_owner',
    facility_data_verified_at: now,
    updated_at: now,
    updated_by: clean(input.actorUserId),
  }
  if (gridAreaCode) sitePatch.grid_area_code = gridAreaCode
  if (clean(input.extracted.price_area_code)) sitePatch.price_area_code = clean(input.extracted.price_area_code)

  const siteUpdate = await supabaseService
    .from('customer_sites')
    .update(sitePatch)
    .eq('company_id', input.companyId)
    .eq('id', siteId as string)
  if (siteUpdate.error && !missingSchema(siteUpdate.error)) throw siteUpdate.error

  // Upsert metering point when a metering point id was provided.
  const meteringPointId = clean(input.extracted.metering_point_id)
  if (meteringPointId && siteId && customerId) {
    const existing = await supabaseService
      .from('metering_points')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('site_id', siteId)
      .limit(1)
      .maybeSingle()
    if (existing.data?.id) {
      await supabaseService
        .from('metering_points')
        .update({
          metering_point_id: meteringPointId,
          meter_point_id: meteringPointId,
          grid_area_code: gridAreaCode,
          facility_data_status: 'manually_verified_by_grid_owner',
          facility_data_verified_at: now,
          updated_at: now,
        })
        .eq('id', existing.data.id)
        .then(() => undefined, () => undefined)
    } else {
      await supabaseService
        .from('metering_points')
        .insert({
          company_id: input.companyId,
          customer_id: customerId,
          site_id: siteId,
          customer_site_id: siteId,
          metering_point_id: meteringPointId,
          meter_point_id: meteringPointId,
          grid_area_code: gridAreaCode,
          status: 'active',
          facility_data_status: 'manually_verified_by_grid_owner',
          facility_data_verified_at: now,
        })
        .then(() => undefined, () => undefined)
    }
  }

  await supabaseService
    .from('grid_owner_information_requests')
    .update({
      status: 'completed',
      facility_id: facilityId,
      received_payload: input.rawPayload ?? {},
      parsed_payload: parsedPayload,
      confidence_score: confidence,
      facility_verification_status: 'manually_verified_by_grid_owner',
      received_at: now,
      completed_at: now,
      updated_at: now,
    })
    .eq('id', requestId)
    .then(() => undefined, () => undefined)

  if (clean(input.request.dispatch_status) !== null) {
    await supabaseService
      .from('grid_owner_information_requests')
      .update({ dispatch_status: 'completed' })
      .eq('id', requestId)
      .then(() => undefined, () => undefined)
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

  // Run the shared next-step readiness engine now that facility data exists.
  let nextStepDecision: string | null = null
  if (customerId && siteId) {
    try {
      const next = await evaluateAndRunNextCustomerStep({
        companyId: input.companyId,
        customerId,
        siteId,
        trigger: 'facility_data_received',
        actorUserId: input.actorUserId ?? null,
        source: 'system',
      })
      nextStepDecision = next.decision
    } catch {
      nextStepDecision = null
    }
  }

  return { outcome: 'applied', confidence, extracted: input.extracted, reasons: [], nextStepDecision }
}
