import { parseCanonicalMessageRow } from '@/lib/ediel/core/canonicalMessage'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMatchCandidate, EdielMatchInput } from '@/lib/ediel/matching/matchingTypes'
import { cleanMatchText, confidenceFromScore } from '@/lib/ediel/matching/matchingTypes'

export async function matchPermissionForAutomation(input: EdielMatchInput): Promise<EdielMatchCandidate[]> {
  const canonical = parseCanonicalMessageRow(input.message)
  const permissionId = cleanMatchText(canonical.permissionId)
  if (!permissionId) return []

  // Never search another tenant's permissions when the company is unresolved.
  const companyId = input.companyId ?? input.message.company_id ?? null
  if (!companyId) return []

  let query = supabaseService
    .from('ediel_permissions')
    .select('id, company_id, permission_reference, external_permission_id, metering_point_id, customer_id, site_id, status, valid_from, valid_to')
    .eq('company_id', companyId)
    .limit(20)

  // National RFF+Z09 values are text references, not necessarily row UUIDs.
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(permissionId)
  query = query.or([`permission_reference.eq.${permissionId}`, `external_permission_id.eq.${permissionId}`,
    ...(uuid ? [`id.eq.${permissionId}`] : [])].join(','))

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
