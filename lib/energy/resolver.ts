import { supabaseService } from '@/lib/supabase/service'
import type { EnergyResolverInput, EnergyResolverResult, EnergyResolutionStatus, PriceArea } from '@/lib/energy/types'
import { getGridOwnerVerification } from '@/lib/grid-owners/verification'

const PRICE_AREAS: PriceArea[] = ['SE1', 'SE2', 'SE3', 'SE4']

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

function normalisePriceArea(value: unknown): PriceArea | null {
  const area = clean(value)?.toUpperCase()
  return PRICE_AREAS.includes(area as PriceArea) ? area as PriceArea : null
}

export function normaliseGridAreaCode(value: unknown): string | null {
  return clean(value)?.replace(/\s+/g, '').toUpperCase() ?? null
}

export function normalizePostalCode(value: unknown): string | null {
  const digits = clean(value)?.replace(/\D/g, '') ?? ''
  return digits.length >= 3 ? digits : null
}

function hasFullAddress(input: EnergyResolverInput): boolean {
  return Boolean(clean(input.street) && normalizePostalCode(input.postalCode) && clean(input.city))
}

function addressKey(input: EnergyResolverInput): string | null {
  if (!hasFullAddress(input)) return null
  return [input.street, input.streetNumber, input.postalCode, input.city, input.country ?? 'SE']
    .map((part) => clean(part)?.toLowerCase().replace(/\s+/g, ' ') ?? '')
    .join('|')
}

function lookupKey(input: EnergyResolverInput): string {
  return [
    normaliseGridAreaCode(input.gridAreaCode) ?? '',
    clean(input.street)?.toLowerCase() ?? '',
    normalizePostalCode(input.postalCode) ?? '',
    clean(input.city)?.toLowerCase() ?? '',
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
    ...patch,
  }
}

function nextActionFor(status: EnergyResolutionStatus, hasFacilityData: boolean): string {
  if (status === 'facility_verified') return 'Starta leverantörsbyte när övriga readiness-krav är uppfyllda.'
  if (hasFacilityData && status === 'grid_area_master_validated') return 'Verifiera anläggningsuppgifter och starta leverantörsbyte när fullmakt och avtal är klara.'
  if (status === 'grid_area_master_validated') return 'Begär anläggningsuppgifter från nätägare innan leverantörsbyte kan startas.'
  if (status === 'postal_suggested') return 'Komplettera full adress för säker nätområdesmatchning.'
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
    if (missingSchema(error)) return id
    throw error
  }
  return clean((data as { ops_grid_owner_id?: string | null } | null)?.ops_grid_owner_id) ?? id
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
  if (verification.verificationStatus !== 'verified' || !verification.verifiedForCustomerFlow) {
    return {
      ...resolved,
      automationAllowed: false,
      gridOwnerVerificationStatus: verification.verificationStatus,
      gridOwnerVerificationIssues: verification.reasons.length ? verification.reasons : [verification.verificationStatus],
      warnings: [...resolved.warnings, `grid_owner_${verification.verificationStatus}`],
      nextRequiredAction: verification.nextAction ?? 'Verifiera nätägare, route, subadress, kontaktväg och certifikat innan automation fortsätter.',
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
    if (missingSchema(error)) return null
    throw error
  }
  if (!data) return null
  const ownerRelation = data.platform_grid_owners as { name?: string | null; ops_grid_owner_id?: string | null } | null | undefined
  const opsGridOwnerId = clean(ownerRelation?.ops_grid_owner_id) ?? await mapPlatformGridOwnerToOpsGridOwner(clean(data.grid_owner_id))
  return applyGridOwnerVerification(result({}, {
    gridAreaCode: clean(data.grid_area_code),
    gridAreaName: clean(data.grid_area_name),
    gridOwnerId: opsGridOwnerId,
    gridOwnerName: clean(ownerRelation?.name) ?? clean(data.grid_owner_name),
    priceArea: normalisePriceArea(data.price_area),
    resolutionStatus: normalisePriceArea(data.price_area) ? 'grid_area_master_validated' : 'grid_area_resolved',
    confidence: normalisePriceArea(data.price_area) ? 0.98 : 0.82,
    sourceChain: ['input.grid_area_code', 'platform_grid_areas'],
    automationAllowed: Boolean(normalisePriceArea(data.price_area)),
    nextRequiredAction: nextActionFor(normalisePriceArea(data.price_area) ? 'grid_area_master_validated' : 'grid_area_resolved', false),
    lookupKey: gridAreaCode,
  }))
}

async function cachedAddressCoordinates(input: EnergyResolverInput) {
  const key = addressKey(input)
  if (!key) return null
  const { data, error } = await supabaseService
    .from('platform_address_lookup_cache')
    .select('*')
    .eq('address_key', key)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .maybeSingle()

  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  if (!data) return null
  return {
    addressKey: key,
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

async function lookupPapilite(input: EnergyResolverInput) {
  const url = process.env.PAPILITE_GEOCODE_URL
  const key = addressKey(input)
  if (!url || !key || !hasFullAddress(input)) return null

  const endpoint = new URL(url)
  endpoint.searchParams.set('street', clean(input.street) ?? '')
  if (clean(input.streetNumber)) endpoint.searchParams.set('street_number', clean(input.streetNumber) ?? '')
  endpoint.searchParams.set('postal_code', normalizePostalCode(input.postalCode) ?? '')
  endpoint.searchParams.set('city', clean(input.city) ?? '')
  endpoint.searchParams.set('country', clean(input.country) ?? 'SE')

  const headers: Record<string, string> = { accept: 'application/json' }
  if (process.env.PAPILITE_API_KEY) headers.authorization = `Bearer ${process.env.PAPILITE_API_KEY}`

  const response = await fetch(endpoint.toString(), { headers, cache: 'no-store' })
  if (!response.ok) return null
  const payload = await response.json().catch(() => null) as unknown
  const candidate = Array.isArray(payload)
    ? payload[0]
    : isRecord(payload) && Array.isArray(payload.results)
      ? payload.results[0]
      : payload
  if (!isRecord(candidate)) return null

  const latitude = numberOrNull(firstFromRecord(candidate, ['latitude', 'lat', 'y']))
  const longitude = numberOrNull(firstFromRecord(candidate, ['longitude', 'lng', 'lon', 'x']))
  const sweref99X = numberOrNull(firstFromRecord(candidate, ['sweref99_x', 'swerefX', 'rt90_x']))
  const sweref99Y = numberOrNull(firstFromRecord(candidate, ['sweref99_y', 'swerefY', 'rt90_y']))
  if ((!sweref99X || !sweref99Y) && (!latitude || !longitude)) return null

  const row = {
    address_key: key,
    street: clean(input.street),
    postal_code: normalizePostalCode(input.postalCode),
    city: clean(input.city),
    country: clean(input.country) ?? 'SE',
    latitude,
    longitude,
    sweref99_x: sweref99X,
    sweref99_y: sweref99Y,
    provider: 'papilite',
    confidence: numberOrNull(candidate.confidence) ?? 0.78,
    raw_payload: isRecord(payload) ? payload : { payload },
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString(),
    updated_at: new Date().toISOString(),
  }

  await supabaseService
    .from('platform_address_lookup_cache')
    .upsert(row, { onConflict: 'address_key' })
    .throwOnError()

  return {
    addressKey: key,
    latitude,
    longitude,
    sweref99X,
    sweref99Y,
    confidence: row.confidence,
    raw: row.raw_payload as Record<string, unknown>,
  }
}

async function pointToGridArea(input: EnergyResolverInput, coordinates: { sweref99X?: number | null; sweref99Y?: number | null; latitude?: number | null; longitude?: number | null; confidence?: number }) {
  // Polygonmatchen ska primärt köras på SWEREF99 TM (EPSG:3006), samma spatial reference som SVK/ArcGIS-lagret.
  if (!coordinates.sweref99X || !coordinates.sweref99Y) return null
  const { data, error } = await supabaseService.rpc('gridex_point_to_grid_area', {
    p_x: coordinates.sweref99X,
    p_y: coordinates.sweref99Y,
  })
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  const status: EnergyResolutionStatus = normalisePriceArea(row.price_area) && clean(row.grid_owner_name)
    ? 'grid_area_master_validated'
    : 'grid_area_resolved'
  const opsGridOwnerId = await mapPlatformGridOwnerToOpsGridOwner(clean(row.grid_owner_id))
  return applyGridOwnerVerification(result(input, {
    gridAreaCode: clean(row.grid_area_code),
    gridAreaName: clean(row.grid_area_name),
    gridOwnerId: opsGridOwnerId,
    gridOwnerName: clean(row.grid_owner_name),
    priceArea: normalisePriceArea(row.price_area),
    resolutionStatus: status,
    confidence: Math.max(0.75, numberOrNull(row.confidence) ?? coordinates.confidence ?? 0.84),
    sourceChain: ['address', 'papilite/cache', 'svk_arcgis_polygon', 'platform_grid_areas'],
    automationAllowed: status === 'grid_area_master_validated',
    nextRequiredAction: nextActionFor(status, Boolean(clean(input.facilityId) && clean(input.meteringPointId))),
    coordinates: {
      latitude: coordinates.latitude ?? null,
      longitude: coordinates.longitude ?? null,
      sweref99X: coordinates.sweref99X ?? null,
      sweref99Y: coordinates.sweref99Y ?? null,
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
    if (missingSchema(error)) return null
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
    if (!missingSchema(error)) throw error
    return { ...resolved, warnings: [...resolved.warnings, 'customer_site_resolution_schema_missing'] }
  }

  if (input.customerSiteId) {
    const siteUpdate: Record<string, unknown> = {
      grid_area_code: resolved.gridAreaCode,
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
    if (siteResult.error && !missingSchema(siteResult.error)) throw siteResult.error
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
      const coordinates = await cachedAddressCoordinates(input) ?? await lookupPapilite(input)
      if (coordinates) {
        const polygon = await pointToGridArea(input, coordinates)
        if (polygon) return saveResolution(input, { ...polygon, warnings })
        warnings.push('polygon_no_match')
        return saveResolution(input, result(input, {
          resolutionStatus: 'address_resolved',
          confidence: Math.max(0.55, coordinates.confidence ?? 0.6),
          sourceChain: ['address', 'papilite/cache'],
          nextRequiredAction: nextActionFor('address_resolved', false),
          coordinates: {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            sweref99X: coordinates.sweref99X,
            sweref99Y: coordinates.sweref99Y,
          },
          warnings,
        }))
      }
      warnings.push(process.env.PAPILITE_GEOCODE_URL ? 'papilite_no_result' : 'papilite_not_configured')
    }

    const postal = await postalSuggestion(input)
    if (postal) return saveResolution(input, { ...postal, warnings: [...postal.warnings, ...warnings] })

    return saveResolution(input, result(input, {
      resolutionStatus: explicitCode || hasFullAddress(input) ? 'needs_review' : 'postal_suggested',
      confidence: 0,
      sourceChain: ['input'],
      nextRequiredAction: explicitCode || hasFullAddress(input)
        ? 'Granska nätområde manuellt eller kör om adressmatchning när geodata/import är klar.'
        : 'Komplettera full adress för automatisk nätområdesmatchning.',
      warnings: [...warnings, 'no_energy_resolution_candidate'],
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Energy Resolver misslyckades.'
    return saveResolution(input, result(input, {
      resolutionStatus: 'failed',
      confidence: 0,
      sourceChain: ['energy_resolver_error'],
      nextRequiredAction: 'Teknisk admin behöver kontrollera resolver, geodataimport eller schema.',
      warnings: [...warnings, message],
    }))
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
