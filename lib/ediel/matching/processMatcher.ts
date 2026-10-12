import { supabaseService } from '@/lib/supabase/service'
import type { EdielMatchCandidate, EdielMatchInput } from '@/lib/ediel/matching/matchingTypes'
import { cleanMatchText, confidenceFromScore } from '@/lib/ediel/matching/matchingTypes'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PostgREST quoted value: only `"` and `\` need escaping inside double quotes.
function quotePostgrestValue(value: string): string {
  return `"${value.replace(/["\\]/g, (ch) => `\\${ch}`)}"`
}

/**
 * Builds a PostgREST `or` list of equality conditions. Every value is quoted so
 * a sender-controlled reference cannot add conditions, and uuid columns only
 * receive UUID-shaped references (a non-UUID value there makes PostgREST
 * reject the whole query with 22P02). Returns '' when nothing is comparable.
 */
export function postgrestEqAny(textColumns: string[], uuidColumns: string[], refs: string[]): string {
  return refs.flatMap((ref) => [
    ...textColumns.map((column) => `${column}.eq.${quotePostgrestValue(ref)}`),
    ...(UUID_PATTERN.test(ref) ? uuidColumns.map((column) => `${column}.eq.${quotePostgrestValue(ref)}`) : []),
  ]).join(',')
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => cleanMatchText(value)).filter((value): value is string => Boolean(value)))]
}

function refsFromInput(input: EdielMatchInput): string[] {
  const parsed = input.message.parsed_payload ?? {}
  const validation = input.message.validation_report ?? {}
  const parsedRecord = parsed as Record<string, unknown>
  const validationRecord = validation as Record<string, unknown>
  return unique([
    input.message.switch_request_id,
    input.message.grid_owner_data_request_id,
    input.message.outbound_request_id,
    input.message.original_message_id,
    input.message.correlation_reference,
    input.message.external_reference,
    input.message.transaction_reference,
    parsedRecord.grid_owner_information_request_id as string | null,
    parsedRecord.customer_info_request_id as string | null,
    parsedRecord.grid_owner_data_request_id as string | null,
    parsedRecord.outbound_request_id as string | null,
    validationRecord.grid_owner_information_request_id as string | null,
    validationRecord.customer_info_request_id as string | null,
    validationRecord.grid_owner_data_request_id as string | null,
  ])
}

function addCandidate(candidates: EdielMatchCandidate[], input: {
  entityId: string | null
  score: number
  reason: string
  details: Record<string, unknown>
}) {
  candidates.push({
    entityType: 'process',
    entityId: input.entityId,
    confidence: confidenceFromScore(input.score),
    score: input.score,
    reason: input.reason,
    details: input.details,
  })
}

export async function matchProcessForAutomation(input: EdielMatchInput): Promise<EdielMatchCandidate[]> {
  const refs = refsFromInput(input)
  const companyId = input.companyId ?? input.message.company_id ?? null
  const candidates: EdielMatchCandidate[] = []

  if (input.message.switch_request_id) {
    addCandidate(candidates, {
      entityId: input.message.switch_request_id,
      score: 190,
      reason: 'message_already_linked_to_supplier_switch',
      details: { processType: 'supplier_switch' },
    })
  }

  if (input.message.grid_owner_data_request_id) {
    addCandidate(candidates, {
      entityId: input.message.grid_owner_data_request_id,
      score: 175,
      reason: 'message_already_linked_to_grid_owner_data_request',
      details: { processType: 'grid_owner_data_request' },
    })
  }

  if (refs.length === 0 && !input.message.site_id && !input.message.grid_owner_id) return candidates
  // Process lookups by reference must stay inside one tenant.
  if (!companyId) return candidates

  if (refs.length > 0) {
    let switchQuery = supabaseService
      .from('supplier_switch_requests')
      .select('id, company_id, customer_id, site_id, metering_point_id, status, external_reference, automation_key')
      .limit(20)
    if (companyId) switchQuery = switchQuery.eq('company_id', companyId)
    switchQuery = switchQuery.or(postgrestEqAny(['external_reference', 'automation_key'], ['id'], refs))
    const { data, error } = await switchQuery
    if (error) throw error
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const exact = refs.includes(cleanMatchText(row.id) ?? '') || refs.includes(cleanMatchText(row.external_reference) ?? '')
      addCandidate(candidates, {
        entityId: cleanMatchText(row.id),
        score: exact ? 165 : 100,
        reason: exact ? 'supplier_switch_reference_exact' : 'supplier_switch_candidate',
        details: {
          processType: 'supplier_switch',
          companyId: row.company_id,
          customerId: row.customer_id,
          siteId: row.site_id,
          meteringPointId: row.metering_point_id,
          status: row.status,
        },
      })
    }
  }

  if (refs.length > 0) {
    let facilityQuery = supabaseService
      .from('grid_owner_information_requests')
      .select('id, company_id, customer_id, customer_site_id, grid_owner_id, status, request_type, metadata, received_payload')
      .eq('request_type', 'facility_lookup')
      .limit(50)
    if (companyId) facilityQuery = facilityQuery.eq('company_id', companyId)
    const { data, error } = await facilityQuery
    if (!error) {
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const haystack = JSON.stringify(row)
        const exactId = refs.includes(cleanMatchText(row.id) ?? '')
        const payloadMatch = refs.some((ref) => haystack.includes(ref))
        if (!exactId && !payloadMatch) continue
        addCandidate(candidates, {
          entityId: cleanMatchText(row.id),
          score: exactId ? 175 : 145,
          reason: exactId ? 'facility_lookup_reference_exact' : 'facility_lookup_payload_reference',
          details: {
            processType: 'facility_lookup',
            companyId: row.company_id,
            customerId: row.customer_id,
            siteId: row.customer_site_id,
            gridOwnerId: row.grid_owner_id,
            status: row.status,
          },
        })
      }
    }
  }

  if (refs.length > 0) {
    let customerInfoQuery = supabaseService
      .from('customer_info_requests')
      .select('id, company_id, customer_id, site_id, grid_owner_data_request_id, outbound_request_id, status, request_type, external_reference, transaction_reference, correlation_reference')
      .limit(50)
    if (companyId) customerInfoQuery = customerInfoQuery.eq('company_id', companyId)
    customerInfoQuery = customerInfoQuery.or(postgrestEqAny(['external_reference', 'transaction_reference', 'correlation_reference'],
      ['id', 'grid_owner_data_request_id', 'outbound_request_id'], refs))
    const { data, error } = await customerInfoQuery
    if (!error) {
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        addCandidate(candidates, {
          entityId: cleanMatchText(row.id),
          score: 150,
          reason: 'customer_info_request_reference',
          details: {
            processType: 'customer_info_request',
            companyId: row.company_id,
            customerId: row.customer_id,
            siteId: row.site_id,
            status: row.status,
            requestType: row.request_type,
          },
        })
      }
    }
  }

  if (input.message.site_id || input.message.grid_owner_id) {
    let facilityContextQuery = supabaseService
      .from('grid_owner_information_requests')
      .select('id, company_id, customer_id, customer_site_id, grid_owner_id, status, request_type')
      .eq('request_type', 'facility_lookup')
      .in('status', ['draft', 'ready_to_send', 'sent', 'waiting_response', 'needs_review'])
      .limit(20)
    if (companyId) facilityContextQuery = facilityContextQuery.eq('company_id', companyId)
    if (input.message.site_id) facilityContextQuery = facilityContextQuery.eq('customer_site_id', input.message.site_id)
    if (input.message.grid_owner_id) facilityContextQuery = facilityContextQuery.eq('grid_owner_id', input.message.grid_owner_id)
    const { data, error } = await facilityContextQuery
    if (!error) {
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        addCandidate(candidates, {
          entityId: cleanMatchText(row.id),
          score: input.message.site_id ? 142 : 90,
          reason: input.message.site_id ? 'facility_lookup_site_context' : 'facility_lookup_grid_owner_context_manual_review',
          details: {
            processType: 'facility_lookup',
            companyId: row.company_id,
            customerId: row.customer_id,
            siteId: row.customer_site_id,
            gridOwnerId: row.grid_owner_id,
            status: row.status,
            autoCompleteAllowed: Boolean(input.message.site_id),
          },
        })
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}
