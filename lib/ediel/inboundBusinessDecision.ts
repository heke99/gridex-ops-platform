import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = stringValue(value)
    if (text) return text
  }
  return null
}

function extractIdentifiers(message: EdielMessageRow) {
  const parsed = asObject(message.parsed_payload)
  const normalized = asObject(parsed.normalizedMeteringPayload)
  const runtime = asObject(parsed.utiltsRuntimeFacts)
  const prodat = asObject(parsed.prodat)
  return {
    facilityId: firstString(parsed.facilityId, normalized.facilityId, prodat.facilityId, message.external_reference),
    meteringPointId: firstString(parsed.meteringPointId, normalized.meteringPointId, prodat.meteringPointId, message.metering_point_id),
    transactionReference: firstString(message.transaction_reference, runtime.transactionReference, normalized.transactionReference),
  }
}

export async function recordInboundBusinessDecision(message: EdielMessageRow) {
  const companyId = stringValue(message.company_id)
  const ids = extractIdentifiers(message)
  let matchedMeteringPointId: string | null = null
  let matchedCustomerId: string | null = null
  let matchedCustomerSiteId: string | null = null
  const warnings: string[] = []

  if (!companyId) warnings.push('Tenant saknas. Meddelandet måste granskas manuellt innan affärssvar skapas.')

  if (companyId && (ids.meteringPointId || ids.facilityId)) {
    const orParts = [
      ids.meteringPointId ? `metering_point_id.eq.${ids.meteringPointId}` : null,
      ids.meteringPointId ? `normalized_metering_point_id.eq.${ids.meteringPointId}` : null,
      ids.facilityId ? `site_facility_id.eq.${ids.facilityId}` : null,
    ].filter(Boolean).join(',')

    if (orParts) {
      const { data, error } = await supabaseService
        .from('metering_points')
        .select('id,customer_id,customer_site_id')
        .eq('company_id', companyId)
        .or(orParts)
        .limit(2)

      if (!error && (data ?? []).length === 1) {
        matchedMeteringPointId = String(data?.[0]?.id)
        matchedCustomerId = stringValue(data?.[0]?.customer_id)
        matchedCustomerSiteId = stringValue(data?.[0]?.customer_site_id)
      } else if (!error && (data ?? []).length > 1) {
        warnings.push('Flera mätpunkter matchar inkommande meddelande. Manuell granskning krävs.')
      }
    }
  }

  if (companyId && !matchedMeteringPointId) warnings.push('Ingen säker mätpunktsmatchning inom tenant.')

  const decisionStatus = companyId && matchedMeteringPointId ? 'ready_to_answer' : 'pending_review'
  const recommendedAction = decisionStatus === 'ready_to_answer'
    ? 'Kör decision engine och skapa korrekt kvittens/svar.'
    : 'Skicka till manuell granskning innan autosvar.'

  const row = {
    company_id: companyId,
    ediel_message_id: message.id,
    sender_ediel_id: stringValue(message.sender_ediel_id),
    receiver_ediel_id: stringValue(message.receiver_ediel_id),
    message_family: stringValue(message.message_family),
    message_code: stringValue(message.message_code),
    application_reference: stringValue(message.application_reference),
    decision_status: decisionStatus,
    decision_type: 'incoming_business_request',
    matched_customer_id: matchedCustomerId,
    matched_customer_site_id: matchedCustomerSiteId,
    matched_metering_point_id: matchedMeteringPointId,
    warnings: warnings.map((message) => ({ message })),
    errors: [],
    recommended_action: recommendedAction,
    metadata: {
      facility_id: ids.facilityId,
      metering_point_id: ids.meteringPointId,
      transaction_reference: ids.transactionReference,
    },
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabaseService
    .from('ediel_inbound_business_decisions')
    .upsert(row, { onConflict: 'ediel_message_id' })
    .select('*')
    .maybeSingle()

  if (error && error.code !== '42P01' && error.code !== 'PGRST205') throw error
  return data ?? row
}
