import { supabaseService } from '@/lib/supabase/service'
import { normaliseSwedishAddress } from '@/lib/energy/address'
import type { EnergyResolverInput, EnergyResolverResult, PriceArea } from '@/lib/energy/types'
import {
  normalizePostalCode,
  normaliseGridAreaCode,
  resolveEnergyContext as resolveCoreEnergyContext,
  upsertPlatformGridAreaMasterRows,
} from './resolverCore'

export { normalizePostalCode, normaliseGridAreaCode, upsertPlatformGridAreaMasterRows }

const PAPILITE_DEFAULT_URL = 'https://api.papapi.se/lite/'
const PAPILITE_TIMEOUT_MS = 8_000
const PAPILITE_PRICE_AREA_CONFIDENCE = 0.8
const DEFAULT_GEODATA_MAX_AGE_DAYS = 30
const PRICE_AREAS: PriceArea[] = ['SE1', 'SE2', 'SE3', 'SE4']

type PapiliteResult = {
  postal_code?: unknown
  city?: unknown
  latitude?: unknown
  longitude?: unknown
  streets?: unknown
  country?: unknown
  updated?: unknown
}

type PapilitePayload = {
  api?: Record<string, unknown>
  results?: PapiliteResult[]
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeText(value: unknown): string | null {
  const text = clean(value)
  return text
    ? text.normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/\s+/g, ' ')
    : null
}

function normalizePriceArea(value: unknown): PriceArea | null {
  const area = clean(value)?.toUpperCase()
  return PRICE_AREAS.includes(area as PriceArea) ? area as PriceArea : null
}

function postalOnlyInput(input: EnergyResolverInput): EnergyResolverInput {
  return {
    ...input,
    // PAP/API Lite has postcode-area centroids, not house-number coordinates.
    // The core resolver must therefore never interpret PAP/API Lite coordinates
    // as an exact delivery point for operational grid-owner automation.
    street: null,
    streetNumber: null,
  }
}

async function hasActivePostalMapping(postalCode: string): Promise<boolean> {
  const { data, error } = await supabaseService
    .from('platform_postal_code_grid_mappings')
    .select('id')
    .eq('postal_code', postalCode)
    .eq('is_active', true)
    .limit(1)

  if (error) throw error
  return Boolean(data?.length)
}

async function currentVerifiedGeodataVersion(): Promise<{ version: string | null; usable: boolean }> {
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

  if (error || !data) return { version: null, usable: false }
  const timestamp = clean(data.verified_at) ?? clean(data.completed_at) ?? clean(data.started_at)
  const age = timestamp ? Date.now() - Date.parse(timestamp) : Number.POSITIVE_INFINITY
  return {
    version: clean(data.version_key),
    usable: Number.isFinite(age) && age <= maxAgeDays * 24 * 60 * 60 * 1000,
  }
}

async function fetchPapilitePostcode(input: EnergyResolverInput, postalCode: string) {
  const apiKey = clean(process.env.PAPILITE_API_KEY)
  if (!apiKey) return { candidate: null, warnings: ['papilite_api_key_missing'] as string[] }

  const endpoint = new URL(clean(process.env.PAPILITE_GEOCODE_URL) ?? PAPILITE_DEFAULT_URL)
  endpoint.searchParams.set('query', postalCode)
  endpoint.searchParams.set('format', 'json')
  endpoint.searchParams.set('apikey', apiKey)
  endpoint.searchParams.set('country', (clean(input.country) ?? 'SE').toLowerCase())

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PAPILITE_TIMEOUT_MS)
  try {
    const response = await fetch(endpoint.toString(), {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) {
      return {
        candidate: null,
        warnings: [response.status === 401
          ? 'papilite_unauthorized'
          : response.status === 403
            ? 'papilite_quota_or_access_denied'
            : response.status === 404
              ? 'papilite_postal_code_not_found'
              : `papilite_http_${response.status}`],
      }
    }

    const payload = await response.json().catch(() => null) as PapilitePayload | null
    const results = Array.isArray(payload?.results) ? payload.results : []
    const requestedCity = normalizeText(input.city)
    const exactPostal = results.filter((row) => normalizePostalCode(row.postal_code) === postalCode)
    const cityMatch = requestedCity
      ? exactPostal.find((row) => normalizeText(row.city) === requestedCity)
      : null
    const candidate = cityMatch ?? exactPostal[0] ?? null
    if (!candidate) return { candidate: null, warnings: ['papilite_postal_code_not_found'] }

    const warnings: string[] = []
    if (requestedCity && normalizeText(candidate.city) !== requestedCity) warnings.push('papilite_city_mismatch')

    const requestedStreet = normalizeText(normaliseSwedishAddress(input.street, input.streetNumber).streetName)
    if (requestedStreet && Array.isArray(candidate.streets)) {
      const streetMatches = candidate.streets.some((street) => normalizeText(street) === requestedStreet)
      if (!streetMatches) warnings.push('papilite_street_mismatch')
    }

    return { candidate, warnings }
  } catch (error) {
    return {
      candidate: null,
      warnings: [error instanceof Error && error.name === 'AbortError' ? 'papilite_timeout' : 'papilite_unavailable'],
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function mapCentroidToPriceArea(candidate: PapiliteResult) {
  const latitude = numeric(candidate.latitude)
  const longitude = numeric(candidate.longitude)
  if (latitude === null || longitude === null) {
    return { priceArea: null, suggestedGridAreaCode: null, geodataVersion: null, warnings: ['papilite_coordinates_missing'] as string[] }
  }

  const geodata = await currentVerifiedGeodataVersion()
  if (!geodata.usable) {
    return { priceArea: null, suggestedGridAreaCode: null, geodataVersion: geodata.version, warnings: ['svk_geodata_stale_or_unverified'] }
  }

  const { data, error } = await supabaseService.rpc('gridex_lonlat_to_grid_area', {
    p_longitude: longitude,
    p_latitude: latitude,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  const record = row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : null
  const priceArea = normalizePriceArea(record?.price_area)
  return {
    priceArea,
    suggestedGridAreaCode: normaliseGridAreaCode(record?.grid_area_code),
    geodataVersion: geodata.version,
    warnings: priceArea ? [] : ['papilite_centroid_price_area_unresolved'],
  }
}

async function persistPapilitePriceArea(input: {
  postalCode: string
  city: string | null
  priceArea: PriceArea
  suggestedGridAreaCode: string | null
  geodataVersion: string | null
  providerUpdated: string | null
}) {
  const now = new Date().toISOString()
  const existingQuery = supabaseService
    .from('platform_postal_code_grid_mappings')
    .select('id,metadata')
    .eq('postal_code', input.postalCode)
    .eq('source', 'papilite_price_area_centroid')
    .is('grid_area_code', null)
    .limit(25)
  const { data: existingRows, error: existingError } = await existingQuery
  if (existingError) throw existingError
  const normalizedCity = normalizeText(input.city)
  const existing = (existingRows ?? []).find((row) => normalizeText((row as Record<string, unknown>).metadata && typeof (row as Record<string, unknown>).metadata === 'object'
    ? ((row as Record<string, unknown>).metadata as Record<string, unknown>).canonical_city
    : null) === normalizedCity)

  const metadata = {
    canonical_city: input.city,
    coordinate_precision: 'postal_centroid',
    provider: 'papilite',
    provider_updated: input.providerUpdated,
    suggested_grid_area_code: input.suggestedGridAreaCode,
    geodata_version: input.geodataVersion,
    operational_grid_owner_allowed: false,
    last_verified_at: now,
  }

  if (existing?.id) {
    const { error } = await supabaseService
      .from('platform_postal_code_grid_mappings')
      .update({
        city: input.city,
        price_area: input.priceArea,
        confidence: PAPILITE_PRICE_AREA_CONFIDENCE,
        is_active: true,
        metadata,
        updated_at: now,
      })
      .eq('id', existing.id)
    if (error) throw error
    return
  }

  const { error } = await supabaseService
    .from('platform_postal_code_grid_mappings')
    .insert({
      postal_code: input.postalCode,
      city: input.city,
      grid_area_code: null,
      price_area: input.priceArea,
      confidence: PAPILITE_PRICE_AREA_CONFIDENCE,
      source: 'papilite_price_area_centroid',
      is_active: true,
      metadata,
      created_at: now,
      updated_at: now,
    })
  if (error && (error as { code?: string }).code !== '23505') throw error
}

async function persistTenantPriceArea(input: EnergyResolverInput, resolved: EnergyResolverResult) {
  if (
    !input.companyId ||
    !input.customerSiteId ||
    !resolved.priceArea ||
    !['verified', 'estimated'].includes(resolved.priceAreaAssurance.status)
  ) return

  const { error } = await supabaseService
    .from('customer_sites')
    .update({
      price_area_code: resolved.priceArea,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.customerSiteId)
    .eq('company_id', input.companyId)
  if (error) throw error
}

async function localPostalResolution(input: EnergyResolverInput, extraWarnings: string[] = []) {
  const resolved = await resolveCoreEnergyContext(postalOnlyInput(input))
  const withWarnings = extraWarnings.length
    ? { ...resolved, warnings: [...new Set([...resolved.warnings, ...extraWarnings])] }
    : resolved
  await persistTenantPriceArea(input, withWarnings)
  return withWarnings
}

/**
 * Canonical facade for energy resolution.
 *
 * Order of operations is intentionally persistence-first:
 * 1) reuse global postcode/grid/price mappings shared across tenants;
 * 2) call PAP/API Lite only on a true postcode cache miss;
 * 3) persist only price-area evidence from PAP/API Lite's postcode centroid;
 * 4) never promote a postcode centroid to an operationally verified grid owner.
 *
 * A verified/manual-verified customer site later strengthens the global mapping
 * through the database trigger in 20260817094125_papilite_verified_postal_learning.
 */
export async function resolveEnergyContext(input: EnergyResolverInput): Promise<EnergyResolverResult> {
  const postalCode = normalizePostalCode(input.postalCode)
  if (!postalCode) return resolveCoreEnergyContext(postalOnlyInput(input))

  if (await hasActivePostalMapping(postalCode)) {
    return localPostalResolution(input)
  }

  const papilite = await fetchPapilitePostcode(input, postalCode)
  if (!papilite.candidate) {
    return localPostalResolution(input, papilite.warnings)
  }

  const mapped = await mapCentroidToPriceArea(papilite.candidate)
  const priceArea = mapped.priceArea
  if (priceArea) {
    await persistPapilitePriceArea({
      postalCode,
      city: clean(papilite.candidate.city) ?? clean(input.city),
      priceArea,
      suggestedGridAreaCode: mapped.suggestedGridAreaCode,
      geodataVersion: mapped.geodataVersion,
      providerUpdated: clean(papilite.candidate.updated),
    })
  }

  return localPostalResolution(input, [...papilite.warnings, ...mapped.warnings])
}

export async function publicPriceAreaByPostalCode(postalCodeRaw: string | null) {
  const postalCode = normalizePostalCode(postalCodeRaw)
  if (!postalCode) {
    return { postalCode: postalCodeRaw, priceArea: null, confidence: 0, disclaimer: 'Ange ett svenskt postnummer.' }
  }
  const resolved = await resolveEnergyContext({ postalCode })
  return {
    postalCode,
    priceArea: resolved.priceArea,
    confidence: resolved.priceAreaAssurance.confidence,
    disclaimer: 'Elområde återanvänds från Gridex gemensamma postnummercache när det finns. PAP/API Lite används endast vid cache miss och dess postnummerkoordinat används aldrig ensam som verifierad nätägare.',
  }
}
