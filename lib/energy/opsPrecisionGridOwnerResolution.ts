import { supabaseService } from '@/lib/supabase/service'
import { normalizeGridOwnerIdToOps } from '@/lib/grid-owners/platformGridOwnerResolver'

type JsonRecord = Record<string, unknown>

type Centroid = {
  latitude: number
  longitude: number
  postalCode: string
  city: string | null
  source: 'cache' | 'papilite'
}

export const DEFAULT_OPS_PAPILITE_GRID_OWNER_MIN_CONFIDENCE = 0.95
const PAPILITE_DEFAULT_URL = 'https://api.papapi.se/lite/'
const PAPILITE_CACHE_TTL_DAYS = 90
const REQUEST_TIMEOUT_MS = 8_000
const DEFAULT_GEODATA_MAX_AGE_DAYS = 30

export type OpsPapilitePrecisionStatus =
  | 'verified'
  | 'invalid_postal_code'
  | 'papilite_not_configured'
  | 'papilite_no_match'
  | 'papilite_invalid_response'
  | 'papilite_unavailable'
  | 'svk_no_match'
  | 'svk_confidence_low'
  | 'svk_geodata_stale'
  | 'grid_owner_unmapped'
  | 'price_area_conflict'
  | 'concurrent_site_update'

export type OpsPapilitePrecisionResult = {
  status: OpsPapilitePrecisionStatus
  confidence: number
  minConfidence: number
  gridOwnerId: string | null
  gridOwnerName: string | null
  gridAreaCode: string | null
  gridAreaName: string | null
  priceArea: string | null
  resolutionId: string | null
  geodataVersion: string | null
  centroidSource: Centroid['source'] | null
  evidence: JsonRecord
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function postalCode(value: unknown): string | null {
  const digits = clean(value)?.replace(/\D/g, '') ?? ''
  return /^\d{5}$/.test(digits) ? digits : null
}

function priceArea(value: unknown): string | null {
  const normalized = clean(value)?.toUpperCase() ?? null
  return normalized && /^SE[1-4]$/.test(normalized) ? normalized : null
}

function confidenceThreshold() {
  const configured = Number(process.env.OPS_PAPILITE_GRID_OWNER_MIN_CONFIDENCE ?? DEFAULT_OPS_PAPILITE_GRID_OWNER_MIN_CONFIDENCE)
  return Number.isFinite(configured)
    ? Math.min(Math.max(configured, 0.9), 0.99)
    : DEFAULT_OPS_PAPILITE_GRID_OWNER_MIN_CONFIDENCE
}

function unresolved(
  status: Exclude<OpsPapilitePrecisionStatus, 'verified'>,
  patch: Partial<OpsPapilitePrecisionResult> = {},
): OpsPapilitePrecisionResult {
  return {
    status,
    confidence: 0,
    minConfidence: confidenceThreshold(),
    gridOwnerId: null,
    gridOwnerName: null,
    gridAreaCode: null,
    gridAreaName: null,
    priceArea: null,
    resolutionId: null,
    geodataVersion: null,
    centroidSource: null,
    evidence: {},
    ...patch,
  }
}

function cacheKey(postal: string, country = 'SE') {
  return `postal_centroid|${country.toUpperCase()}|${postal}`
}

function firstCandidate(payload: unknown): JsonRecord | null {
  if (Array.isArray(payload)) return payload[0] && typeof payload[0] === 'object' ? payload[0] as JsonRecord : null
  const root = record(payload)
  for (const key of ['results', 'data', 'items', 'features']) {
    const value = root[key]
    if (Array.isArray(value) && value[0] && typeof value[0] === 'object') return value[0] as JsonRecord
  }
  return Object.keys(root).length ? root : null
}

function candidateRecords(candidate: JsonRecord): JsonRecord[] {
  return [candidate, record(candidate.properties), record(candidate.attributes)]
}

function firstValue(rows: JsonRecord[], keys: string[]) {
  for (const row of rows) {
    for (const key of keys) {
      const value = row[key]
      if (value !== undefined && value !== null && value !== '') return value
    }
  }
  return null
}

async function readCachedCentroid(postal: string, country: string): Promise<Centroid | null> {
  const { data, error } = await supabaseService
    .from('platform_address_lookup_cache')
    .select('postal_code,city,latitude,longitude,provider,raw_payload,expires_at')
    .eq('address_key', cacheKey(postal, country))
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .maybeSingle()
  if (error) throw error
  if (!data || clean(data.provider) !== 'papilite_postal_centroid') return null
  const latitude = numberValue(data.latitude)
  const longitude = numberValue(data.longitude)
  const raw = record(data.raw_payload)
  if (latitude === null || longitude === null || raw.coordinate_scope !== 'postal_centroid') return null
  return {
    latitude,
    longitude,
    postalCode: postalCode(data.postal_code) ?? postal,
    city: clean(data.city),
    source: 'cache',
  }
}

async function fetchPapiliteCentroid(postal: string, city: string | null, country: string): Promise<Centroid | null> {
  const apiKey = clean(process.env.PAPILITE_API_KEY)
  if (!apiKey) return null
  const baseUrl = clean(process.env.PAPILITE_GEOCODE_URL) ?? PAPILITE_DEFAULT_URL
  const endpoint = new URL(baseUrl)
  endpoint.searchParams.set('query', postal)
  endpoint.searchParams.set('format', 'json')
  endpoint.searchParams.set('country', country.toLowerCase())
  endpoint.searchParams.set('apikey', apiKey)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(endpoint.toString(), {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) return null
    const payload = await response.json().catch(() => null) as unknown
    const candidate = firstCandidate(payload)
    if (!candidate) return null
    const rows = candidateRecords(candidate)
    const candidatePostal = postalCode(firstValue(rows, ['postal_code', 'postcode', 'zip_code', 'zip']))
    if (candidatePostal && candidatePostal !== postal) return null
    const latitude = numberValue(firstValue(rows, ['latitude', 'lat']))
    const longitude = numberValue(firstValue(rows, ['longitude', 'lng', 'lon']))
    if (latitude === null || longitude === null) return null
    if (latitude < 54 || latitude > 70 || longitude < 10 || longitude > 25) return null

    const resolvedCity = clean(firstValue(rows, ['city', 'postort', 'postal_town'])) ?? city
    const now = new Date()
    const { error } = await supabaseService
      .from('platform_address_lookup_cache')
      .upsert({
        address_key: cacheKey(postal, country),
        street: null,
        postal_code: postal,
        city: resolvedCity,
        country,
        latitude,
        longitude,
        sweref99_x: null,
        sweref99_y: null,
        provider: 'papilite_postal_centroid',
        confidence: 0.7,
        raw_payload: {
          coordinate_scope: 'postal_centroid',
          provider: 'papilite',
          purpose: 'ops_precision_candidate',
        },
        expires_at: new Date(now.getTime() + PAPILITE_CACHE_TTL_DAYS * 86_400_000).toISOString(),
        updated_at: now.toISOString(),
      }, { onConflict: 'address_key' })
    if (error) throw error

    return { latitude, longitude, postalCode: postal, city: resolvedCity, source: 'papilite' }
  } finally {
    clearTimeout(timeout)
  }
}

async function currentGeodata() {
  const maxAgeRaw = Number(process.env.ENERGY_GEODATA_MAX_AGE_DAYS ?? DEFAULT_GEODATA_MAX_AGE_DAYS)
  const maxAgeDays = Number.isFinite(maxAgeRaw) ? Math.min(Math.max(maxAgeRaw, 1), 365) : DEFAULT_GEODATA_MAX_AGE_DAYS
  const { data, error } = await supabaseService
    .from('energy_geodata_versions')
    .select('version_key,verified_at,completed_at,started_at')
    .eq('provider', 'svk_arcgis')
    .eq('status', 'verified')
    .order('verified_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const timestamp = clean(data?.verified_at) ?? clean(data?.completed_at) ?? clean(data?.started_at)
  const ageMs = timestamp ? Date.now() - Date.parse(timestamp) : Number.POSITIVE_INFINITY
  return {
    version: clean(data?.version_key),
    stale: !Number.isFinite(ageMs) || ageMs > maxAgeDays * 86_400_000,
    verifiedAt: timestamp,
  }
}

async function bindResolution(input: {
  companyId: string
  customerId: string
  siteId: string
  customerApplicationId?: string | null
  gridOwnerId: string
  gridOwnerName: string | null
  gridAreaCode: string
  gridAreaName: string | null
  priceArea: string
  confidence: number
  geodataVersion: string | null
  centroid: Centroid
  metadata?: JsonRecord | null
}) {
  const now = new Date()
  const sourceChain = ['ops_precision', 'papilite', 'postal_centroid', 'svk_arcgis_polygon', 'platform_grid_areas']
  const evidence = {
    purpose: 'canonical_geographic_grid_owner',
    precision_provider: 'papilite_postal_centroid',
    authority: 'svk_grid_area_geometry',
    grid_area_code: input.gridAreaCode,
    grid_owner_id: input.gridOwnerId,
    price_area: input.priceArea,
    confidence: input.confidence,
    confidence_threshold: confidenceThreshold(),
    geodata_version: input.geodataVersion,
    centroid: {
      postal_code: input.centroid.postalCode,
      source: input.centroid.source,
      coordinate_reference_system: 'EPSG:4326',
    },
    exact_address_point_materialized: false,
    operational_route_verification_required_separately: true,
  }

  const { data: resolution, error: insertError } = await supabaseService
    .from('customer_site_resolution')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      customer_site_id: input.siteId,
      customer_application_id: clean(input.customerApplicationId),
      grid_owner_id: input.gridOwnerId,
      grid_area_code: input.gridAreaCode,
      grid_area_name: input.gridAreaName,
      grid_owner_name: input.gridOwnerName,
      price_area: input.priceArea,
      price_area_assurance_status: 'estimated',
      price_area_assurance_source: 'postal_centroid',
      price_area_assurance_confidence: input.confidence,
      price_area_assurance_source_version: input.geodataVersion,
      price_area_candidate_count: 1,
      price_area_unique_count: 1,
      price_area_evidence: evidence,
      resolution_status: 'grid_area_master_validated',
      confidence: input.confidence,
      source_chain: sourceChain,
      input_snapshot: {
        postal_code: input.centroid.postalCode,
        city: input.centroid.city,
        resolution_mode: 'ops_papilite_first_precision',
      },
      result_snapshot: {
        gridAreaCode: input.gridAreaCode,
        gridAreaName: input.gridAreaName,
        gridOwnerId: input.gridOwnerId,
        gridOwnerName: input.gridOwnerName,
        priceArea: input.priceArea,
        precision_evidence: evidence,
      },
      automation_allowed: false,
      next_required_action: 'Begär anläggningsuppgifter från den geografiskt verifierade nätägaren. Ediel/PRODAT-readiness verifieras separat.',
      resolved_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      resolver_version: 'ops-precision-v1',
      geodata_version: input.geodataVersion,
      source_claims: {},
      conflict_code: null,
      updated_at: now.toISOString(),
    })
    .select('id')
    .single()
  if (insertError) throw insertError

  const resolutionId = clean(resolution?.id)
  if (!resolutionId) throw new Error('ops_precision_resolution_insert_missing_id')

  const { data: updated, error: updateError } = await supabaseService
    .from('customer_sites')
    .update({
      resolution_id: resolutionId,
      resolution_status: 'grid_area_master_validated',
      resolution_confidence: input.confidence,
      metadata: {
        ...(input.metadata ?? {}),
        ops_precision_resolution: {
          ...evidence,
          resolution_id: resolutionId,
          resolved_at: now.toISOString(),
        },
      },
      updated_at: now.toISOString(),
    })
    .eq('id', input.siteId)
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .is('grid_owner_id', null)
    .select('id,grid_owner_id,grid_area_code,price_area_code,resolution_id')
  if (updateError) throw updateError

  if (!updated?.length) {
    const { data: existing, error } = await supabaseService
      .from('customer_sites')
      .select('grid_owner_id,grid_area_code,price_area_code,resolution_id,metadata')
      .eq('id', input.siteId)
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .maybeSingle()
    if (error) throw error
    const existingOwner = clean(existing?.grid_owner_id)
    const existingArea = clean(existing?.grid_area_code)
    if (existingOwner === input.gridOwnerId && existingArea === input.gridAreaCode) {
      return clean(existing?.resolution_id) ?? resolutionId
    }

    // Matching owner with missing/stale grid_area_code cannot use the null-owner
    // filter. Rebind a fresh resolution under that owner so the materialization
    // guard can project canonical geography without writing selected_grid_owner_id.
    if (existingOwner === input.gridOwnerId) {
      const { data: reconciled, error: reconcileError } = await supabaseService
        .from('customer_sites')
        .update({
          resolution_id: resolutionId,
          resolution_status: 'grid_area_master_validated',
          resolution_confidence: input.confidence,
          metadata: {
            ...(input.metadata ?? record(existing?.metadata)),
            ops_precision_resolution: {
              ...evidence,
              resolution_id: resolutionId,
              resolved_at: now.toISOString(),
              incomplete_matching_owner_reconcile: true,
            },
          },
          updated_at: now.toISOString(),
        })
        .eq('id', input.siteId)
        .eq('company_id', input.companyId)
        .eq('customer_id', input.customerId)
        .eq('grid_owner_id', input.gridOwnerId)
        .select('id,grid_owner_id,grid_area_code,resolution_id')
      if (reconcileError) throw reconcileError
      if (reconciled?.length) return resolutionId
    }
    return null
  }

  return resolutionId
}

export async function resolveOpsPapiliteGridOwnerForSite(input: {
  companyId: string
  customerId: string
  siteId: string
  customerApplicationId?: string | null
  postalCode?: string | null
  city?: string | null
  country?: string | null
  currentPriceArea?: string | null
  metadata?: JsonRecord | null
}): Promise<OpsPapilitePrecisionResult> {
  const postal = postalCode(input.postalCode)
  if (!postal) return unresolved('invalid_postal_code')
  const minConfidence = confidenceThreshold()
  const country = (clean(input.country) ?? 'SE').toUpperCase()
  const city = clean(input.city)

  // Prefer a still-valid cached centroid before requiring PAPILITE_API_KEY so a
  // brief key outage does not discard previously verified postal precision.
  let centroid: Centroid | null
  try {
    const cached = await readCachedCentroid(postal, country)
    if (cached) {
      centroid = cached
    } else if (!clean(process.env.PAPILITE_API_KEY)) {
      return unresolved('papilite_not_configured', { minConfidence })
    } else {
      centroid = await fetchPapiliteCentroid(postal, city, country)
    }
  } catch (error) {
    return unresolved('papilite_unavailable', {
      minConfidence,
      evidence: { error: error instanceof Error ? error.message : String(error) },
    })
  }
  if (!centroid) return unresolved('papilite_no_match', { minConfidence })

  const geodata = await currentGeodata()
  if (geodata.stale) {
    return unresolved('svk_geodata_stale', {
      minConfidence,
      geodataVersion: geodata.version,
      centroidSource: centroid.source,
      evidence: { geodata_verified_at: geodata.verifiedAt },
    })
  }

  const { data, error } = await supabaseService.rpc('gridex_lonlat_to_grid_area', {
    p_longitude: centroid.longitude,
    p_latitude: centroid.latitude,
  })
  if (error) throw error
  const row = record(Array.isArray(data) ? data[0] : data)
  const gridAreaCode = clean(row.grid_area_code)
  const platformGridOwnerId = clean(row.grid_owner_id)
  const resolvedPriceArea = priceArea(row.price_area)
  const confidence = Math.max(0, Math.min(1, numberValue(row.confidence) ?? 0))
  if (!gridAreaCode || !platformGridOwnerId || !resolvedPriceArea) {
    return unresolved('svk_no_match', {
      confidence,
      minConfidence,
      geodataVersion: geodata.version,
      centroidSource: centroid.source,
    })
  }
  if (confidence < minConfidence) {
    return unresolved('svk_confidence_low', {
      confidence,
      minConfidence,
      gridAreaCode,
      gridAreaName: clean(row.grid_area_name),
      priceArea: resolvedPriceArea,
      geodataVersion: geodata.version,
      centroidSource: centroid.source,
      evidence: { fallback: 'lantmateriet_exact_address' },
    })
  }

  const currentPriceArea = priceArea(input.currentPriceArea)
  if (currentPriceArea && currentPriceArea !== resolvedPriceArea) {
    return unresolved('price_area_conflict', {
      confidence,
      minConfidence,
      gridAreaCode,
      gridAreaName: clean(row.grid_area_name),
      priceArea: resolvedPriceArea,
      geodataVersion: geodata.version,
      centroidSource: centroid.source,
      evidence: { current_price_area: currentPriceArea, papilite_svk_price_area: resolvedPriceArea },
    })
  }

  const normalized = await normalizeGridOwnerIdToOps({
    gridOwnerId: platformGridOwnerId,
    companyId: input.companyId,
  })
  const gridOwnerId = normalized.opsGridOwnerId
  if (!gridOwnerId) {
    return unresolved('grid_owner_unmapped', {
      confidence,
      minConfidence,
      gridAreaCode,
      gridAreaName: clean(row.grid_area_name),
      priceArea: resolvedPriceArea,
      geodataVersion: geodata.version,
      centroidSource: centroid.source,
    })
  }

  const resolutionId = await bindResolution({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
    customerApplicationId: input.customerApplicationId,
    gridOwnerId,
    gridOwnerName: clean(row.grid_owner_name),
    gridAreaCode,
    gridAreaName: clean(row.grid_area_name),
    priceArea: resolvedPriceArea,
    confidence,
    geodataVersion: geodata.version,
    centroid,
    metadata: input.metadata,
  })
  if (!resolutionId) {
    return unresolved('concurrent_site_update', {
      confidence,
      minConfidence,
      gridOwnerId,
      gridOwnerName: clean(row.grid_owner_name),
      gridAreaCode,
      gridAreaName: clean(row.grid_area_name),
      priceArea: resolvedPriceArea,
      geodataVersion: geodata.version,
      centroidSource: centroid.source,
    })
  }

  return {
    status: 'verified',
    confidence,
    minConfidence,
    gridOwnerId,
    gridOwnerName: clean(row.grid_owner_name),
    gridAreaCode,
    gridAreaName: clean(row.grid_area_name),
    priceArea: resolvedPriceArea,
    resolutionId,
    geodataVersion: geodata.version,
    centroidSource: centroid.source,
    evidence: {
      authority: 'svk_grid_area_geometry',
      precision_provider: 'papilite_postal_centroid',
      operational_route_verification_required_separately: true,
    },
  }
}
