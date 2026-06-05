import { supabaseService } from '@/lib/supabase/service'
import type { EdielMatchCandidate, EdielMatchInput } from '@/lib/ediel/matching/matchingTypes'
import { cleanMatchText, confidenceFromScore } from '@/lib/ediel/matching/matchingTypes'

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => cleanMatchText(value)).filter((value): value is string => Boolean(value)))]
}

export async function matchProcessForAutomation(input: EdielMatchInput): Promise<EdielMatchCandidate[]> {
  const refs = unique([
    input.message.switch_request_id,
    input.message.grid_owner_data_request_id,
    input.message.outbound_request_id,
    input.message.original_message_id,
    input.message.correlation_reference,
    input.message.external_reference,
    input.message.transaction_reference,
  ])

  const candidates: EdielMatchCandidate[] = []

  if (input.message.switch_request_id) {
    candidates.push({
      entityType: 'process',
      entityId: input.message.switch_request_id,
      confidence: 'high',
      score: 190,
      reason: 'message_already_linked_to_supplier_switch',
      details: { processType: 'supplier_switch' },
    })
  }

  if (refs.length === 0) return candidates

  let query = supabaseService
    .from('supplier_switch_requests')
    .select('id, company_id, customer_id, site_id, metering_point_id, status, external_reference, automation_key')
    .limit(20)

  if (input.companyId ?? input.message.company_id) {
    query = query.eq('company_id', input.companyId ?? input.message.company_id)
  }

  const filters = refs.flatMap((ref) => [`id.eq.${ref}`, `external_reference.eq.${ref}`, `automation_key.eq.${ref}`])
  query = query.or(filters.join(','))

  const { data, error } = await query
  if (error) throw error

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const exact = refs.includes(cleanMatchText(row.id) ?? '') || refs.includes(cleanMatchText(row.external_reference) ?? '')
    const score = exact ? 165 : 100
    candidates.push({
      entityType: 'process',
      entityId: cleanMatchText(row.id),
      confidence: confidenceFromScore(score),
      score,
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

  return candidates
}
