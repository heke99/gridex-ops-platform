import { supabaseService } from '@/lib/supabase/service'
import { normalizeGridOwnerIdToOps } from '@/lib/grid-owners/platformGridOwnerResolver'

type JsonRecord = Record<string, unknown>

export const MIN_SVK_POSTAL_GRID_OWNER_CONFIDENCE = 0.65
const MAX_POSTAL_CANDIDATES = 100
const SVK_POSTAL_MATERIALIZATION_METHOD = 'postal_polygon_grid_area_intersection'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizePostalCode(value: unknown): string | null {
  const digits = clean(value)?.replace(/\D/g, '') ?? ''
  return /^\d{5}$/.test(digits) ? digits : null
}

function normalizeCity(value: unknown): string | null {
  const city = clean(value)
  return city
    ? city.normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/\s+/g, ' ').trim()
    : null
}

function normalizePriceArea(value: unknown): string | null {
  const normalized = clean(value)?.toUpperCase() ?? null
  return normalized && /^SE[1-4]$/.test(normalized) ? normalized : null
}

function normalizeGridAreaCode(value: unknown): string | null {
  return clean(value)?.replace(/\s+/g, '').toUpperCase() ?? null
}

function confidenceValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0
}

function metadataOf(row: JsonRecord): JsonRecord {
  return row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata as JsonRecord
    : {}
}

export type SvkPostalGridOwnerVerificationStatus =
  | 'verified'
  | 'invalid_postal_code'
  | 'no_mapping'
  | 'ambiguous'
  | 'confidence_low'
  | 'master_missing'
  | 'price_area_conflict'
  | 'grid_owner_unmapped'

export type SvkPostalGridOwnerVerificationResult = {
  status: SvkPostalGridOwnerVerificationStatus
  confidence: number
  postalCode: string | null
  cityScope: 'exact_city' | 'postal_code' | null
  candidateCount: number
  uniqueGridAreaCount: number
  gridAreaCode: string | null
  gridAreaName: string | null
  gridOwnerId: string | null
  gridOwnerName: string | null
  priceArea: string | null
  sourceVersion: string | null
  evidence: JsonRecord
}

function unresolved(
  status: Exclude<SvkPostalGridOwnerVerificationStatus, 'verified'>,
  patch: Partial<SvkPostalGridOwnerVerificationResult> = {},
): SvkPostalGridOwnerVerificationResult {
  return {
    status,
    confidence: 0,
    postalCode: null,
    cityScope: null,
    candidateCount: 0,
    uniqueGridAreaCount: 0,
    gridAreaCode: null,
    gridAreaName: null,
    gridOwnerId: null,
    gridOwnerName: null,
    priceArea: null,
    sourceVersion: null,
    evidence: {},
    ...patch,
  }
}

/**
 * Geographical grid-owner verification from postcode masterdata only.
 *
 * Only rows explicitly materialized by postcode polygon × canonical SVK
 * grid-area geometry are authoritative here. Learned customer-site mappings
 * and Papilite centroid rows are intentionally excluded from owner identity.
 * A unique grid-area candidate with overlap strictly above 65% is sufficient
 * to establish the geographical grid owner. Operational Ediel/PRODAT readiness
 * is deliberately separate.
 *
 * Ambiguous or low-confidence matches remain unresolved so OPS can use an
 * exact Lantmäteriet address point and then match that point against the same
 * SVK grid-area geometry.
 */
export async function verifyUniqueSvkPostalGridOwner(input: {
  companyId: string
  postalCode?: string | null
  city?: string | null
  currentPriceArea?: string | null
}): Promise<SvkPostalGridOwnerVerificationResult> {
  const postalCode = normalizePostalCode(input.postalCode)
  if (!postalCode) return unresolved('invalid_postal_code', { postalCode })

  const response = await supabaseService
    .from('platform_postal_code_grid_mappings')
    .select('postal_code,city,grid_area_code,price_area,confidence,source,updated_at,metadata', { count: 'exact' })
    .eq('postal_code', postalCode)
    .eq('is_active', true)
    .order('confidence', { ascending: false })
    .limit(MAX_POSTAL_CANDIDATES)
  if (response.error) throw response.error

  const allRows = (response.data ?? []) as JsonRecord[]
  if (allRows.length === 0) return unresolved('no_mapping', { postalCode })
  const candidateLimitExceeded = typeof response.count === 'number' && response.count > allRows.length

  const svkRows = allRows.filter((row) => clean(metadataOf(row).materialization_method) === SVK_POSTAL_MATERIALIZATION_METHOD)
  if (svkRows.length === 0) {
    return unresolved('no_mapping', {
      postalCode,
      evidence: {
        authority: 'svk_grid_area_geometry',
        method: SVK_POSTAL_MATERIALIZATION_METHOD,
        active_non_svk_mapping_count: allRows.length,
      },
    })
  }

  const requestedCity = normalizeCity(input.city)
  const exactCityRows = requestedCity
    ? svkRows.filter((row) => normalizeCity(row.city) === requestedCity)
    : []
  const candidates = exactCityRows.length > 0 ? exactCityRows : svkRows
  const cityScope = exactCityRows.length > 0 ? 'exact_city' as const : 'postal_code' as const

  const gridAreaCodes = [...new Set(
    candidates
      .map((row) => normalizeGridAreaCode(row.grid_area_code))
      .filter((value): value is string => Boolean(value)),
  )]
  const priceAreas = [...new Set(
    candidates
      .map((row) => normalizePriceArea(row.price_area))
      .filter((value): value is string => Boolean(value)),
  )]
  const confidence = candidates.reduce((max, row) => Math.max(max, confidenceValue(row.confidence)), 0)
  const sourceVersion = candidates
    .map((row) => clean(metadataOf(row).source_version) ?? clean(row.updated_at))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null
  const evidence: JsonRecord = {
    authority: 'svk_grid_area_geometry',
    method: SVK_POSTAL_MATERIALIZATION_METHOD,
    postal_code: postalCode,
    requested_city: clean(input.city),
    city_scope: cityScope,
    candidate_count: candidates.length,
    total_active_mapping_count: response.count ?? allRows.length,
    svk_materialized_mapping_count: svkRows.length,
    candidate_limit_exceeded: candidateLimitExceeded,
    grid_area_codes: gridAreaCodes,
    price_areas: priceAreas,
    sources: [...new Set(candidates.map((row) => clean(row.source)).filter(Boolean))],
    confidence_threshold: MIN_SVK_POSTAL_GRID_OWNER_CONFIDENCE,
  }

  if (candidateLimitExceeded || gridAreaCodes.length !== 1 || priceAreas.length > 1) {
    return unresolved('ambiguous', {
      postalCode,
      cityScope,
      confidence,
      candidateCount: candidates.length,
      uniqueGridAreaCount: gridAreaCodes.length,
      priceArea: priceAreas.length === 1 ? priceAreas[0] : null,
      sourceVersion,
      evidence,
    })
  }

  const gridAreaCode = gridAreaCodes[0]
  if (confidence <= MIN_SVK_POSTAL_GRID_OWNER_CONFIDENCE) {
    return unresolved('confidence_low', {
      postalCode,
      cityScope,
      confidence,
      candidateCount: candidates.length,
      uniqueGridAreaCount: 1,
      gridAreaCode,
      priceArea: priceAreas[0] ?? null,
      sourceVersion,
      evidence,
    })
  }

  const master = await supabaseService
    .from('platform_grid_areas')
    .select('grid_area_code,grid_area_name,grid_owner_id,grid_owner_name,price_area,platform_grid_owners(name,ops_grid_owner_id)')
    .eq('grid_area_code', gridAreaCode)
    .eq('is_active', true)
    .maybeSingle()
  if (master.error) throw master.error
  if (!master.data) {
    return unresolved('master_missing', {
      postalCode,
      cityScope,
      confidence,
      candidateCount: candidates.length,
      uniqueGridAreaCount: 1,
      gridAreaCode,
      priceArea: priceAreas[0] ?? null,
      sourceVersion,
      evidence,
    })
  }

  const masterRow = master.data as unknown as JsonRecord
  const relation = masterRow.platform_grid_owners as { name?: string | null; ops_grid_owner_id?: string | null } | null | undefined
  const masterPriceArea = normalizePriceArea(masterRow.price_area)
  const mappedPriceArea = priceAreas[0] ?? null
  const currentPriceArea = normalizePriceArea(input.currentPriceArea)
  if (
    (mappedPriceArea && masterPriceArea && mappedPriceArea !== masterPriceArea) ||
    (currentPriceArea && masterPriceArea && currentPriceArea !== masterPriceArea)
  ) {
    return unresolved('price_area_conflict', {
      postalCode,
      cityScope,
      confidence,
      candidateCount: candidates.length,
      uniqueGridAreaCount: 1,
      gridAreaCode,
      gridAreaName: clean(masterRow.grid_area_name),
      priceArea: masterPriceArea ?? mappedPriceArea,
      sourceVersion,
      evidence: {
        ...evidence,
        mapped_price_area: mappedPriceArea,
        master_price_area: masterPriceArea,
        current_price_area: currentPriceArea,
      },
    })
  }

  let opsGridOwnerId = clean(relation?.ops_grid_owner_id)
  if (!opsGridOwnerId) {
    const normalized = await normalizeGridOwnerIdToOps({
      gridOwnerId: clean(masterRow.grid_owner_id),
      companyId: input.companyId,
    })
    opsGridOwnerId = normalized.opsGridOwnerId
  }
  if (!opsGridOwnerId) {
    return unresolved('grid_owner_unmapped', {
      postalCode,
      cityScope,
      confidence,
      candidateCount: candidates.length,
      uniqueGridAreaCount: 1,
      gridAreaCode,
      gridAreaName: clean(masterRow.grid_area_name),
      priceArea: masterPriceArea ?? mappedPriceArea,
      sourceVersion,
      evidence,
    })
  }

  return {
    status: 'verified',
    confidence,
    postalCode,
    cityScope,
    candidateCount: candidates.length,
    uniqueGridAreaCount: 1,
    gridAreaCode,
    gridAreaName: clean(masterRow.grid_area_name),
    gridOwnerId: opsGridOwnerId,
    gridOwnerName: clean(relation?.name) ?? clean(masterRow.grid_owner_name),
    priceArea: masterPriceArea ?? mappedPriceArea,
    sourceVersion,
    evidence: {
      ...evidence,
      canonical: true,
      grid_area_code: gridAreaCode,
      grid_owner_id: opsGridOwnerId,
      grid_owner_name: clean(relation?.name) ?? clean(masterRow.grid_owner_name),
      price_area: masterPriceArea ?? mappedPriceArea,
    },
  }
}

export async function applyUniqueSvkPostalGridOwnerToSite(input: {
  companyId: string
  customerId: string
  siteId: string
  postalCode?: string | null
  city?: string | null
  currentPriceArea?: string | null
  metadata?: JsonRecord | null
}): Promise<SvkPostalGridOwnerVerificationResult> {
  const verification = await verifyUniqueSvkPostalGridOwner(input)
  if (verification.status !== 'verified' || !verification.gridOwnerId || !verification.gridAreaCode) {
    return verification
  }

  const now = new Date().toISOString()
  const update = await supabaseService
    .from('customer_sites')
    .update({
      grid_owner_id: verification.gridOwnerId,
      selected_grid_owner_id: verification.gridOwnerId,
      grid_area_code: verification.gridAreaCode,
      price_area_code: verification.priceArea ?? normalizePriceArea(input.currentPriceArea),
      resolution_status: 'grid_area_master_validated',
      resolution_confidence: verification.confidence,
      metadata: {
        ...(input.metadata ?? {}),
        svk_postal_grid_owner_verification: {
          ...verification.evidence,
          verified_at: now,
          purpose: 'canonical_geographic_grid_owner',
          operational_route_verification_required_separately: true,
        },
      },
      updated_at: now,
    })
    .eq('id', input.siteId)
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .is('grid_owner_id', null)
    .select('id,grid_owner_id,grid_area_code')
  if (update.error) throw update.error

  if (!update.data?.length) {
    const existing = await supabaseService
      .from('customer_sites')
      .select('grid_owner_id,grid_area_code')
      .eq('id', input.siteId)
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .maybeSingle()
    if (existing.error) throw existing.error
    if (
      clean(existing.data?.grid_owner_id) === verification.gridOwnerId &&
      normalizeGridAreaCode(existing.data?.grid_area_code) === verification.gridAreaCode
    ) {
      return verification
    }
    return unresolved('ambiguous', {
      ...verification,
      status: 'ambiguous',
      evidence: { ...verification.evidence, concurrent_site_update: true },
    })
  }

  return verification
}
