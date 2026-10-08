import { supabaseService } from '@/lib/supabase/service'
import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import { classifyCanonicalInboundAck } from '@/lib/ediel/ack/inboundAckOutcome'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { validateEdifactEnvelope, validateUnsmGrammar } from '@/lib/ediel/core/edifactValidation'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatRegisterFieldState } from '@/lib/ediel/prodat/prodatRegisterFields'
import { prodatCharacteristicValues } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { evaluateProdatTransactionReason } from '@/lib/ediel/prodat/prodatTransactionReason'

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
  // P26.A §§3.3–3.5: P-APERAK ACW is the original BGM/1004. The reply's
  // own UNB/UNH values are independent identities and must never select the
  // outbound business row. Multiple distinct ACWs are not an exact match.
  const prodatAperak = input.parsed.messageFamily === 'APERAK' &&
    classifyCanonicalInboundAck(input.parsed).profile === 'PRODAT_16_B'
  const acw = Array.from(new Set((input.parsed.references.ACW ?? []).map(value => value.trim()).filter(Boolean)))
  const references = prodatAperak ? acw.length === 1 ? acw : [] : [
    input.parsed.interchangeReference,
    firstReference(input.parsed, ['UCI', 'UCM', 'ACW', 'TN', 'LI', 'Z09', 'Z07', 'DOC_PRODAT', 'DOC_UTILTS', 'DOC_APERAK', 'DOC']),
    input.parsed.bgmReference,
    input.parsed.transactionReference,
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

  if (!prodatAperak) {
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
  }

  // P-APERAK must identify the outbound Ediel BGM before its linked request
  // may be updated. A request's own external reference cannot stand in for it.
  // ACW remains literal document data, never a PostgREST filter expression.
  const edielQuery = () => supabaseService.from('ediel_messages')
    .select('id,company_id,outbound_request_id,customer_id,site_id,metering_point_id,grid_owner_id,message_family,message_code,external_reference,interchange_reference,transaction_reference,correlation_reference,original_message_id')
    .eq('company_id', input.companyId)
    .eq('direction', 'outbound')
    .not('message_family', 'in', '(CONTRL,APERAK,UTILTS_ERR)')
  let edielData: Array<Record<string, unknown>> | null = null
  let edielError: unknown = null
  if (prodatAperak) {
    const [external, bgm] = await Promise.all([
      edielQuery().eq('external_reference', references[0]).limit(5),
      edielQuery().eq('bgm_reference', references[0]).limit(5),
    ])
    edielError = external.error ?? bgm.error
    edielData = [...new Map([...(external.data ?? []), ...(bgm.data ?? [])]
      .map(row => [row.id, row as Record<string, unknown>])).values()]
  } else {
    const result = await edielQuery().or(references.flatMap((reference) => [
      `interchange_reference.eq.${reference}`,
      `transaction_reference.eq.${reference}`,
      `external_reference.eq.${reference}`,
      `correlation_reference.eq.${reference}`,
      `original_message_id.eq.${reference}`,
    ]).join(',')).limit(5)
    edielData = (result.data ?? []) as Array<Record<string, unknown>>
    edielError = result.error
  }

  if (edielError) throw edielError

  const edielRows = (edielData ?? []) as Array<Record<string, unknown>>
  const outboundIds = Array.from(new Set(
    edielRows
      .map((row) => (typeof row.outbound_request_id === 'string' ? row.outbound_request_id : null))
      .filter((value): value is string => Boolean(value))
  ))

  if (outboundIds.length === 0) {
    if (edielRows.length > 0) {
      const match = singleOrAmbiguous('ediel_message', edielRows, [`Referenser testade mot outbound ediel_messages: ${references.join(', ')}`])
      await insertAttempt({ ...input, matchType: 'outbound_ediel_message', match })
      return match
    }

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

/** Physical candidate selection only, never original/source admission. Undefined
 * preserves other guide/kind paths; null holds a malformed own L/LK attempt.
 * Read the actual wire, not mutable parser projections or the original RFF LI.
 */
function physicalSupplierReplyPoint(rawPayload: string): string | null | undefined {
  const { segments, una } = tokenizeEdifact(rawPayload)
  const type = ['PRODAT', 'D', '97A', 'UN', 'E2SE6A']
  const ownGuide = segments.some(token => {
    const parts = segmentComposite(token, 2, una)
    return token.tag === 'UNH' && parts.length === type.length && parts.every((value, index) => value === type[index])
  })
  const ownApplication = segments.some(token => {
    const parts = segmentComposite(token, 7, una)
    return token.tag === 'UNB' && parts.length === 1 && parts[0] === '23-DDQ-PRODAT'
  })
  if (!ownGuide || !ownApplication
    || !segments.some(token => token.tag === 'BGM' && segmentComposite(token, 1, una)[0] === 'Z02')) return undefined
  const { groups, problems } = prodatRegisterGroups(segments, una, 'Z02')
  // The attempted kind must be an adjacent physical pair inside its own LIN.
  // Missing/unowned reasons cannot turn every invalid Z02 into this new path.
  const ownReason = (value: string) => value === 'Z22' || value === 'Z23'
  if (!groups.some(group => prodatCharacteristicValues('223', group.segments, una).some(ownReason))) return undefined
  const envelope = validateEdifactEnvelope(rawPayload)
  const grammar = validateUnsmGrammar(rawPayload)
  if (!envelope.ok || grammar.qualification !== 'qualified' || !grammar.syntaxOk
    || ['UNB', 'UNH', 'BGM', 'UNT', 'UNZ'].some(tag => segments.filter(token => token.tag === tag).length !== 1)
    || problems.length || groups.length !== 1 || !groups[0].validRegisterChain) return null
  const identity = prodatRegisterFieldState('209', groups[0].segments, una)
  const sequence = prodatRegisterFieldState('314', groups[0].segments, una)
  const reasons = prodatCharacteristicValues('223', groups[0].segments, una)
  const qualifiers = segments.filter(token => token.tag === 'CCI'
    && segmentComposite(token, 2, una)[0]?.trim().toUpperCase() === 'Z13')
  if (!identity?.present || identity.malformed || !sequence?.present || sequence.malformed
    || qualifiers.length !== 1 || reasons.length !== 1 || !ownReason(reasons[0])
    || evaluateProdatTransactionReason({ rawSegments: segments.map(token => token.raw), una, code: 'Z02' }).issues.length) return null
  return identity.value
}

export async function matchMeteringPointForInbound(input: {
  companyId: string
  parsed: ParsedEdifactEnvelope
  inboundEmailMessageId?: string | null
  parseResultId?: string | null
}): Promise<InboundEntityMatch> {
  const physicalPoint = physicalSupplierReplyPoint(input.parsed.rawPayload)
  if (physicalPoint !== undefined) {
    let rows: Array<Record<string, unknown>> = []
    if (physicalPoint !== null) {
      const pointQuery = () => supabaseService.from('metering_points')
        .select('id, company_id, customer_id, site_id, grid_owner_id, meter_point_id, metering_point_id, site_facility_id, ediel_reference')
        .eq('company_id', input.companyId)
      // Field209 allows literal text. Typed equality keeps filter punctuation
      // as data; each query is tenant-bound before row-ID union/uniqueness.
      const results = await Promise.all(['meter_point_id', 'metering_point_id', 'site_facility_id', 'ediel_reference']
        .map(column => pointQuery().eq(column, physicalPoint).limit(5)))
      const error = results.find(result => result.error)?.error
      if (error) throw error
      rows = [...new Map(results.flatMap(result => result.data ?? [])
        .map(row => [row.id, row as Record<string, unknown>])).values()]
    }
    const match = singleOrAmbiguous('metering_point', rows, ['Egen fysisk Z02 L/LK LIN/209 matchas utan original RFF LI som mätpunktsalternativ.'])
    await insertAttempt({ ...input, matchType: 'metering_point', match })
    return match
  }

  const candidates = Array.from(new Set([
    input.parsed.locations['172']?.[0] ?? null,
    firstReference(input.parsed, ['Z07', 'MG', 'TN']),
    input.parsed.references.LI?.[0] ?? null,
  ].filter((value): value is string => Boolean(value))))

  if (candidates.length === 0) {
    const match = { status: 'missing', entityType: null, entityId: null, confidence: 0, reasons: ['Ingen canonical LOC+172/anläggnings-/mätpunktsreferens hittades.'], candidates: [] } satisfies InboundEntityMatch
    await insertAttempt({ ...input, matchType: 'metering_point', match })
    return match
  }

  const ors = candidates.flatMap((candidate) => [
    `meter_point_id.eq.${candidate}`,
    `metering_point_id.eq.${candidate}`,
    `site_facility_id.eq.${candidate}`,
    `ediel_reference.eq.${candidate}`,
  ])

  const { data, error } = await supabaseService
    .from('metering_points')
    .select('id, company_id, customer_id, site_id, grid_owner_id, meter_point_id, metering_point_id, site_facility_id, ediel_reference')
    .eq('company_id', input.companyId)
    .or(ors.join(','))
    .limit(5)

  if (error) throw error

  const match = singleOrAmbiguous('metering_point', (data ?? []) as Array<Record<string, unknown>>, [`Canonical mätpunktsreferenser testade: ${candidates.join(', ')}`])
  await insertAttempt({ ...input, matchType: 'metering_point', match })
  return match
}
