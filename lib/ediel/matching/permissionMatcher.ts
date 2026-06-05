import { parseCanonicalMessageRow } from '@/lib/ediel/core/canonicalMessage'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMatchCandidate, EdielMatchInput } from '@/lib/ediel/matching/matchingTypes'
import { cleanMatchText, confidenceFromScore } from '@/lib/ediel/matching/matchingTypes'

export async function matchPermissionForAutomation(input: EdielMatchInput): Promise<EdielMatchCandidate[]> {
  const canonical = parseCanonicalMessageRow(input.message)
  const permissionId = cleanMatchText(canonical.permissionId)
  if (!permissionId) return []

  let query = supabaseService
    .from('ediel_permissions')
    .select('id, company_id, permission_reference, external_permission_id, metering_point_id, customer_id, site_id, status, valid_from, valid_to')
    .limit(20)

  if (input.companyId ?? input.message.company_id) {
    query = query.eq('company_id', input.companyId ?? input.message.company_id)
  }

  query = query.or(`permission_reference.eq.${permissionId},external_permission_id.eq.${permissionId},id.eq.${permissionId}`)

  const { data, error } = await query
  if (error) throw error

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const score = cleanMatchText(row.permission_reference) === permissionId || cleanMatchText(row.external_permission_id) === permissionId ? 175 : 120
    return {
      entityType: 'permission',
      entityId: cleanMatchText(row.id),
      confidence: confidenceFromScore(score),
      score,
      reason: score >= 175 ? 'permission_reference_exact' : 'permission_candidate',
      details: {
        companyId: row.company_id,
        permissionReference: row.permission_reference,
        externalPermissionId: row.external_permission_id,
        meteringPointId: row.metering_point_id,
        customerId: row.customer_id,
        siteId: row.site_id,
        status: row.status,
      },
    } satisfies EdielMatchCandidate
  })
}
