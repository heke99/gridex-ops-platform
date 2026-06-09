import { supabaseService } from '@/lib/supabase/service'
import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import type { EdielMessageRow } from '@/lib/ediel/types'

export type InboundRequestDecisionStatus = 'ready_to_answer' | 'pending_review' | 'not_applicable'

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isMissingSchemaError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(maybe && ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(maybe.code ?? '') || /does not exist|schema cache|column .* does not exist/i.test(maybe?.message ?? ''))
}

function actorRoleFromFamily(senderEdielId: string | null, messageFamily: string | null): string {
  if (!senderEdielId) return 'unknown_actor'
  const family = String(messageFamily ?? '').toUpperCase()
  if (family === 'PRODAT') return 'market_actor'
  if (family === 'UTILTS') return 'metering_data_actor'
  if (family === 'APERAK' || family === 'CONTRL' || family === 'UTILTS_ERR') return 'ack_actor'
  return 'unknown_actor'
}

async function loadMessage(messageId: string): Promise<EdielMessageRow> {
  const { data, error } = await supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('id', messageId)
    .single()
  if (error) throw error
  return data as EdielMessageRow
}

async function matchMeteringPointWithinTenant(input: {
  companyId: string
  facilityId: string | null
  meteringPointId: string | null
}) {
  const orParts = [
    input.meteringPointId ? `metering_point_id.eq.${input.meteringPointId}` : null,
    input.meteringPointId ? `normalized_metering_point_id.eq.${input.meteringPointId}` : null,
    input.facilityId ? `site_facility_id.eq.${input.facilityId}` : null,
    input.facilityId ? `anlage_id.eq.${input.facilityId}` : null,
  ].filter(Boolean).join(',')

  if (!orParts) return { status: 'missing_identifiers' as const, row: null, count: 0 }

  const { data, error } = await supabaseService
    .from('metering_points')
    .select('id,customer_id,customer_site_id,site_id,metering_point_id,site_facility_id,status')
    .eq('company_id', input.companyId)
    .or(orParts)
    .limit(3)

  if (error) {
    if (isMissingSchemaError(error)) return { status: 'schema_missing' as const, row: null, count: 0 }
    throw error
  }

  const rows = (data ?? []) as Record<string, unknown>[]
  if (rows.length === 1) return { status: 'matched' as const, row: rows[0], count: 1 }
  if (rows.length > 1) return { status: 'ambiguous' as const, row: null, count: rows.length }
  return { status: 'not_found' as const, row: null, count: 0 }
}

async function findActiveAuthorization(input: {
  companyId: string
  customerId: string | null
  customerSiteId: string | null
  meteringPointId: string | null
}) {
  if (!input.customerId) return { status: 'missing_customer' as const, row: null }

  const contract = await supabaseService
    .from('customer_contracts')
    .select('id,status,starts_at,ends_at')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .in('status', ['active', 'signed'])
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!contract.error && contract.data) return { status: 'active_contract' as const, row: contract.data as Record<string, unknown> }
  if (contract.error && !isMissingSchemaError(contract.error)) throw contract.error

  const poa = await supabaseService
    .from('powers_of_attorney')
    .select('id,status,valid_from,valid_to')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .in('status', ['active', 'signed', 'valid'])
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!poa.error && poa.data) return { status: 'active_power_of_attorney' as const, row: poa.data as Record<string, unknown> }
  if (poa.error && !isMissingSchemaError(poa.error)) throw poa.error

  return { status: 'missing_authorization' as const, row: null }
}

async function createManualReview(input: {
  companyId: string | null
  edielMessageId: string
  issueType: string
  title: string
  description: string
  payload: Record<string, unknown>
}) {
  const { data, error } = await supabaseService
    .from('ediel_manual_review_items')
    .upsert({
      company_id: input.companyId,
      ediel_message_id: input.edielMessageId,
      issue_type: input.issueType,
      title: input.title,
      description: input.description,
      status: 'open',
      payload: input.payload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'ediel_message_id,issue_type' })
    .select('id')
    .maybeSingle()

  if (error && !isMissingSchemaError(error)) throw error
  return text(data?.id)
}

export async function evaluateInboundEdielRequest(input: {
  messageId: string
  forceManualReview?: boolean
}) {
  const message = await loadMessage(input.messageId)
  const canonical = parseCanonicalEdielPayload({
    rawPayload: message.raw_payload,
    direction: message.direction,
    standardHint: message.message_standard,
  })

  const companyId = text(message.company_id)
  const messageFamily = text(message.message_family) ?? canonical.messageFamilyForStorage
  const messageCode = text(String(message.message_code ?? '')) ?? canonical.messageCode
  const senderEdielId = text(message.sender_ediel_id) ?? canonical.sender
  const receiverEdielId = text(message.receiver_ediel_id) ?? canonical.receiver
  const receiverSubaddress = text(message.receiver_sub_address) ?? canonical.receiverSubAddress
  const facilityId = text(canonical.facilityId) ?? text(object(message.parsed_payload).facilityId)
  const meteringPointId = text(canonical.meteringPointId) ?? text(message.metering_point_id) ?? text(object(message.parsed_payload).meteringPointId)
  const warnings: string[] = []
  const errors: string[] = []

  if (message.direction !== 'inbound') warnings.push('Meddelandet är inte inbound och ska normalt inte behandlas som inkommande begäran.')
  if (!companyId) errors.push('Tenant saknas. Tenant måste lösas innan kund eller mätpunkt matchas.')
  if (!senderEdielId) warnings.push('Avsändande Ediel-ID saknas eller kunde inte läsas.')
  if (!receiverEdielId) warnings.push('Mottagande Ediel-ID saknas eller kunde inte läsas.')
  if (!receiverSubaddress) warnings.push('Mottagande subadress saknas. Kontrollera route och meddelandetyp innan autosvar.')

  let meteringMatch: Awaited<ReturnType<typeof matchMeteringPointWithinTenant>> | null = null
  let authorization: Awaited<ReturnType<typeof findActiveAuthorization>> | null = null

  if (companyId) {
    meteringMatch = await matchMeteringPointWithinTenant({ companyId, facilityId, meteringPointId })
    if (meteringMatch.status !== 'matched') {
      errors.push(
        meteringMatch.status === 'missing_identifiers'
          ? 'Anläggnings-id/mätpunkts-id saknas i meddelandet.'
          : meteringMatch.status === 'ambiguous'
            ? 'Flera mätpunkter matchar inom tenant.'
            : 'Ingen säker mätpunktsmatchning inom tenant.'
      )
    } else {
      authorization = await findActiveAuthorization({
        companyId,
        customerId: text(meteringMatch.row?.customer_id),
        customerSiteId: text(meteringMatch.row?.customer_site_id) ?? text(meteringMatch.row?.site_id),
        meteringPointId: text(meteringMatch.row?.id),
      })
      if (authorization.status === 'missing_authorization') errors.push('Aktivt avtal/fullmakt saknas för matchad kund och mätpunkt.')
    }
  }

  const status: InboundRequestDecisionStatus = errors.length > 0 || input.forceManualReview ? 'pending_review' : 'ready_to_answer'
  const recommendedAck = (() => {
    if (status === 'pending_review') return 'manual_review'
    const family = String(messageFamily ?? '').toUpperCase()
    if (family === 'UTILTS') return 'contrl_then_aperak_or_utilts_err'
    if (family === 'PRODAT') return 'contrl_then_aperak'
    return 'technical_ack_only'
  })()

  const decisionPayload = {
    company_id: companyId,
    ediel_message_id: message.id,
    sender_ediel_id: senderEdielId,
    receiver_ediel_id: receiverEdielId,
    receiver_subaddress: receiverSubaddress,
    message_family: messageFamily,
    message_code: messageCode,
    application_reference: text(message.application_reference) ?? canonical.applicationReference,
    actor_role: actorRoleFromFamily(senderEdielId, messageFamily),
    decision_status: status,
    recommended_ack: recommendedAck,
    matched_customer_id: text(meteringMatch?.row?.customer_id),
    matched_customer_site_id: text(meteringMatch?.row?.customer_site_id) ?? text(meteringMatch?.row?.site_id),
    matched_metering_point_id: text(meteringMatch?.row?.id),
    authorization_status: authorization?.status ?? null,
    warnings: warnings.map((message) => ({ message })),
    errors: errors.map((message) => ({ message })),
    identifiers: {
      facility_id: facilityId,
      metering_point_id: meteringPointId,
      transaction_reference: text(message.transaction_reference) ?? canonical.transactionReference,
      business_reference: text(message.external_reference) ?? canonical.businessReference,
    },
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabaseService
    .from('ediel_inbound_request_decisions')
    .upsert(decisionPayload, { onConflict: 'ediel_message_id' })
    .select('*')
    .maybeSingle()

  if (error && !isMissingSchemaError(error)) throw error

  let manualReviewId: string | null = null
  if (status === 'pending_review') {
    manualReviewId = await createManualReview({
      companyId,
      edielMessageId: message.id,
      issueType: companyId ? 'business_match_or_authorization' : 'tenant_resolution_required',
      title: 'Inkommande Ediel-meddelande kräver granskning',
      description: errors[0] ?? warnings[0] ?? 'Systemet kunde inte besluta ett säkert autosvar.',
      payload: decisionPayload,
    })
  }

  return {
    ...(data as Record<string, unknown> | null ?? decisionPayload),
    manual_review_id: manualReviewId,
  }
}
