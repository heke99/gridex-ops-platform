import { parseCanonicalMessageRow } from '@/lib/ediel/core/canonicalMessage'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMatchCandidate, EdielMatchInput } from '@/lib/ediel/matching/matchingTypes'
import { cleanMatchText, confidenceFromScore, upperMatchText } from '@/lib/ediel/matching/matchingTypes'

function normalizeDigits(value: string | null): string | null {
  if (!value) return null
  const normalized = value.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  return normalized.length > 0 ? normalized : null
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => cleanMatchText(value)).filter((value): value is string => Boolean(value)))]
}

export async function matchMeteringPointForAutomation(input: EdielMatchInput): Promise<EdielMatchCandidate[]> {
  const canonical = parseCanonicalMessageRow(input.message)
  const values = unique([
    input.message.metering_point_id,
    input.message.external_reference,
    input.message.transaction_reference,
    canonical.meteringPointId,
    canonical.facilityId,
    canonical.references.find((reference) => upperMatchText(reference.qualifier) === 'Z07')?.value,
    canonical.references.find((reference) => upperMatchText(reference.qualifier) === 'LI')?.value,
  ])

  const normalizedValues = unique(values.map(normalizeDigits))
  if (values.length === 0 && normalizedValues.length === 0) return []

  let query = supabaseService
    .from('metering_points')
    .select('id, company_id, customer_id, site_id, grid_owner_id, meter_point_id, metering_point_id, normalized_metering_point_id, site_facility_id, ediel_reference, status')
    .limit(20)

  if (input.companyId ?? input.message.company_id) {
    query = query.eq('company_id', input.companyId ?? input.message.company_id)
  }

  const filters: string[] = []
  for (const value of values) {
    const escaped = value.replace(/"/g, '\\"')
    filters.push(`meter_point_id.eq.${escaped}`)
    filters.push(`metering_point_id.eq.${escaped}`)
    filters.push(`site_facility_id.eq.${escaped}`)
    filters.push(`ediel_reference.eq.${escaped}`)
  }
  for (const value of normalizedValues) {
    const escaped = value.replace(/"/g, '\\"')
    filters.push(`normalized_metering_point_id.eq.${escaped}`)
  }

  if (filters.length > 0) query = query.or(filters.join(','))

  const { data, error } = await query
  if (error) throw error

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const directId = values.some((value) => [row.meter_point_id, row.metering_point_id, row.site_facility_id, row.ediel_reference].map(cleanMatchText).includes(value))
    const normalizedId = normalizedValues.some((value) => cleanMatchText(row.normalized_metering_point_id) === value)
    const score = directId ? 170 : normalizedId ? 150 : 90
    return {
      entityType: 'metering_point',
      entityId: cleanMatchText(row.id),
      confidence: confidenceFromScore(score),
      score,
      reason: directId ? 'metering_point_exact_identifier' : normalizedId ? 'metering_point_normalized_identifier' : 'metering_point_candidate',
      details: {
        companyId: row.company_id,
        customerId: row.customer_id,
        siteId: row.site_id,
        gridOwnerId: row.grid_owner_id,
        status: row.status,
        searchedValues: values,
        normalizedValues,
      },
    } satisfies EdielMatchCandidate
  })
}
