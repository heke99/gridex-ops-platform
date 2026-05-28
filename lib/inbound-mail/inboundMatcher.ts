import { supabaseService } from '@/lib/supabase/service'
import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'

export type InboundEntityMatch = {
  status: 'matched' | 'missing' | 'ambiguous' | 'not_checked'
  entityType: string | null
  entityId: string | null
  confidence: number
  reasons: string[]
  candidates: Array<Record<string, unknown>>
}

function firstReference(parsed: ParsedEdifactEnvelope, keys: string[]): string | null {
  for (const key of keys) {
    const value = parsed.references[key]?.[0]
    if (value) return value
  }
  return null
}

async function insertAttempt(input: {
  companyId?: string | null
  inboundEmailMessageId?: string | null
  parseResultId?: string | null
  matchType: string
  match: InboundEntityMatch
}) {
  await supabaseService.from('inbound_ediel_match_attempts').insert({
    company_id: input.companyId ?? null,
    inbound_email_message_id: input.inboundEmailMessageId ?? null,
    parse_result_id: input.parseResultId ?? null,
    match_type: input.matchType,
    match_status: input.match.status,
    matched_entity_type: input.match.entityType,
    matched_entity_id: input.match.entityId,
    confidence: input.match.confidence,
    reasons: input.match.reasons,
    candidates: input.match.candidates,
  })
}

function singleOrAmbiguous(entityType: string, rows: Array<Record<string, unknown>>, reasons: string[]): InboundEntityMatch {
  if (rows.length === 0) return { status: 'missing', entityType: null, entityId: null, confidence: 0, reasons, candidates: [] }
  if (rows.length > 1) return { status: 'ambiguous', entityType: null, entityId: null, confidence: 0.5, reasons: [...reasons, 'Flera kandidater matchade.'], candidates: rows }
  return { status: 'matched', entityType, entityId: String(rows[0].id), confidence: 0.95, reasons, candidates: rows }
}

export async function matchOutboundRequestForInbound(input: {
  companyId: string
  parsed: ParsedEdifactEnvelope
  inboundEmailMessageId?: string | null
  parseResultId?: string | null
}): Promise<InboundEntityMatch> {
  const references = [
    input.parsed.interchangeReference,
    firstReference(input.parsed, ['ACW', 'TN', 'LI', 'Z07']),
    input.parsed.bgmReference,
  ].filter((value): value is string => Boolean(value))

  if (references.length === 0) {
    const match = { status: 'missing', entityType: null, entityId: null, confidence: 0, reasons: ['Inga starka RFF/UNB/BGM-referenser fanns för outbound-matchning.'], candidates: [] } satisfies InboundEntityMatch
    await insertAttempt({ ...input, matchType: 'outbound_request', match })
    return match
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const conditions = references.flatMap((reference) => {
    const base = [
      `external_reference.eq.${reference}`,
      `dispatch_batch_key.eq.${reference}`,
    ]
    return uuidPattern.test(reference) ? [...base, `source_id.eq.${reference}`] : base
  })

  const { data, error } = await supabaseService
    .from('outbound_requests')
    .select('id, company_id, source_type, source_id, customer_id, site_id, metering_point_id, grid_owner_id, request_type, status, external_reference, dispatch_batch_key, message_family, message_code')
    .eq('company_id', input.companyId)
    .or(conditions.join(','))
    .limit(5)

  if (error) throw error

  const outboundRows = (data ?? []) as Array<Record<string, unknown>>
  if (outboundRows.length > 0) {
    const match = singleOrAmbiguous('outbound_request', outboundRows, [`Referenser testade mot outbound_requests: ${references.join(', ')}`])
    await insertAttempt({ ...input, matchType: 'outbound_request', match })
    return match
  }

  const { data: edielData, error: edielError } = await supabaseService
    .from('ediel_messages')
    .select('outbound_request_id')
    .eq('company_id', input.companyId)
    .eq('direction', 'outbound')
    .not('outbound_request_id', 'is', null)
    .or(references.flatMap((reference) => [
      `interchange_reference.eq.${reference}`,
      `transaction_reference.eq.${reference}`,
      `external_reference.eq.${reference}`,
      `correlation_reference.eq.${reference}`,
      `original_message_id.eq.${reference}`,
    ]).join(','))
    .limit(5)

  if (edielError) throw edielError

  const outboundIds = Array.from(new Set(
    ((edielData ?? []) as Array<Record<string, unknown>>)
      .map((row) => (typeof row.outbound_request_id === 'string' ? row.outbound_request_id : null))
      .filter((value): value is string => Boolean(value))
  ))

  if (outboundIds.length === 0) {
    const match = singleOrAmbiguous('outbound_request', [], [`Referenser testade mot outbound_requests/ediel_messages: ${references.join(', ')}`])
    await insertAttempt({ ...input, matchType: 'outbound_request', match })
    return match
  }

  const { data: linkedOutboundRows, error: linkedError } = await supabaseService
    .from('outbound_requests')
    .select('id, company_id, source_type, source_id, customer_id, site_id, metering_point_id, grid_owner_id, request_type, status, external_reference, dispatch_batch_key, message_family, message_code')
    .eq('company_id', input.companyId)
    .in('id', outboundIds)

  if (linkedError) throw linkedError

  const match = singleOrAmbiguous('outbound_request', (linkedOutboundRows ?? []) as Array<Record<string, unknown>>, [`Referenser testade mot outbound_requests/ediel_messages: ${references.join(', ')}`])
  await insertAttempt({ ...input, matchType: 'outbound_request', match })
  return match
}

export async function matchMeteringPointForInbound(input: {
  companyId: string
  parsed: ParsedEdifactEnvelope
  inboundEmailMessageId?: string | null
  parseResultId?: string | null
}): Promise<InboundEntityMatch> {
  const candidates = [
    firstReference(input.parsed, ['Z07', 'MG', 'TN']),
    input.parsed.references.LI?.[0],
  ].filter((value): value is string => Boolean(value))

  if (candidates.length === 0) {
    const match = { status: 'missing', entityType: null, entityId: null, confidence: 0, reasons: ['Ingen anläggnings-/mätpunktsreferens hittades.'], candidates: [] } satisfies InboundEntityMatch
    await insertAttempt({ ...input, matchType: 'metering_point', match })
    return match
  }

  const ors = candidates.flatMap((candidate) => [
    `meter_point_id.eq.${candidate}`,
    `site_facility_id.eq.${candidate}`,
    `ediel_reference.eq.${candidate}`,
  ])

  const { data, error } = await supabaseService
    .from('metering_points')
    .select('id, customer_id, site_id, grid_owner_id, meter_point_id, site_facility_id, ediel_reference')
    .eq('company_id', input.companyId)
    .or(ors.join(','))
    .limit(5)

  if (error) throw error

  const match = singleOrAmbiguous('metering_point', (data ?? []) as Array<Record<string, unknown>>, [`Mätpunktsreferenser testade: ${candidates.join(', ')}`])
  await insertAttempt({ ...input, matchType: 'metering_point', match })
  return match
}
