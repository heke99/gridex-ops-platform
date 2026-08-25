import { supabaseService } from '@/lib/supabase/service'
import { recordCanonicalEnergyEvent } from '@/lib/energy/canonicalEnergyEvents'
import { normaliseSwedishAddress } from '@/lib/energy/address'
import type {
  EnergyResolverDiagnostics,
  EnergyResolverInput,
  EnergyResolverResult,
  EnergyResolutionStatus,
  PriceArea,
  PriceAreaAssurance,
} from '@/lib/energy/types'
import { getGridOwnerVerification } from '@/lib/grid-owners/verification'

const PRICE_AREAS: PriceArea[] = ['SE1', 'SE2', 'SE3', 'SE4']
const GEOCODE_TIMEOUT_MS = 10_000
const RESOLVER_VERSION = 'energy-resolver-v2'
const DEFAULT_RESOLUTION_TTL_HOURS = 24
const DEFAULT_GEODATA_MAX_AGE_DAYS = 30
const MIN_POSTAL_PRICE_ASSURANCE_CONFIDENCE = 0.8
const MAX_POSTAL_CANDIDATES = 100
const PAPILITE_DEFAULT_URL = 'https://api.papapi.se/lite/'
const PAPILITE_POSTAL_CENTROID_CONFIDENCE = 0.7
const PAPILITE_POSTAL_CACHE_TTL_DAYS = 90

type Coordinates = {
  addressKey: string
  latitude: number | null
  longitude: number | null
  sweref99X: number | null
  sweref99Y: number | null
  confidence: number
  raw: Record<string, unknown>
}

type GeocodeLookup = {
  coordinates: Coordinates | null
  warnings: string[]
  diagnostics: EnergyResolverDiagnostics
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

class ResolverSchemaError extends Error {
  constructor(readonly resource: string, cause?: unknown) {
    super(`Resolver dependency is unavailable: ${resource}`)
    this.name = 'ResolverSchemaError'
    if (cause) this.cause = cause
  }
}

function requireResolverSchema(resource: string, error: unknown): never {
  throw new ResolverSchemaError(resource, error)
}

function normalisePriceArea(value: unknown): PriceArea | null {
  const area = clean(value)?.toUpperCase()
  return PRICE_AREAS.includes(area as PriceArea) ? area as PriceArea : null
}

function normalizeCity(value: unknown): string | null {
  const city = clean(value)
  return city
    ? city.normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/\s+/g, ' ')
    : null
}

function unresolvedPriceAreaAssurance(
  patch: Partial<PriceAreaAssurance> = {},
): PriceAreaAssurance {
  return {
    status: 'unresolved',
    priceArea: null,
    confidence: 0,
    source: null,
    candidateCount: 0,
    uniquePriceAreaCount: 0,
    sourceVersion: null,
    evidence: {},
    ...patch,
  }
}

function verifiedPriceAreaAssurance(input: {
  priceArea: PriceArea | null
  confidence: number
  source: 'facility_data' | 'grid_area_master' | 'address_polygon'
  sourceVersion?: string | null
  evidence?: Record<string, unknown>
}): PriceAreaAssurance {
  if (!input.priceArea) {
    return unresolvedPriceAreaAssurance({
      confidence: input.confidence,
      source: input.source,
      sourceVersion: input.sourceVersion ?? null,
      evidence: input.evidence ?? {},
    })
  }
  return {
    status: 'verified',
    priceArea: input.priceArea,
    confidence: input.confidence,
    source: input.source,
    candidateCount: 1,
    uniquePriceAreaCount: 1,
    sourceVersion: input.sourceVersion ?? null,
    evidence: input.evidence ?? {},
  }
}

export function normaliseGridAreaCode(value: unknown): string | null {
  return clean(value)?.replace(/\s+/g, '').toUpperCase() ?? null
}

export function normalizePostalCode(value: unknown): string | null {
  const digits = clean(value)?.replace(/\D/g, '') ?? ''
  return /^\d{5}$/.test(digits) ? digits : null
}

function hasFullAddress(input: EnergyResolverInput): boolean {
  return Boolean(clean(input.street) && normalizePostalCode(input.postalCode) && clean(input.city))
}

function exactAddressProviderAllowed(input: EnergyResolverInput): boolean {
  const metadata = input.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return true
  // Website price-area path sets exact_address_provider_allowed: false. Honor it
  // even if street data is present so Lantmäteriet cannot re-enter that path.
  return metadata.exact_address_provider_allowed !== false
}

function addressKeyFor(parts: { street: string | null; streetNumber: string | null; postalCode: string | null; city: string | null; country: string | null }): string | null {
  if (!parts.street || !parts.postalCode || !parts.city) return null
  return [parts.street, parts.streetNumber, parts.postalCode, parts.city, parts.country ?? 'SE']
    .map((part) => clean(part)?.toLocaleLowerCase('sv-SE').replace(/\s+/g, ' ') ?? '')
    .join('|')
}

function addressAttempts(input: EnergyResolverInput) {
  const parsed = normaliseSwedishAddress(input.street, input.streetNumber)
  const postalCode = normalizePostalCode(input.postalCode)
  const city = clean(input.city)
  const country = clean(input.country) ?? 'SE'
  const attempts: Array<{ street: string; streetNumber: string | null; key: string }> = []
  const add = (street: string | null, streetNumber: string | null) => {
    const key = addressKeyFor({ street, streetNumber, postalCode, city, country })
    if (!street || !key || attempts.some((candidate) => candidate.key === key)) return
    attempts.push({ street, streetNumber, key })
  }

  add(parsed.streetName, parsed.streetNumber)
  add(parsed.originalStreet, clean(input.streetNumber))
  return attempts
}

function addressKey(input: EnergyResolverInput): string | null {
  return addressAttempts(input)[0]?.key ?? null
}

function postalCentroidKey(postalCode: string, country: string): string {
  return `postal_centroid|${country.toUpperCase()}|${postalCode}`
}

function lookupKey(input: EnergyResolverInput): string {
  const postalCode = normalizePostalCode(input.postalCode)
  const country = (clean(input.country) ?? 'SE').toUpperCase()
  const postalKey = postalCode
    ? `postal:${country}:${postalCode}:${normalizeCity(input.city) ?? ''}`
    : ''
  return [
    normaliseGridAreaCode(input.gridAreaCode) ?? '',
    addressKey(input) ?? postalKey,
    clean(input.facilityId) ?? '',
    clean(input.meteringPointId) ?? '',
  ].join('|')
}

function papiliteConfigured(): boolean {
  return Boolean(clean(process.env.PAPILITE_API_KEY))
}

function result(input: EnergyResolverInput, patch: Partial<EnergyResolverResult>): EnergyResolverResult {
  const papiliteReady = papiliteConfigured()
  return {
    gridAreaCode: null,
    gridAreaName: null,
    gridOwnerId: null,
    gridOwnerName: null,
    priceArea: null,
    priceAreaAssurance: unresolvedPriceAreaAssurance(),
    resolutionStatus: 'failed',
    confidence: 0,
    sourceChain: [],
    automationAllowed: false,
    nextRequiredAction: 'Granska adress- och nätområdesuppgifter manuellt.',
    lookupKey: lookupKey(input),
    warnings: [],
    resolverVersion: RESOLVER_VERSION,
    geodataVersion: null,
    conflictCode: null,
    diagnostics: {
      addressAttempts: [],
      geocodeProvider: 'papilite',
      geocodeStatus: papiliteReady ? 'no_match' : 'missing_api_key',
      providerStatus: papiliteReady ? 'not_attempted' : 'not_configured',
      providerHttpStatus: null,
      providerErrorCode: papiliteReady ? null : 'missing_api_key',
      coordinateReferenceSystem: null,
      polygonStatus: 'not_attempted',
      mappingStatus: 'not_applicable',
    },
    ...patch,
  }
}

function nextActionFor(status: EnergyResolutionStatus, hasFacilityData: boolean): string {
  if (status === 'facility_verified') return 'Starta leverantörsbyte när övriga readiness-krav är uppfyllda.'
  if (hasFacilityData && status === 'grid_area_master_validated') return 'Verifiera anläggningsuppgifter och starta leverantörsbyte när fullmakt och avtal är klara.'
  if (status === 'grid_area_master_validated') return 'Begär anläggningsuppgifter från nätägare innan leverantörsbyte kan startas.'
  if (status === 'postal_suggested') return 'Verifiera föreslagen nätägare innan EDIFACT skickas.'
  if (status === 'address_resolved' || status === 'grid_area_resolved') return 'Validera nätområde mot masterdata eller granska manuellt.'
  return 'Granska ansökan manuellt innan automation fortsätter.'
}

async function mapPlatformGridOwnerToOpsGridOwner(platformGridOwnerId: string | null): Promise<string | null> {
  const id = clean(platformGridOwnerId)
  if (!id) return null
  const { data, error } = await supabaseService
    .from('platform_grid_owners')
    .select('ops_grid_owner_id')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) requireResolverSchema('platform_grid_owners', error)
    throw error
  }
  return clean((data as { ops_grid_owner_id?: string | null } | null)?.ops_grid_owner_id)
}

async function applyGridOwnerVerification(resolved: EnergyResolverResult): Promise<EnergyResolverResult> {
  if (!resolved.gridOwnerId) return resolved
  const verification = await getGridOwnerVerification(resolved.gridOwnerId).catch(() => null)
  if (!verification) {
    return {
      ...resolved,
      automationAllowed: false,
      gridOwnerVerificationStatus: 'unknown',
      gridOwnerVerificationIssues: ['grid_owner_verification_missing'],
      warnings: [...resolved.warnings, 'grid_owner_verification_missing'],
      nextRequiredAction: 'Granska nätägare manuellt innan leverantörsbyte eller Ediel-förfrågan skickas.',
    }
  }
  if (verification.verificationStatus !== 'verified' || !verification.verifiedForCustomerFlow || !verification.canUseForProdat) {
    const issues = verification.reasons.length
      ? verification.reasons
      : [!verification.canUseForProdat ? 'prodat_route_not_ready' : verification.verificationStatus]
    return {
      ...resolved,
      automationAllowed: false,
      gridOwnerVerificationStatus: verification.verificationStatus,
      gridOwnerVerificationIssues: issues,
      warnings: [...resolved.warnings, !verification.canUseForProdat ? 'grid_owner_prodat_not_ready' : `grid_owner_${verification.verificationStatus}`],
      nextRequiredAction: verification.nextAction ?? 'Verifiera nätägare, PRODAT-route, subadress, kontaktväg och certifikat innan automation fortsätter.',
    }
  }
  return {
    ...resolved,
    gridOwnerVerificationStatus: 'verified',
    gridOwnerVerificationIssues: [],
    warnings: resolved.warnings.filter((warning) => !warning.startsWith('grid_owner_')),
  }
}

async function findGridAreaByCode(gridAreaCode: string): Promise<EnergyResolverResult | null> {
  const { data, error } = await supabaseService
    .from('platform_grid_areas')
    .select('id,grid_area_code,grid_area_name,grid_owner_id,grid_owner_name,price_area,platform_grid_owners(name,ops_grid_owner_id)')
    .eq('grid_area_code', gridAreaCode)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    if (missingSchema(error)) requireResolverSchema('platform_grid_areas', error)
    throw error
  }
  if (!data) return null
  const ownerRelation = data.platform_grid_owners as { name?: string | null; ops_grid_owner_id?: string | null } | null | undefined
  const opsGridOwnerId = clean(ownerRelation?.ops_grid_owner_id) ?? await mapPlatformGridOwnerToOpsGridOwner(clean(data.grid_owner_id))
  const mappingMissing = Boolean(clean(data.grid_owner_id) && !opsGridOwnerId)
  const hasPriceArea = Boolean(normalisePriceArea(data.price_area))
  return applyGridOwnerVerification(result({}, {
    gridAreaCode: clean(data.grid_area_code),
    gridAreaName: clean(data.grid_area_name),
    gridOwnerId: opsGridOwnerId,
    gridOwnerName: clean(ownerRelation?.name) ?? clean(data.grid_owner_name),
    priceArea: normalisePriceArea(data.price_area),
    priceAreaAssurance: verifiedPriceAreaAssurance({
      priceArea: normalisePriceArea(data.price_area),
      confidence: hasPriceArea ? 0.98 : 0.82,
      source: 'grid_area_master',
      evidence: { grid_area_code: clean(data.grid_area_code) },
    }),
    resolutionStatus: hasPriceArea ? 'grid_area_master_validated' : 'grid_area_resolved',
    confidence: hasPriceArea ? 0.98 : 0.82,
    sourceChain: ['input.grid_area_code', 'platform_grid_areas'],
    automationAllowed: hasPriceArea && !mappingMissing,
    nextRequiredAction: mappingMissing
      ? 'Nätområdet är känt men saknar koppling till OPS-nätägaren. Slutför masterdatamappningen innan Ediel skickas.'
      : nextActionFor(hasPriceArea ? 'grid_area_master_validated' : 'grid_area_resolved', false),
    lookupKey: gridAreaCode,
    warnings: mappingMissing ? ['platform_to_ops_grid_owner_mapping_missing'] : [],
    diagnostics: {
      addressAttempts: [],
      geocodeProvider: null,
      geocodeStatus: 'not_configured',
      providerStatus: 'not_attempted',
      providerHttpStatus: null,
      providerErrorCode: null,
      coordinateReferenceSystem: null,
      polygonStatus: 'not_attempted',
      mappingStatus: mappingMissing ? 'platform_to_ops_missing' : 'mapped',
    },
  }))
}

async function cachedAddressCoordinates(input: EnergyResolverInput): Promise<Coordinates | null> {
  const attempts = addressAttempts(input)
  if (attempts.length === 0) return null
  const keys = attempts.map((attempt) => attempt.key)
  const { data, error } = await supabaseService
    .from('platform_address_lookup_cache')
    .select('*')
    .in('address_key', keys)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  if (!data) return null
  const raw = isRecord(data.raw_payload) ? data.raw_payload : {}
  if (raw.coordinate_scope === 'postal_centroid' || clean(data.provider) === 'papilite_postal_centroid') return null
  return {
    addressKey: clean(data.address_key) ?? keys[0],
    latitude: numberOrNull(data.latitude),
    longitude: numberOrNull(data.longitude),
    sweref99X: numberOrNull(data.sweref99_x),
    sweref99Y: numberOrNull(data.sweref99_y),
    confidence: numberOrNull(data.confidence) ?? 0.7,
    raw,
  }
}

function firstFromRecord(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') return record[key]
  }
  return null
}

function candidateFromPayload(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload)) return isRecord(payload[0]) ? payload[0] : null
  if (!isRecord(payload)) return null
  for (const key of ['results', 'data', 'items', 'features']) {
    const nested = payload[key]
    if (Array.isArray(nested) && isRecord(nested[0])) return nested[0]
  }
  return payload
}

function coordinateRecords(candidate: Record<string, unknown>): Record<string, unknown>[] {
  return [candidate, candidate.properties, candidate.attributes]
    .filter(isRecord)
}

function numberFromRecords(records: Record<string, unknown>[], keys: string[]): number | null {
  for (const row of records) {
    const value = firstFromRecord(row, keys)
    const parsed = numberOrNull(value)
    if (parsed !== null) return parsed
  }
  return null
}

function coordinateReference(candidate: Record<string, unknown>, records: Record<string, unknown>[]): string | null {
  const geometry = isRecord(candidate.geometry) ? candidate.geometry : {}
  const spatialReference = isRecord(candidate.spatialReference)
    ? candidate.spatialReference
    : isRecord(geometry.spatialReference)
      ? geometry.spatialReference
      : {}
  const raw = numberFromRecords([spatialReference, ...records], ['wkid', 'latestWkid', 'srid', 'epsg', 'epsg_code'])
  return raw ? `EPSG:${Math.trunc(raw)}` : null
}

function coordinatesFromCandidate(candidate: Record<string, unknown>) {
  const records = coordinateRecords(candidate)
  const geometry = isRecord(candidate.geometry) ? candidate.geometry : null
  const geometryCoordinates = Array.isArray(geometry?.coordinates) ? geometry?.coordinates : null
  const reference = coordinateReference(candidate, records)

  let latitude = numberFromRecords(records, ['latitude', 'lat'])
  let longitude = numberFromRecords(records, ['longitude', 'lng', 'lon'])
  let sweref99X = numberFromRecords(records, ['sweref99_x', 'sweref_x', 'swerefX', 'x_3006'])
  let sweref99Y = numberFromRecords(records, ['sweref99_y', 'sweref_y', 'swerefY', 'y_3006'])

  if ((latitude === null || longitude === null) && Array.isArray(geometryCoordinates) && geometryCoordinates.length >= 2) {
    longitude = longitude ?? numberOrNull(geometryCoordinates[0])
    latitude = latitude ?? numberOrNull(geometryCoordinates[1])
  }
  if (reference === 'EPSG:3006') {
    sweref99X = sweref99X ?? numberFromRecords(records, ['x'])
    sweref99Y = sweref99Y ?? numberFromRecords(records, ['y'])
  }

  return { latitude, longitude, sweref99X, sweref99Y }
}

async function lookupPapilitePostalCentroid(input: EnergyResolverInput): Promise<GeocodeLookup> {
  const postalCode = normalizePostalCode(input.postalCode)
  const country = (clean(input.country) ?? 'SE').toUpperCase()
  const apiKey = clean(process.env.PAPILITE_API_KEY)
  const baseUrl = clean(process.env.PAPILITE_GEOCODE_URL) ?? PAPILITE_DEFAULT_URL
  const diagnostics: EnergyResolverDiagnostics = {
    addressAttempts: [],
    geocodeProvider: 'papilite',
    geocodeStatus: apiKey ? 'no_match' : 'missing_api_key',
    providerStatus: 'not_attempted',
    providerHttpStatus: null,
    providerErrorCode: apiKey ? null : 'missing_api_key',
    coordinateReferenceSystem: null,
    polygonStatus: 'not_attempted',
    mappingStatus: 'not_applicable',
  }
  if (!postalCode) {
    return {
      coordinates: null,
      warnings: ['postal_code_invalid_for_papilite'],
      diagnostics: { ...diagnostics, geocodeStatus: 'no_match', providerErrorCode: 'postal_code_invalid' },
    }
  }

  const cacheKey = postalCentroidKey(postalCode, country)
  const cached = await supabaseService
    .from('platform_address_lookup_cache')
    .select('*')
    .eq('address_key', cacheKey)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .maybeSingle()
  if (cached.error && !missingSchema(cached.error)) throw cached.error
  if (cached.data) {
    const raw = isRecord(cached.data.raw_payload) ? cached.data.raw_payload : {}
    if (raw.coordinate_scope === 'postal_centroid' || clean(cached.data.provider) === 'papilite_postal_centroid') {
      const latitude = numberOrNull(cached.data.latitude)
      const longitude = numberOrNull(cached.data.longitude)
      if (latitude !== null && longitude !== null) {
        return {
          coordinates: {
            addressKey: cacheKey,
            latitude,
            longitude,
            sweref99X: null,
            sweref99Y: null,
            confidence: Math.min(PAPILITE_POSTAL_CENTROID_CONFIDENCE, numberOrNull(cached.data.confidence) ?? PAPILITE_POSTAL_CENTROID_CONFIDENCE),
            raw,
          },
          warnings: ['postal_centroid_not_facility_location'],
          diagnostics: {
            ...diagnostics,
            geocodeStatus: 'success',
            providerStatus: 'cache_hit',
            providerErrorCode: null,
            coordinateReferenceSystem: 'EPSG:4326',
          },
        }
      }
    }
  }

  if (!apiKey) {
    return { coordinates: null, warnings: ['papilite_missing_api_key'], diagnostics }
  }

  let endpoint: URL
  try {
    endpoint = new URL(baseUrl)
  } catch {
    return {
      coordinates: null,
      warnings: ['papilite_invalid_base_url'],
      diagnostics: { ...diagnostics, geocodeStatus: 'provider_unavailable', providerStatus: 'failed', providerErrorCode: 'invalid_base_url' },
    }
  }
  endpoint.searchParams.set('query', postalCode)
  endpoint.searchParams.set('format', 'json')
  endpoint.searchParams.set('country', country.toLowerCase())
  endpoint.searchParams.set('apikey', apiKey)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS)
  try {
    const response = await fetch(endpoint.toString(), {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    diagnostics.geocodeHttpStatus = response.status
    diagnostics.providerHttpStatus = response.status
    if (!response.ok) {
      diagnostics.providerStatus = 'http_error'
      diagnostics.providerErrorCode = `http_${response.status}`
      diagnostics.geocodeStatus = response.status === 401 || response.status === 403
        ? 'unauthorized'
        : response.status === 429
          ? 'rate_limited'
          : 'provider_unavailable'
      const warning = diagnostics.geocodeStatus === 'unauthorized'
        ? 'papilite_unauthorized'
        : diagnostics.geocodeStatus === 'rate_limited'
          ? 'papilite_rate_limited'
          : 'papilite_unavailable'
      return { coordinates: null, warnings: [warning], diagnostics }
    }

    const payload = await response.json().catch(() => null) as unknown
    diagnostics.geocodeResponseShape = Array.isArray(payload)
      ? 'array'
      : payload && typeof payload === 'object'
        ? `object:${Object.keys(payload as Record<string, unknown>).sort().slice(0, 8).join(',')}`
        : typeof payload
    const candidate = candidateFromPayload(payload)
    if (!candidate) {
      return {
        coordinates: null,
        warnings: ['papilite_no_result'],
        diagnostics: { ...diagnostics, geocodeStatus: 'no_match', providerStatus: 'success', providerErrorCode: 'no_result' },
      }
    }

    const records = coordinateRecords(candidate)
    const candidatePostal = normalizePostalCode(firstFromRecord(records[0] ?? {}, ['postal_code', 'postcode', 'zip_code', 'zip']))
      ?? normalizePostalCode(records.map((record) => firstFromRecord(record, ['postal_code', 'postcode', 'zip_code', 'zip'])).find(Boolean))
    if (candidatePostal && candidatePostal !== postalCode) {
      return {
        coordinates: null,
        warnings: ['papilite_postal_code_mismatch'],
        diagnostics: { ...diagnostics, geocodeStatus: 'invalid_response', providerStatus: 'success', providerErrorCode: 'postal_code_mismatch' },
      }
    }

    const { latitude, longitude } = coordinatesFromCandidate(candidate)
    if (latitude === null || longitude === null) {
      return {
        coordinates: null,
        warnings: ['papilite_invalid_response'],
        diagnostics: { ...diagnostics, geocodeStatus: 'invalid_response', providerStatus: 'success', providerErrorCode: 'coordinates_missing' },
      }
    }

    const city = clean(firstFromRecord(records[0] ?? {}, ['city', 'postort', 'postal_town']))
      ?? clean(records.map((record) => firstFromRecord(record, ['city', 'postort', 'postal_town'])).find(Boolean))
      ?? clean(input.city)
    const raw = {
      coordinate_scope: 'postal_centroid',
      provider: 'papilite',
      provider_payload: payload,
    }
    const coordinates: Coordinates = {
      addressKey: cacheKey,
      latitude,
      longitude,
      sweref99X: null,
      sweref99Y: null,
      confidence: PAPILITE_POSTAL_CENTROID_CONFIDENCE,
      raw,
    }
    const cache = await supabaseService
      .from('platform_address_lookup_cache')
      .upsert({
        address_key: cacheKey,
        street: null,
        postal_code: postalCode,
        city,
        country,
        latitude,
        longitude,
        sweref99_x: null,
        sweref99_y: null,
        provider: 'papilite_postal_centroid',
        confidence: PAPILITE_POSTAL_CENTROID_CONFIDENCE,
        raw_payload: raw,
        expires_at: new Date(Date.now() + PAPILITE_POSTAL_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'address_key' })
    const warnings = [
      'postal_centroid_not_facility_location',
      ...(cache.error && !missingSchema(cache.error) ? ['postal_centroid_cache_write_failed'] : []),
    ]
    return {
      coordinates,
      warnings,
      diagnostics: {
        ...diagnostics,
        geocodeStatus: 'success',
        providerStatus: 'success',
        providerErrorCode: null,
        coordinateReferenceSystem: 'EPSG:4326',
      },
    }
  } catch (error) {
    const timeoutError = error instanceof Error && error.name === 'AbortError'
    return {
      coordinates: null,
      warnings: [timeoutError ? 'papilite_timeout' : 'papilite_unavailable'],
      diagnostics: {
        ...diagnostics,
        geocodeStatus: 'provider_unavailable',
        providerStatus: timeoutError ? 'timeout' : 'failed',
        providerErrorCode: timeoutError ? 'timeout' : 'provider_unavailable',
      },
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function currentGeodataVersion(): Promise<{ version: string | null; stale: boolean }> {
  const maxAgeDaysRaw = Number(process.env.ENERGY_GEODATA_MAX_AGE_DAYS ?? DEFAULT_GEODATA_MAX_AGE_DAYS)
  const maxAgeDays = Number.isFinite(maxAgeDaysRaw) ? Math.min(Math.max(maxAgeDaysRaw, 1), 365) : DEFAULT_GEODATA_MAX_AGE_DAYS
  const { data, error } = await supabaseService
    .from('energy_geodata_versions')
    .select('version_key,verified_at,completed_at,started_at')
    .eq('provider', 'svk_arcgis')
    .eq('status', 'verified')
    .order('verified_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) return { version: null, stale: true }
    throw error
  }
  if (!data) return { version: null, stale: true }
  const timestamp = clean(data.verified_at) ?? clean(data.completed_at) ?? clean(data.started_at)
  const ageMs = timestamp ? Date.now() - Date.parse(timestamp) : Number.POSITIVE_INFINITY
  return {
    version: clean(data.version_key),
    stale: !Number.isFinite(ageMs) || ageMs > maxAgeDays * 24 * 60 * 60 * 1000,
  }
}

async function pointToGridArea(input: EnergyResolverInput, coordinates: Coordinates): Promise<EnergyResolverResult | null> {
  let data: unknown = null
  let error: unknown = null
  let coordinateReferenceSystem: EnergyResolverDiagnostics['coordinateReferenceSystem'] = null

  if (coordinates.sweref99X !== null && coordinates.sweref99Y !== null) {
    coordinateReferenceSystem = 'EPSG:3006'
    const response = await supabaseService.rpc('gridex_point_to_grid_area', { p_x: coordinates.sweref99X, p_y: coordinates.sweref99Y })
    data = response.data
    error = response.error
  } else if (coordinates.longitude !== null && coordinates.latitude !== null) {
    coordinateReferenceSystem = 'EPSG:4326'
    const response = await supabaseService.rpc('gridex_lonlat_to_grid_area', { p_longitude: coordinates.longitude, p_latitude: coordinates.latitude })
    data = response.data
    error = response.error
  }

  if (error) {
    if (missingSchema(error)) requireResolverSchema('gridex_point_to_grid_area', error)
    throw error
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!isRecord(row)) return null
  const status: EnergyResolutionStatus = normalisePriceArea(row.price_area) && clean(row.grid_owner_name)
    ? 'grid_area_master_validated'
    : 'grid_area_resolved'
  const opsGridOwnerId = await mapPlatformGridOwnerToOpsGridOwner(clean(row.grid_owner_id))
  const mappingMissing = Boolean(clean(row.grid_owner_id) && !opsGridOwnerId)
  const geodata = await currentGeodataVersion()
  const resolved = await applyGridOwnerVerification(result(input, {
    gridAreaCode: clean(row.grid_area_code),
    gridAreaName: clean(row.grid_area_name),
    gridOwnerId: opsGridOwnerId,
    gridOwnerName: clean(row.grid_owner_name),
    priceArea: normalisePriceArea(row.price_area),
    priceAreaAssurance: geodata.stale
      ? unresolvedPriceAreaAssurance({
          priceArea: normalisePriceArea(row.price_area),
          confidence: Math.max(0.75, numberOrNull(row.confidence) ?? coordinates.confidence ?? 0.84),
          source: 'address_polygon',
          sourceVersion: geodata.version,
          evidence: { grid_area_code: clean(row.grid_area_code), geodata_stale: true },
        })
      : verifiedPriceAreaAssurance({
          priceArea: normalisePriceArea(row.price_area),
          confidence: Math.max(0.75, numberOrNull(row.confidence) ?? coordinates.confidence ?? 0.84),
          source: 'address_polygon',
          sourceVersion: geodata.version,
          evidence: { grid_area_code: clean(row.grid_area_code), coordinate_reference_system: coordinateReferenceSystem },
        }),
    resolutionStatus: status,
    confidence: Math.max(0.75, numberOrNull(row.confidence) ?? coordinates.confidence ?? 0.84),
    sourceChain: ['address', 'address_cache', 'svk_arcgis_polygon', 'platform_grid_areas'],
    automationAllowed: status === 'grid_area_master_validated' && !mappingMissing && !geodata.stale,
    geodataVersion: geodata.version,
    nextRequiredAction: mappingMissing
      ? 'Nätområdet är känt men saknar OPS-nätägar-mappning. Granska masterdata innan Ediel skickas.'
      : nextActionFor(status, Boolean(clean(input.facilityId) && clean(input.meteringPointId))),
    coordinates: {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      sweref99X: coordinates.sweref99X,
      sweref99Y: coordinates.sweref99Y,
    },
    warnings: [
      ...(mappingMissing ? ['platform_to_ops_grid_owner_mapping_missing'] : []),
      ...(geodata.stale ? ['svk_geodata_stale_or_unverified'] : []),
    ],
    diagnostics: {
      addressAttempts: [],
      geocodeProvider: 'cache',
      geocodeStatus: 'success',
      providerStatus: 'cache_hit',
      providerHttpStatus: null,
      providerErrorCode: null,
      coordinateReferenceSystem,
      polygonStatus: 'matched',
      mappingStatus: mappingMissing ? 'platform_to_ops_missing' : 'mapped',
    },
  }))
  if (geodata.stale) {
    return {
      ...resolved,
      automationAllowed: false,
      nextRequiredAction: 'SVK-geometrin är för gammal eller ej verifierad. Uppdatera geodata innan automation fortsätter.',
    }
  }
  return resolved
}

async function priceAreaFromPostalCentroid(
  input: EnergyResolverInput,
  lookup: GeocodeLookup,
): Promise<EnergyResolverResult | null> {
  const coordinates = lookup.coordinates
  if (!coordinates || coordinates.longitude === null || coordinates.latitude === null) return null

  const response = await supabaseService.rpc('gridex_lonlat_to_grid_area', {
    p_longitude: coordinates.longitude,
    p_latitude: coordinates.latitude,
  })
  if (response.error) {
    if (missingSchema(response.error)) requireResolverSchema('gridex_lonlat_to_grid_area', response.error)
    throw response.error
  }
  const row = Array.isArray(response.data) ? response.data[0] : response.data
  const geodata = await currentGeodataVersion()
  if (!isRecord(row)) {
    return result(input, {
      resolutionStatus: 'postal_suggested',
      confidence: coordinates.confidence,
      sourceChain: ['postal_code', lookup.diagnostics.providerStatus === 'cache_hit' ? 'postal_centroid_cache' : 'papilite', 'postal_centroid', 'polygon_no_match'],
      automationAllowed: false,
      nextRequiredAction: 'Postnumrets centroid kunde inte kopplas till ett elområde. Komplettera eller verifiera platsen manuellt.',
      warnings: [...lookup.warnings, 'postal_centroid_price_area_unresolved'],
      diagnostics: { ...lookup.diagnostics, polygonStatus: 'no_match', mappingStatus: 'not_applicable' },
    })
  }

  const priceArea = normalisePriceArea(row.price_area)
  const confidence = Math.min(
    PAPILITE_POSTAL_CENTROID_CONFIDENCE,
    coordinates.confidence,
    Math.max(0, numberOrNull(row.confidence) ?? PAPILITE_POSTAL_CENTROID_CONFIDENCE),
  )
  const evidence = {
    postal_code: normalizePostalCode(input.postalCode),
    coordinate_scope: 'postal_centroid',
    provider: 'papilite',
    coordinate_reference_system: 'EPSG:4326',
    geodata_version: geodata.version,
    geodata_stale: geodata.stale,
  }
  const sourceChain = [
    'postal_code',
    lookup.diagnostics.providerStatus === 'cache_hit' ? 'platform_address_lookup_cache' : 'papilite',
    'postal_centroid',
    'svk_arcgis_polygon',
    'price_area_only',
  ]

  return result(input, {
    priceArea,
    priceAreaAssurance: !priceArea || geodata.stale
      ? unresolvedPriceAreaAssurance({
          priceArea,
          confidence,
          source: 'postal_centroid',
          sourceVersion: geodata.version,
          candidateCount: priceArea ? 1 : 0,
          uniquePriceAreaCount: priceArea ? 1 : 0,
          evidence,
        })
      : {
          status: 'estimated',
          priceArea,
          confidence,
          source: 'postal_centroid',
          candidateCount: 1,
          uniquePriceAreaCount: 1,
          sourceVersion: geodata.version,
          evidence,
        },
    resolutionStatus: 'postal_suggested',
    confidence,
    sourceChain,
    automationAllowed: false,
    geodataVersion: geodata.version,
    nextRequiredAction: priceArea && !geodata.stale
      ? 'Elområdet är uppskattat från postnumrets centroid. Verifiera nätområde och nätägare via anläggningsdata eller manuell verifiering innan Ediel skickas.'
      : 'Elområdet kunde inte verifieras från postnumrets centroid. Komplettera platsdata eller uppdatera verifierad geodata.',
    warnings: [
      ...lookup.warnings,
      'postal_centroid_not_facility_location',
      ...(geodata.stale ? ['svk_geodata_stale_or_unverified'] : []),
      ...(!priceArea ? ['postal_centroid_price_area_unresolved'] : []),
    ],
    diagnostics: {
      ...lookup.diagnostics,
      coordinateReferenceSystem: 'EPSG:4326',
      polygonStatus: isRecord(row) ? 'matched' : 'no_match',
      mappingStatus: 'not_applicable',
    },
  })
}

async function postalSuggestion(input: EnergyResolverInput): Promise<EnergyResolverResult | null> {
  const postalCode = normalizePostalCode(input.postalCode)
  if (!postalCode) return null

  const { data, error, count } = await supabaseService
    .from('platform_postal_code_grid_mappings')
    .select('postal_code,city,grid_area_code,price_area,confidence,source,updated_at', { count: 'exact' })
    .eq('postal_code', postalCode)
    .eq('is_active', true)
    .order('confidence', { ascending: false })
    .limit(MAX_POSTAL_CANDIDATES)

  if (error) {
    if (missingSchema(error)) requireResolverSchema('platform_postal_code_grid_mappings', error)
    throw error
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  if (rows.length === 0) return null
  const candidateLimitExceeded = typeof count === 'number' && count > rows.length

  const requestedCity = normalizeCity(input.city)
  const exactCityRows = requestedCity
    ? rows.filter((row) => normalizeCity(row.city) === requestedCity)
    : []
  const candidates = exactCityRows.length > 0 ? exactCityRows : rows
  const gridAreaCodes = [...new Set(
    candidates
      .map((row) => normaliseGridAreaCode(row.grid_area_code))
      .filter((value): value is string => Boolean(value)),
  )]

  const masterPriceAreas = new Map<string, PriceArea>()
  if (gridAreaCodes.length > 0) {
    const masterResponse = await supabaseService
      .from('platform_grid_areas')
      .select('grid_area_code,price_area')
      .in('grid_area_code', gridAreaCodes)
      .eq('is_active', true)
    if (masterResponse.error) {
      if (missingSchema(masterResponse.error)) requireResolverSchema('platform_grid_areas', masterResponse.error)
      throw masterResponse.error
    }
    for (const row of masterResponse.data ?? []) {
      const code = normaliseGridAreaCode(row.grid_area_code)
      const area = normalisePriceArea(row.price_area)
      if (code && area) masterPriceAreas.set(code, area)
    }
  }

  const classified = candidates.map((row) => {
    const gridAreaCode = normaliseGridAreaCode(row.grid_area_code)
    const rowPriceArea = normalisePriceArea(row.price_area)
    const masterPriceArea = gridAreaCode ? masterPriceAreas.get(gridAreaCode) ?? null : null
    const mappingConflict = Boolean(rowPriceArea && masterPriceArea && rowPriceArea !== masterPriceArea)
    return {
      row,
      gridAreaCode,
      rowPriceArea,
      masterPriceArea,
      priceArea: masterPriceArea ?? rowPriceArea,
      mappingConflict,
      confidence: Math.max(0, Math.min(1, numberOrNull(row.confidence) ?? 0)),
    }
  })
  const unknownCandidateCount = classified.filter((candidate) => !candidate.priceArea).length
  const mappingConflictCount = classified.filter((candidate) => candidate.mappingConflict).length
  const uniquePriceAreas = [...new Set(
    classified
      .flatMap((candidate) => [candidate.rowPriceArea, candidate.masterPriceArea])
      .filter((value): value is PriceArea => Boolean(value)),
  )]
  const source = exactCityRows.length > 0 ? 'postal_city_consensus' as const : 'postal_consensus' as const
  const best = classified[0]
  const bestMaster = best?.gridAreaCode ? await findGridAreaByCode(best.gridAreaCode) : null
  const rawConfidence = classified.reduce((max, candidate) => Math.max(max, candidate.confidence), 0)
  const confidence = Math.min(exactCityRows.length > 0 ? 0.9 : 0.85, rawConfidence)
  const evidence = {
    postal_code: postalCode,
    requested_city: clean(input.city),
    city_scope: exactCityRows.length > 0 ? 'exact_city' : 'postal_code',
    candidate_count: classified.length,
    total_postal_candidate_count: count ?? rows.length,
    candidate_limit_exceeded: candidateLimitExceeded,
    unknown_candidate_count: unknownCandidateCount,
    mapping_conflict_count: mappingConflictCount,
    grid_area_codes: [...new Set(classified.map((candidate) => candidate.gridAreaCode).filter(Boolean))],
    price_areas: uniquePriceAreas,
    sources: [...new Set(classified.map((candidate) => clean(candidate.row.source)).filter(Boolean))],
    newest_mapping_at: classified
      .map((candidate) => clean(candidate.row.updated_at))
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null,
  }

  if (uniquePriceAreas.length > 1 || mappingConflictCount > 0) {
    return result(input, {
      suggestedGridAreaCode: best?.gridAreaCode ?? null,
      suggestedGridOwnerId: bestMaster?.gridOwnerId ?? null,
      suggestedGridOwnerName: bestMaster?.gridOwnerName ?? null,
      suggestionSource: source,
      suggestionConfidence: confidence,
      priceArea: null,
      priceAreaAssurance: {
        status: 'ambiguous',
        priceArea: null,
        confidence,
        source,
        candidateCount: candidateLimitExceeded ? (count ?? classified.length) : classified.length,
        uniquePriceAreaCount: uniquePriceAreas.length,
        sourceVersion: clean(evidence.newest_mapping_at),
        evidence,
      },
      resolutionStatus: 'postal_suggested',
      confidence,
      sourceChain: ['postal_code', 'platform_postal_code_grid_mappings', 'postal_price_area_consensus'],
      automationAllowed: false,
      conflictCode: mappingConflictCount > 0 ? 'postal_mapping_master_conflict' : 'postal_price_area_ambiguous',
      nextRequiredAction: mappingConflictCount > 0
        ? 'Postnummermappningen motsäger nätområdets masterdata. Korrigera masterdata eller komplettera full adress.'
        : 'Komplettera full adress eller verifierat nätområde. Postnumret omfattar flera elprisområden.',
      warnings: [
        ...(uniquePriceAreas.length > 1 ? ['postal_candidates_cross_price_areas'] : []),
        ...(mappingConflictCount > 0 ? ['postal_mapping_master_conflict'] : []),
      ],
      diagnostics: {
        addressAttempts: [],
        geocodeProvider: 'papilite',
        geocodeStatus: papiliteConfigured() ? 'no_match' : 'missing_api_key',
        providerStatus: 'not_attempted',
        providerHttpStatus: null,
        providerErrorCode: mappingConflictCount > 0 ? 'postal_mapping_master_conflict' : 'postal_price_area_ambiguous',
        coordinateReferenceSystem: null,
        polygonStatus: 'not_attempted',
        mappingStatus: 'not_applicable',
      },
    })
  }

  const resolvedPriceArea = uniquePriceAreas[0] ?? null
  const assuranceReady = Boolean(
    resolvedPriceArea &&
    unknownCandidateCount === 0 &&
    !candidateLimitExceeded &&
    confidence >= MIN_POSTAL_PRICE_ASSURANCE_CONFIDENCE,
  )
  const warnings = [
    ...(classified.length > 1 ? ['postal_code_multiple_grid_area_candidates'] : []),
    ...(unknownCandidateCount > 0 ? ['postal_candidate_price_area_missing'] : []),
    ...(candidateLimitExceeded ? ['postal_candidate_limit_exceeded'] : []),
    ...(!assuranceReady ? ['postal_price_area_confidence_insufficient'] : []),
  ]

  return result(input, {
    suggestedGridAreaCode: best?.gridAreaCode ?? null,
    suggestedGridOwnerId: bestMaster?.gridOwnerId ?? null,
    suggestedGridOwnerName: bestMaster?.gridOwnerName ?? null,
    suggestionSource: source,
    suggestionConfidence: confidence,
    priceArea: resolvedPriceArea,
    priceAreaAssurance: assuranceReady
      ? {
          status: 'estimated',
          priceArea: resolvedPriceArea,
          confidence,
          source,
          candidateCount: candidateLimitExceeded ? (count ?? classified.length) : classified.length,
          uniquePriceAreaCount: resolvedPriceArea ? 1 : 0,
          sourceVersion: clean(evidence.newest_mapping_at),
          evidence,
        }
      : unresolvedPriceAreaAssurance({
          priceArea: resolvedPriceArea,
          confidence,
          source,
          candidateCount: candidateLimitExceeded ? (count ?? classified.length) : classified.length,
          uniquePriceAreaCount: resolvedPriceArea ? 1 : 0,
          sourceVersion: clean(evidence.newest_mapping_at),
          evidence,
        }),
    resolutionStatus: 'postal_suggested',
    confidence,
    sourceChain: ['postal_code', 'platform_postal_code_grid_mappings', 'postal_price_area_consensus', ...(bestMaster ? ['platform_grid_areas'] : [])],
    automationAllowed: false,
    nextRequiredAction: assuranceReady
      ? nextActionFor('postal_suggested', false)
      : 'Komplettera full adress för att fastställa elprisområdet med tillräcklig säkerhet.',
    warnings,
    diagnostics: {
      addressAttempts: [],
      geocodeProvider: 'papilite',
      geocodeStatus: papiliteConfigured() ? 'no_match' : 'missing_api_key',
      providerStatus: 'not_attempted',
      providerHttpStatus: null,
      providerErrorCode: assuranceReady ? 'postal_price_area_consensus_used' : 'postal_price_area_unresolved',
      coordinateReferenceSystem: null,
      polygonStatus: 'not_attempted',
      mappingStatus: 'not_applicable',
    },
  })
}

function priceAreaCanMaterialize(resolved: EnergyResolverResult): boolean {
  if (!resolved.priceArea || resolved.priceAreaAssurance.uniquePriceAreaCount !== 1) return false
  if (resolved.priceAreaAssurance.status === 'verified') return true
  return resolved.priceAreaAssurance.status === 'estimated'
    && resolved.priceAreaAssurance.confidence >= MIN_POSTAL_PRICE_ASSURANCE_CONFIDENCE
}

async function saveResolution(input: EnergyResolverInput, resolved: EnergyResolverResult): Promise<EnergyResolverResult> {
  if (!input.companyId) return resolved
  const now = new Date().toISOString()
  const ttlRaw = Number(process.env.ENERGY_RESOLUTION_TTL_HOURS ?? DEFAULT_RESOLUTION_TTL_HOURS)
  const ttlHours = Number.isFinite(ttlRaw) ? Math.min(Math.max(ttlRaw, 1), 168) : DEFAULT_RESOLUTION_TTL_HOURS
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString()
  const row = {
    company_id: input.companyId,
    customer_id: clean(input.customerId),
    customer_site_id: clean(input.customerSiteId),
    customer_application_id: clean(input.customerApplicationId),
    grid_owner_id: resolved.resolutionStatus === 'postal_suggested' ? null : clean(resolved.gridOwnerId),
    grid_area_code: resolved.resolutionStatus === 'postal_suggested' ? null : clean(resolved.gridAreaCode),
    grid_area_name: resolved.resolutionStatus === 'postal_suggested' ? null : clean(resolved.gridAreaName),
    grid_owner_name: resolved.resolutionStatus === 'postal_suggested' ? clean(resolved.suggestedGridOwnerName) : clean(resolved.gridOwnerName),
    price_area: resolved.priceArea,
    price_area_assurance_status: resolved.priceAreaAssurance.status,
    price_area_assurance_source: resolved.priceAreaAssurance.source,
    price_area_assurance_confidence: resolved.priceAreaAssurance.confidence,
    price_area_assurance_source_version: resolved.priceAreaAssurance.sourceVersion,
    price_area_candidate_count: resolved.priceAreaAssurance.candidateCount,
    price_area_unique_count: resolved.priceAreaAssurance.uniquePriceAreaCount,
    price_area_evidence: resolved.priceAreaAssurance.evidence,
    resolution_status: resolved.resolutionStatus,
    confidence: resolved.confidence,
    source_chain: resolved.sourceChain,
    input_snapshot: input,
    result_snapshot: resolved,
    automation_allowed: Boolean(resolved.automationAllowed && resolved.gridOwnerId && resolved.gridAreaCode && resolved.priceArea && resolved.gridOwnerVerificationStatus === 'verified'),
    next_required_action: resolved.nextRequiredAction,
    resolved_at: now,
    expires_at: expiresAt,
    resolver_version: resolved.resolverVersion ?? RESOLVER_VERSION,
    geodata_version: resolved.geodataVersion ?? null,
    source_claims: { grid_area_code: normaliseGridAreaCode(input.gridAreaCode) },
    conflict_code: resolved.conflictCode ?? null,
    updated_at: now,
  }

  const { data, error } = await supabaseService
    .from('customer_site_resolution')
    .insert(row)
    .select('id')
    .single()

  if (error) {
    if (missingSchema(error)) requireResolverSchema('customer_site_resolution', error)
    throw error
  }

  if (input.customerSiteId) {
    const current = await supabaseService
      .from('customer_sites')
      .select('resolution_status,address_status,facility_data_status,grid_owner_id,grid_area_code,price_area_code,address_hash,metadata')
      .eq('id', input.customerSiteId)
      .eq('company_id', input.companyId)
      .maybeSingle()
    if (current.error) {
      if (missingSchema(current.error)) requireResolverSchema('customer_sites.energy_resolution_columns', current.error)
      throw current.error
    }
    const currentRow = (current.data ?? null) as Record<string, unknown> | null
    const currentStatus = String(currentRow?.resolution_status ?? '').toLowerCase()
    const protectedManualVerification = ['manual_verified', 'facility_verified'].includes(currentStatus)
    const resolvedGridOwnerId = resolved.resolutionStatus === 'postal_suggested' ? null : clean(resolved.gridOwnerId)
    const resolvedGridAreaCode = resolved.resolutionStatus === 'postal_suggested' ? null : clean(resolved.gridAreaCode)
    const currentPriceAreaCode = normalisePriceArea(currentRow?.price_area_code)
    const resolvedPriceAreaCode = priceAreaCanMaterialize(resolved) ? resolved.priceArea : currentPriceAreaCode
    const fullyVerifiedResolution = Boolean(
      resolved.automationAllowed &&
      resolvedGridOwnerId &&
      resolvedGridAreaCode &&
      resolvedPriceAreaCode &&
      resolved.gridOwnerVerificationStatus === 'verified',
    )

    if (!protectedManualVerification || fullyVerifiedResolution) {
      const siteUpdate: Record<string, unknown> = {
        grid_owner_id: resolvedGridOwnerId,
        grid_area_code: resolvedGridAreaCode,
        price_area_code: resolvedPriceAreaCode,
        resolution_id: data.id,
        resolution_status: resolved.resolutionStatus,
        resolution_confidence: resolved.confidence,
        updated_at: now,
      }
      if (resolved.coordinates) {
        siteUpdate.latitude = resolved.coordinates.latitude ?? null
        siteUpdate.longitude = resolved.coordinates.longitude ?? null
        siteUpdate.sweref99_x = resolved.coordinates.sweref99X ?? null
        siteUpdate.sweref99_y = resolved.coordinates.sweref99Y ?? null
      }
      const siteResult = await supabaseService
        .from('customer_sites')
        .update(siteUpdate)
        .eq('id', input.customerSiteId)
        .eq('company_id', input.companyId)
        .select('id')
      if (siteResult.error) {
        if (missingSchema(siteResult.error)) requireResolverSchema('customer_sites.energy_resolution_columns', siteResult.error)
        throw siteResult.error
      }
      if (!siteResult.data?.length) throw new Error('Nätägarresolutionen kunde inte sparas på rätt tenant/anläggning.')
    }
  }

  const saved = { ...resolved, resolutionId: data.id as string, resolvedAt: now, expiresAt, resolverVersion: resolved.resolverVersion ?? RESOLVER_VERSION }
  await recordCanonicalEnergyEvent({
    eventType: saved.resolutionStatus === 'needs_review' || saved.resolutionStatus === 'failed'
      ? 'energy_area.needs_review'
      : 'energy_area.resolved',
    companyId: input.companyId,
    customerId: input.customerId ?? null,
    siteId: input.customerSiteId ?? null,
    resolutionId: saved.resolutionId,
    source: 'ops_energy_resolver',
    payload: {
      price_area: saved.priceArea,
      grid_area_code: saved.gridAreaCode,
      grid_owner_id: saved.gridOwnerId,
      resolution_status: saved.resolutionStatus,
      confidence: saved.confidence,
      price_area_assurance: saved.priceAreaAssurance,
      automation_allowed: saved.automationAllowed,
      resolver_version: saved.resolverVersion,
      geodata_version: saved.geodataVersion,
      conflict_code: saved.conflictCode ?? null,
    },
  })
  return saved
}

export async function resolveEnergyContext(input: EnergyResolverInput): Promise<EnergyResolverResult> {
  const warnings: string[] = []
  try {
    const explicitCode = normaliseGridAreaCode(input.gridAreaCode)
    const explicit = explicitCode ? await findGridAreaByCode(explicitCode) : null
    if (explicitCode && !explicit) warnings.push('grid_area_code_not_found_in_master')

    if (hasFullAddress(input) && exactAddressProviderAllowed(input)) {
      const cached = await cachedAddressCoordinates(input)
      if (cached) {
        const geocode: GeocodeLookup = {
          coordinates: cached,
          warnings: [],
          diagnostics: {
            addressAttempts: [],
            geocodeProvider: 'cache',
            geocodeStatus: 'success',
            providerStatus: 'cache_hit',
            providerHttpStatus: null,
            providerErrorCode: null,
            coordinateReferenceSystem: cached.sweref99X !== null && cached.sweref99Y !== null ? 'EPSG:3006' : 'EPSG:4326',
            polygonStatus: 'not_attempted',
            mappingStatus: 'not_applicable',
          },
        }
        const polygon = await pointToGridArea(input, cached)
        if (polygon) {
          if (explicitCode && polygon.gridAreaCode && explicitCode !== normaliseGridAreaCode(polygon.gridAreaCode)) {
            return saveResolution(input, {
              ...polygon,
              resolutionStatus: 'needs_review',
              automationAllowed: false,
              conflictCode: 'grid_area_address_mismatch',
              sourceChain: [...polygon.sourceChain, 'client_grid_area_claim_cross_validation'],
              nextRequiredAction: 'Inskickad nätområdeskod matchar inte adressens polygon. Granska uppgifterna innan quote eller leverantörsbyte.',
              warnings: [...warnings, ...polygon.warnings, 'grid_area_address_mismatch'],
              diagnostics: { ...geocode.diagnostics, ...polygon.diagnostics, polygonStatus: 'matched' },
            })
          }
          return saveResolution(input, {
            ...polygon,
            sourceChain: explicitCode ? [...polygon.sourceChain, 'client_grid_area_claim_validated'] : polygon.sourceChain,
            warnings: [...warnings, ...polygon.warnings],
            diagnostics: { ...geocode.diagnostics, ...polygon.diagnostics, polygonStatus: 'matched' },
          })
        }
        warnings.push(cached.sweref99X === null && cached.longitude !== null ? 'polygon_wgs84_transform_unavailable_or_no_match' : 'polygon_no_match')
      } else {
        warnings.push('exact_address_cache_miss')
      }
    }

    if (explicit) {
      return saveResolution(input, result(input, {
        gridAreaCode: explicit.gridAreaCode,
        gridAreaName: explicit.gridAreaName,
        gridOwnerId: explicit.gridOwnerId,
        gridOwnerName: explicit.gridOwnerName,
        priceArea: explicit.priceArea,
        resolutionStatus: 'needs_review',
        confidence: Math.min(explicit.confidence, 0.6),
        sourceChain: ['client_grid_area_claim', 'platform_grid_areas'],
        automationAllowed: false,
        conflictCode: 'grid_area_claim_unverified',
        nextRequiredAction: 'Nätområdeskoden är endast ett klientpåstående. Komplettera full adress eller invänta verifierade anläggningsuppgifter från OPS/nätägaren.',
        warnings: [...warnings, 'grid_area_claim_requires_address_cross_validation'],
      }))
    }

    const postal = await postalSuggestion(input)
    if (postal) return saveResolution(input, { ...postal, warnings: [...postal.warnings, ...warnings] })

    const centroidLookup = await lookupPapilitePostalCentroid(input)
    warnings.push(...centroidLookup.warnings)
    if (centroidLookup.coordinates) {
      const centroid = await priceAreaFromPostalCentroid(input, centroidLookup)
      if (centroid) return saveResolution(input, { ...centroid, warnings: [...centroid.warnings, ...warnings] })
    }

    return saveResolution(input, result(input, {
      resolutionStatus: explicitCode || (hasFullAddress(input) && exactAddressProviderAllowed(input)) ? 'needs_review' : 'postal_suggested',
      confidence: 0,
      sourceChain: ['input'],
      nextRequiredAction: explicitCode || (hasFullAddress(input) && exactAddressProviderAllowed(input))
        ? 'Nätområde kunde inte verifieras från adressen. Granska adressmatchning, geodata och masterdata innan något skickas.'
        : 'Komplettera full adress eller verifiera postnumret manuellt för att fastställa nätområde.',
      warnings: [...warnings, 'no_energy_resolution_candidate'],
    }))
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? null
    const schemaResource = error instanceof ResolverSchemaError ? error.resource : null
    const failed = result(input, {
      resolutionStatus: 'failed',
      confidence: 0,
      sourceChain: ['energy_resolver_error'],
      nextRequiredAction: schemaResource
        ? 'OPS saknar ett nödvändigt schemaobjekt för nätområdesmatchning. Kör driftkontrollen och senaste migration innan automation fortsätter.'
        : 'Teknisk admin behöver kontrollera resolver, geodataimport eller schema.',
      warnings: [...warnings, schemaResource ? `resolver_schema_missing:${schemaResource}` : code ? `resolver_database_error_${code}` : 'resolver_unexpected_error'],
      diagnostics: {
        addressAttempts: [],
        geocodeProvider: 'papilite',
        geocodeStatus: 'provider_unavailable',
        providerStatus: schemaResource ? 'schema_missing' : 'failed',
        providerHttpStatus: null,
        providerErrorCode: schemaResource ? `schema_missing:${schemaResource}` : (code ?? 'resolver_failed'),
        coordinateReferenceSystem: null,
        polygonStatus: schemaResource ? 'schema_missing' : 'not_attempted',
        mappingStatus: 'not_applicable',
      },
    })
    return schemaResource ? failed : saveResolution(input, failed).catch(() => failed)
  }
}

export async function publicPriceAreaByPostalCode(postalCodeRaw: string | null) {
  const postalCode = normalizePostalCode(postalCodeRaw)
  if (!postalCode) {
    return { postalCode: postalCodeRaw, priceArea: null, confidence: 0, disclaimer: 'Ange ett svenskt postnummer.' }
  }

  let suggestion = await postalSuggestion({ postalCode })
  if (!suggestion) {
    const centroidLookup = await lookupPapilitePostalCentroid({ postalCode })
    if (centroidLookup.coordinates) {
      suggestion = await priceAreaFromPostalCentroid({ postalCode }, centroidLookup)
    }
  }
  return {
    postalCode,
    priceArea: suggestion?.priceArea ?? null,
    confidence: suggestion?.confidence ?? 0,
    disclaimer: suggestion?.priceAreaAssurance.source === 'postal_centroid'
      ? 'Prisområdet är uppskattat från postnumrets geografiska centroid. Nätområde och nätägare verifieras separat och centroiden används aldrig som anläggningsposition.'
      : 'Prisområde från postnummer är preliminärt. Nätområdeskod och nätägare verifieras först via verifierad geodata, anläggningsdata och masterdata i OPS.',
  }
}

export async function upsertPlatformGridAreaMasterRows(rows: Array<{ gridOwnerName?: string | null; gridAreaName?: string | null; gridAreaCode?: string | null; priceArea?: string | null; metadata?: Record<string, unknown> }>) {
  const results: Array<{ gridAreaCode: string | null; ok: boolean; id?: string | null; error?: string }> = []
  for (const row of rows) {
    const code = normaliseGridAreaCode(row.gridAreaCode)
    if (!code) {
      results.push({ gridAreaCode: null, ok: false, error: 'grid_area_code saknas' })
      continue
    }
    const { data, error } = await supabaseService.rpc('gridex_import_grid_area_master_row', {
      p_grid_owner_name: clean(row.gridOwnerName) ?? 'Okänd nätägare',
      p_grid_area_name: clean(row.gridAreaName),
      p_grid_area_code: code,
      p_price_area: normalisePriceArea(row.priceArea),
      p_source: 'manual_platform_import',
      p_metadata: row.metadata ?? {},
    })
    results.push({ gridAreaCode: code, ok: !error, id: data as string | null, error: error?.message })
  }
  return results
}
