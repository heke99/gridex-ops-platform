import { supabaseService } from '@/lib/supabase/service'
import { normaliseSwedishAddress } from '@/lib/energy/address'
import type {
  EnergyResolverDiagnostics,
  EnergyResolverInput,
  EnergyResolverResult,
  EnergyResolutionStatus,
  PriceArea,
} from '@/lib/energy/types'
import { getGridOwnerVerification } from '@/lib/grid-owners/verification'

const PRICE_AREAS: PriceArea[] = ['SE1', 'SE2', 'SE3', 'SE4']
const GEOCODE_TIMEOUT_MS = 10_000

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

  // Provider-specific normalised form first, exact input second for providers
  // which accept a full address in one field.
  add(parsed.streetName, parsed.streetNumber)
  add(parsed.originalStreet, clean(input.streetNumber))
  return attempts
}

function addressKey(input: EnergyResolverInput): string | null {
  return addressAttempts(input)[0]?.key ?? null
}

function lookupKey(input: EnergyResolverInput): string {
  return [
    normaliseGridAreaCode(input.gridAreaCode) ?? '',
    addressKey(input) ?? '',
    clean(input.facilityId) ?? '',
    clean(input.meteringPointId) ?? '',
  ].join('|')
}

function result(input: EnergyResolverInput, patch: Partial<EnergyResolverResult>): EnergyResolverResult {
  return {
    gridAreaCode: null,
    gridAreaName: null,
    gridOwnerId: null,
    gridOwnerName: null,
    priceArea: null,
    resolutionStatus: 'failed',
    confidence: 0,
    sourceChain: [],
    automationAllowed: false,
    nextRequiredAction: 'Granska adress- och nätområdesuppgifter manuellt.',
    lookupKey: lookupKey(input),
    warnings: [],
    diagnostics: {
      addressAttempts: [],
      geocodeProvider: process.env.PAPILITE_GEOCODE_URL ? 'papilite' : null,
      geocodeStatus: null,
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
  if (status === 'postal_suggested') return 'Komplettera eller granska full adress för säker nätområdesmatchning.'
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
      geocodeStatus: null,
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
  return {
    addressKey: clean(data.address_key) ?? keys[0],
    latitude: numberOrNull(data.latitude),
    longitude: numberOrNull(data.longitude),
    sweref99X: numberOrNull(data.sweref99_x),
    sweref99Y: numberOrNull(data.sweref99_y),
    confidence: numberOrNull(data.confidence) ?? 0.7,
    raw: isRecord(data.raw_payload) ? data.raw_payload : {},
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

  // GeoJSON positions are always longitude, latitude. Raw x/y fields are only
  // accepted when the provider explicitly declares SWEREF99 TM (EPSG:3006).
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

async function lookupPapilite(input: EnergyResolverInput): Promise<GeocodeLookup> {
  const url = clean(process.env.PAPILITE_GEOCODE_URL)
  const attempts = addressAttempts(input)
  const diagnostics: EnergyResolverDiagnostics = {
    addressAttempts: [],
    geocodeProvider: url ? 'papilite' : null,
    geocodeStatus: url ? 'not_started' : 'not_configured',
    coordinateReferenceSystem: null,
    polygonStatus: 'not_attempted',
    mappingStatus: 'not_applicable',
  }
  if (!url || attempts.length === 0 || !hasFullAddress(input)) {
    return { coordinates: null, warnings: [url ? 'address_not_complete_for_geocoding' : 'papilite_not_configured'], diagnostics }
  }

  for (const attempt of attempts) {
    const endpoint = new URL(url)
    endpoint.searchParams.set('street', attempt.street)
    if (attempt.streetNumber) endpoint.searchParams.set('street_number', attempt.streetNumber)
    endpoint.searchParams.set('postal_code', normalizePostalCode(input.postalCode) ?? '')
    endpoint.searchParams.set('city', clean(input.city) ?? '')
    endpoint.searchParams.set('country', clean(input.country) ?? 'SE')

    const headers: Record<string, string> = { accept: 'application/json' }
    if (process.env.PAPILITE_API_KEY) headers.authorization = `Bearer ${process.env.PAPILITE_API_KEY}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS)
    try {
      const response = await fetch(endpoint.toString(), {
        headers,
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      })
      diagnostics.addressAttempts?.push({ street: attempt.street, streetNumber: attempt.streetNumber, outcome: response.ok ? 'response_received' : 'http_error', httpStatus: response.status })
      if (!response.ok) {
        diagnostics.geocodeHttpStatus = response.status
        diagnostics.geocodeStatus = response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 429 ? 'rate_limited' : 'provider_error'
        continue
      }
      const payload = await response.json().catch(() => null) as unknown
      diagnostics.geocodeHttpStatus = response.status
      diagnostics.geocodeResponseShape = Array.isArray(payload)
        ? 'array'
        : payload && typeof payload === 'object'
          ? `object:${Object.keys(payload as Record<string, unknown>).sort().slice(0, 8).join(',')}`
          : typeof payload
      const candidate = candidateFromPayload(payload)
      if (!candidate) {
        diagnostics.addressAttempts?.push({ street: attempt.street, streetNumber: attempt.streetNumber, outcome: 'no_match' })
        diagnostics.geocodeStatus = 'no_match'
        continue
      }

      const { latitude, longitude, sweref99X, sweref99Y } = coordinatesFromCandidate(candidate)
      if ((sweref99X === null || sweref99Y === null) && (latitude === null || longitude === null)) {
        diagnostics.addressAttempts?.push({ street: attempt.street, streetNumber: attempt.streetNumber, outcome: 'coordinates_missing' })
        diagnostics.geocodeStatus = 'invalid_response'
        continue
      }

      const coordinates: Coordinates = {
        addressKey: attempt.key,
        latitude,
        longitude,
        sweref99X,
        sweref99Y,
        confidence: numberOrNull(candidate.confidence) ?? 0.78,
        raw: isRecord(payload) ? payload : { payload },
      }
      const row = {
        address_key: attempt.key,
        street: attempt.street,
        postal_code: normalizePostalCode(input.postalCode),
        city: clean(input.city),
        country: clean(input.country) ?? 'SE',
        latitude,
        longitude,
        sweref99_x: sweref99X,
        sweref99_y: sweref99Y,
        provider: 'papilite',
        confidence: coordinates.confidence,
        raw_payload: coordinates.raw,
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString(),
        updated_at: new Date().toISOString(),
      }
      const cache = await supabaseService.from('platform_address_lookup_cache').upsert(row, { onConflict: 'address_key' })
      const warnings = cache.error && !missingSchema(cache.error) ? ['address_cache_write_failed'] : []
      diagnostics.addressAttempts?.push({ street: attempt.street, streetNumber: attempt.streetNumber, outcome: 'matched' })
      diagnostics.geocodeStatus = 'matched'
      diagnostics.coordinateReferenceSystem = sweref99X !== null && sweref99Y !== null ? 'EPSG:3006' : 'EPSG:4326'
      return { coordinates, warnings, diagnostics }
    } catch (error) {
      const outcome = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'provider_unavailable'
      diagnostics.addressAttempts?.push({ street: attempt.street, streetNumber: attempt.streetNumber, outcome })
      diagnostics.geocodeStatus = outcome
    } finally {
      clearTimeout(timeout)
    }
  }

  const status = diagnostics.geocodeStatus
  const warning = status === 'unauthorized'
    ? 'papilite_unauthorized'
    : status === 'rate_limited'
      ? 'papilite_rate_limited'
      : status === 'timeout'
        ? 'papilite_timeout'
        : status === 'provider_unavailable'
          ? 'papilite_unavailable'
          : status === 'invalid_response'
            ? 'papilite_invalid_response'
            : 'papilite_no_result'
  return { coordinates: null, warnings: [warning], diagnostics }
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
  return applyGridOwnerVerification(result(input, {
    gridAreaCode: clean(row.grid_area_code),
    gridAreaName: clean(row.grid_area_name),
    gridOwnerId: opsGridOwnerId,
    gridOwnerName: clean(row.grid_owner_name),
    priceArea: normalisePriceArea(row.price_area),
    resolutionStatus: status,
    confidence: Math.max(0.75, numberOrNull(row.confidence) ?? coordinates.confidence ?? 0.84),
    sourceChain: ['address', 'papilite/cache', 'svk_arcgis_polygon', 'platform_grid_areas'],
    automationAllowed: status === 'grid_area_master_validated' && !mappingMissing,
    nextRequiredAction: mappingMissing
      ? 'Nätområdet är känt men saknar OPS-nätägar-mappning. Granska masterdata innan Ediel skickas.'
      : nextActionFor(status, Boolean(clean(input.facilityId) && clean(input.meteringPointId))),
    coordinates: {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      sweref99X: coordinates.sweref99X,
      sweref99Y: coordinates.sweref99Y,
    },
    warnings: mappingMissing ? ['platform_to_ops_grid_owner_mapping_missing'] : [],
    diagnostics: {
      addressAttempts: [],
      geocodeProvider: 'papilite',
      geocodeStatus: 'matched',
      coordinateReferenceSystem,
      polygonStatus: 'matched',
      mappingStatus: mappingMissing ? 'platform_to_ops_missing' : 'mapped',
    },
  }))
}

async function postalSuggestion(input: EnergyResolverInput): Promise<EnergyResolverResult | null> {
  const postalCode = normalizePostalCode(input.postalCode)
  if (!postalCode) return null
  let query = supabaseService
    .from('platform_postal_code_grid_mappings')
    .select('postal_code,city,grid_area_code,price_area,confidence,source')
    .eq('postal_code', postalCode)
    .eq('is_active', true)
    .order('confidence', { ascending: false })
    .limit(5)

  const city = clean(input.city)
  if (city) query = query.ilike('city', city)

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) requireResolverSchema('platform_postal_code_grid_mappings', error)
    throw error
  }
  const rows = data ?? []
  if (rows.length === 0) return null
  const best = rows[0]
  const master = clean(best.grid_area_code) ? await findGridAreaByCode(clean(best.grid_area_code) as string) : null
  return applyGridOwnerVerification(result(input, {
    gridAreaCode: clean(best.grid_area_code),
    gridAreaName: master?.gridAreaName ?? null,
    gridOwnerId: master?.gridOwnerId ?? null,
    gridOwnerName: master?.gridOwnerName ?? null,
    priceArea: normalisePriceArea(best.price_area) ?? master?.priceArea ?? null,
    resolutionStatus: 'postal_suggested',
    confidence: Math.min(0.69, numberOrNull(best.confidence) ?? 0.35),
    sourceChain: ['postal_code', 'platform_postal_code_grid_mappings', ...(master ? ['platform_grid_areas'] : [])],
    automationAllowed: false,
    nextRequiredAction: nextActionFor('postal_suggested', false),
    warnings: rows.length > 1 ? ['postal_code_multiple_grid_area_candidates'] : [],
  }))
}

async function saveResolution(input: EnergyResolverInput, resolved: EnergyResolverResult): Promise<EnergyResolverResult> {
  if (!input.companyId) return resolved
  const now = new Date().toISOString()
  const row = {
    company_id: input.companyId,
    customer_id: clean(input.customerId),
    customer_site_id: clean(input.customerSiteId),
    customer_application_id: clean(input.customerApplicationId),
    grid_owner_id: clean(resolved.gridOwnerId),
    grid_area_code: clean(resolved.gridAreaCode),
    grid_area_name: clean(resolved.gridAreaName),
    grid_owner_name: clean(resolved.gridOwnerName),
    price_area: resolved.priceArea,
    resolution_status: resolved.resolutionStatus,
    confidence: resolved.confidence,
    source_chain: resolved.sourceChain,
    input_snapshot: input,
    result_snapshot: resolved,
    automation_allowed: resolved.automationAllowed,
    next_required_action: resolved.nextRequiredAction,
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
    const siteUpdate: Record<string, unknown> = {
      grid_owner_id: resolved.gridOwnerId,
      grid_area_code: resolved.gridAreaCode,
      price_area_code: resolved.priceArea,
      resolution_id: data.id,
      resolution_status: resolved.resolutionStatus,
      resolution_confidence: resolved.confidence,
      latitude: resolved.coordinates?.latitude ?? null,
      longitude: resolved.coordinates?.longitude ?? null,
      sweref99_x: resolved.coordinates?.sweref99X ?? null,
      sweref99_y: resolved.coordinates?.sweref99Y ?? null,
      updated_at: now,
    }
    const siteResult = await supabaseService
      .from('customer_sites')
      .update(siteUpdate)
      .eq('id', input.customerSiteId)
      .eq('company_id', input.companyId)
    if (siteResult.error) {
      if (missingSchema(siteResult.error)) requireResolverSchema('customer_sites.energy_resolution_columns', siteResult.error)
      throw siteResult.error
    }
  }

  return { ...resolved, resolutionId: data.id as string }
}

export async function resolveEnergyContext(input: EnergyResolverInput): Promise<EnergyResolverResult> {
  const warnings: string[] = []
  try {
    const explicitCode = normaliseGridAreaCode(input.gridAreaCode)
    if (explicitCode) {
      const explicit = await findGridAreaByCode(explicitCode)
      if (explicit) {
        return saveResolution(input, {
          ...explicit,
          lookupKey: lookupKey(input),
          nextRequiredAction: nextActionFor(explicit.resolutionStatus, Boolean(clean(input.facilityId) && clean(input.meteringPointId))),
        })
      }
      warnings.push('grid_area_code_not_found_in_master')
    }

    if (hasFullAddress(input)) {
      const cached = await cachedAddressCoordinates(input)
      const geocode = cached
        ? {
            coordinates: cached,
            warnings: [] as string[],
            diagnostics: {
              addressAttempts: [],
              geocodeProvider: 'cache',
              geocodeStatus: 'cache_hit',
              coordinateReferenceSystem: cached.sweref99X !== null && cached.sweref99Y !== null ? 'EPSG:3006' as const : 'EPSG:4326' as const,
              polygonStatus: 'not_attempted' as const,
              mappingStatus: 'not_applicable' as const,
            },
          }
        : await lookupPapilite(input)
      warnings.push(...geocode.warnings)
      if (geocode.coordinates) {
        const polygon = await pointToGridArea(input, geocode.coordinates)
        if (polygon) {
          return saveResolution(input, {
            ...polygon,
            warnings: [...warnings, ...polygon.warnings],
            diagnostics: { ...geocode.diagnostics, ...polygon.diagnostics, polygonStatus: 'matched' },
          })
        }
        warnings.push(geocode.coordinates.sweref99X === null && geocode.coordinates.longitude !== null ? 'polygon_wgs84_transform_unavailable_or_no_match' : 'polygon_no_match')
        return saveResolution(input, result(input, {
          resolutionStatus: 'address_resolved',
          confidence: Math.max(0.55, geocode.coordinates.confidence),
          sourceChain: ['address', cached ? 'address_cache' : 'papilite'],
          nextRequiredAction: 'Adressen hittades men kunde inte kopplas till ett verifierat nätområde. Granska geodata eller nätområdesmasterdata.',
          coordinates: {
            latitude: geocode.coordinates.latitude,
            longitude: geocode.coordinates.longitude,
            sweref99X: geocode.coordinates.sweref99X,
            sweref99Y: geocode.coordinates.sweref99Y,
          },
          warnings,
          diagnostics: { ...geocode.diagnostics, polygonStatus: 'no_match' },
        }))
      }
    }

    const postal = await postalSuggestion(input)
    if (postal) return saveResolution(input, { ...postal, warnings: [...postal.warnings, ...warnings] })

    return saveResolution(input, result(input, {
      resolutionStatus: explicitCode || hasFullAddress(input) ? 'needs_review' : 'postal_suggested',
      confidence: 0,
      sourceChain: ['input'],
      nextRequiredAction: explicitCode || hasFullAddress(input)
        ? 'Nätområde kunde inte verifieras från adressen. Granska adressmatchning, geodata och masterdata innan något skickas.'
        : 'Komplettera full adress för automatisk nätområdesmatchning.',
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
        geocodeProvider: process.env.PAPILITE_GEOCODE_URL ? 'papilite' : null,
        geocodeStatus: schemaResource ? 'schema_missing' : 'failed',
        coordinateReferenceSystem: null,
        polygonStatus: schemaResource ? 'schema_missing' : 'not_attempted',
        mappingStatus: 'not_applicable',
      },
    })
    // A missing result table must never be reported as absent business data.
    // Avoid a second failing write when the schema itself is unavailable.
    return schemaResource ? failed : saveResolution(input, failed).catch(() => failed)
  }
}

export async function publicPriceAreaByPostalCode(postalCodeRaw: string | null) {
  const postalCode = normalizePostalCode(postalCodeRaw)
  if (!postalCode) {
    return { postalCode: postalCodeRaw, priceArea: null, confidence: 0, disclaimer: 'Ange ett svenskt postnummer.' }
  }

  const suggestion = await postalSuggestion({ postalCode })
  return {
    postalCode,
    priceArea: suggestion?.priceArea ?? null,
    confidence: suggestion?.confidence ?? 0,
    disclaimer: 'Prisområde från postnummer är preliminärt. Nätområdeskod och nätägare verifieras först via full adress, geodata och masterdata i OPS.',
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
