import { supabaseService } from '@/lib/supabase/service'
import { normaliseSwedishAddress } from '@/lib/energy/address'

const DEFAULT_BASE_URL = 'https://api.lantmateriet.se/distribution/produkter/belagenhetsadress/v4.2'
const REQUEST_TIMEOUT_MS = 8_000
const CACHE_TTL_DAYS = 30

type JsonRecord = Record<string, unknown>

export type LantmaterietExactAddressInput = {
  street: string | null | undefined
  streetNumber?: string | null
  postalCode: string | null | undefined
  city: string | null | undefined
  country?: string | null
}

export type LantmaterietExactAddressResult = {
  configured: boolean
  status: 'not_configured' | 'invalid_address' | 'no_match' | 'ambiguous' | 'unauthorized' | 'provider_unavailable' | 'invalid_response' | 'cached'
  addressKey: string | null
  sweref99X: number | null
  sweref99Y: number | null
  candidateCount: number
  objectIdentity: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function postal(value: unknown): string | null {
  const digits = clean(value)?.replace(/\D/g, '') ?? ''
  return /^\d{5}$/.test(digits) ? digits : null
}

function normalize(value: string | null): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('sv-SE')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactToken(value: string | null): string {
  return normalize(value).replace(/[^a-z0-9åäö]/gi, '')
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function baseUrl() {
  return clean(process.env.LANTMATERIET_BELAGENHETSADRESS_BASE_URL)?.replace(/\/$/, '') ?? DEFAULT_BASE_URL
}

export function lantmaterietExactAddressConfigured() {
  return Boolean(
    clean(process.env.LANTMATERIET_BELAGENHETSADRESS_USERNAME)
    && clean(process.env.LANTMATERIET_BELAGENHETSADRESS_PASSWORD),
  )
}

function authHeader(): string | null {
  const username = clean(process.env.LANTMATERIET_BELAGENHETSADRESS_USERNAME)
  const password = clean(process.env.LANTMATERIET_BELAGENHETSADRESS_PASSWORD)
  if (!username || !password) return null
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
}

function cacheKey(input: LantmaterietExactAddressInput) {
  const parsed = normaliseSwedishAddress(input.street, input.streetNumber)
  const postCode = postal(input.postalCode)
  const city = clean(input.city)
  const country = (clean(input.country) ?? 'SE').toUpperCase()
  if (!parsed.streetName || !parsed.streetNumber || !postCode || !city || country !== 'SE') return null
  return [parsed.streetName, parsed.streetNumber, postCode, city, country]
    .map((part) => normalize(part))
    .join('|')
}

function requestParts(input: LantmaterietExactAddressInput) {
  const parsed = normaliseSwedishAddress(input.street, input.streetNumber)
  const postCode = postal(input.postalCode)
  const city = clean(input.city)
  const country = (clean(input.country) ?? 'SE').toUpperCase()
  if (!parsed.streetName || !parsed.streetNumber || !postCode || !city || country !== 'SE') return null
  return {
    street: parsed.streetName,
    streetNumber: parsed.streetNumber,
    postalCode: postCode,
    city,
    country,
    addressKey: cacheKey(input) as string,
    searchText: `${parsed.streetName} ${parsed.streetNumber}, ${postCode.slice(0, 3)} ${postCode.slice(3)} ${city}`,
  }
}

async function jsonFetch(url: string, authorization: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { authorization, accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (response.status === 401 || response.status === 403) return { status: response.status, data: null as unknown }
    if (!response.ok) return { status: response.status, data: null as unknown }
    return { status: response.status, data: await response.json().catch(() => null) as unknown }
  } finally {
    clearTimeout(timeout)
  }
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  if (!record) return []
  for (const key of ['results', 'result', 'referenser', 'references', 'items']) {
    if (Array.isArray(record[key])) return record[key] as unknown[]
  }
  return []
}

function candidateIdentity(candidate: unknown): string | null {
  const record = asRecord(candidate)
  if (!record) return null
  for (const key of ['objektidentitet', 'objectIdentity', 'object_identity', 'id']) {
    const value = clean(record[key])
    if (value) return value
  }
  return null
}

function candidateText(candidate: unknown): string {
  if (typeof candidate === 'string') return candidate
  try { return JSON.stringify(candidate) } catch { return '' }
}

function exactCandidate(candidate: unknown, parts: NonNullable<ReturnType<typeof requestParts>>) {
  const text = compactToken(candidateText(candidate))
  if (!text) return false
  const required = [parts.street, parts.streetNumber, parts.postalCode, parts.city]
    .map((value) => compactToken(value))
    .filter(Boolean)
  return required.every((token) => text.includes(token))
}

function geometryCoordinates(value: unknown): { x: number; y: number } | null {
  const record = asRecord(value)
  if (!record) return null
  const features = Array.isArray(record.features) ? record.features : []
  const feature = asRecord(features[0])
  const geometry = asRecord(feature?.geometry)
  const coordinates = Array.isArray(geometry?.coordinates) ? geometry?.coordinates : null
  if (coordinates && coordinates.length >= 2) {
    const x = numberValue(coordinates[0])
    const y = numberValue(coordinates[1])
    if (x !== null && y !== null) return { x, y }
  }
  const geometryDirect = asRecord(record.geometry)
  const direct = Array.isArray(geometryDirect?.coordinates) ? geometryDirect?.coordinates : null
  if (direct && direct.length >= 2) {
    const x = numberValue(direct[0])
    const y = numberValue(direct[1])
    if (x !== null && y !== null) return { x, y }
  }
  return null
}

async function persistExactAddressPoint(input: {
  parts: NonNullable<ReturnType<typeof requestParts>>
  x: number
  y: number
  objectIdentity: string
  searchReference: unknown
  detail: unknown
}) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + CACHE_TTL_DAYS * 86_400_000).toISOString()
  const row = {
    address_key: input.parts.addressKey,
    street: input.parts.street,
    street_number: input.parts.streetNumber,
    postal_code: input.parts.postalCode,
    city: input.parts.city,
    country: input.parts.country,
    latitude: null,
    longitude: null,
    sweref99_x: input.x,
    sweref99_y: input.y,
    provider: 'lantmateriet_belagenhetsadress_v4_2',
    confidence: 1,
    raw_payload: {
      coordinate_scope: 'exact_address_point',
      source_authority: 'lantmateriet_fastighetsregistret',
      object_identity: input.objectIdentity,
      search_reference: input.searchReference,
      detail: input.detail,
    },
    expires_at: expiresAt,
    updated_at: now.toISOString(),
  }
  const { error } = await supabaseService
    .from('platform_address_lookup_cache')
    .upsert(row, { onConflict: 'address_key' })
  if (error) throw error
}

export async function ensureLantmaterietExactAddressPoint(
  input: LantmaterietExactAddressInput,
): Promise<LantmaterietExactAddressResult> {
  const configured = lantmaterietExactAddressConfigured()
  const parts = requestParts(input)
  if (!configured) {
    return { configured: false, status: 'not_configured', addressKey: parts?.addressKey ?? null, sweref99X: null, sweref99Y: null, candidateCount: 0, objectIdentity: null }
  }
  if (!parts) {
    return { configured: true, status: 'invalid_address', addressKey: null, sweref99X: null, sweref99Y: null, candidateCount: 0, objectIdentity: null }
  }

  const authorization = authHeader() as string
  const root = baseUrl()

  try {
    // Lantmäteriet exposes a dedicated address autocomplete endpoint and a
    // reference lookup endpoint. We intentionally require an unambiguous exact
    // address reference; a street/postal centroid is never persisted here.
    const autoUrl = `${root}/autocomplete/adress?adress=${encodeURIComponent(parts.searchText)}&maxHits=5`
    const autocomplete = await jsonFetch(autoUrl, authorization)
    if (autocomplete.status === 401 || autocomplete.status === 403) {
      return { configured: true, status: 'unauthorized', addressKey: parts.addressKey, sweref99X: null, sweref99Y: null, candidateCount: 0, objectIdentity: null }
    }

    const autoCandidates = list(autocomplete.data)
    const autoExact = autoCandidates.filter((candidate) => exactCandidate(candidate, parts))
    const selectedSearchText = typeof autoExact[0] === 'string' && autoExact.length === 1
      ? autoExact[0]
      : parts.searchText

    const referenceUrl = `${root}/referens/fritext?adress=${encodeURIComponent(selectedSearchText)}&maxHits=5`
    const reference = await jsonFetch(referenceUrl, authorization)
    if (reference.status === 401 || reference.status === 403) {
      return { configured: true, status: 'unauthorized', addressKey: parts.addressKey, sweref99X: null, sweref99Y: null, candidateCount: 0, objectIdentity: null }
    }
    if (reference.status !== 200 || !reference.data) {
      return { configured: true, status: reference.status === 404 ? 'no_match' : 'provider_unavailable', addressKey: parts.addressKey, sweref99X: null, sweref99Y: null, candidateCount: 0, objectIdentity: null }
    }

    const references = list(reference.data)
    const candidates = references.filter((candidate) => candidateIdentity(candidate))
    const exact = candidates.filter((candidate) => exactCandidate(candidate, parts))
    const usable = exact.length > 0 ? exact : candidates
    if (usable.length === 0) {
      return { configured: true, status: 'no_match', addressKey: parts.addressKey, sweref99X: null, sweref99Y: null, candidateCount: 0, objectIdentity: null }
    }
    // Fail closed on ambiguity. We never pick the first of several address
    // objects merely because it is returned first by the provider.
    if (usable.length !== 1) {
      return { configured: true, status: 'ambiguous', addressKey: parts.addressKey, sweref99X: null, sweref99Y: null, candidateCount: usable.length, objectIdentity: null }
    }

    const selected = usable[0]
    const objectIdentity = candidateIdentity(selected)
    if (!objectIdentity) {
      return { configured: true, status: 'invalid_response', addressKey: parts.addressKey, sweref99X: null, sweref99Y: null, candidateCount: 1, objectIdentity: null }
    }

    const detailUrl = `${root}/${encodeURIComponent(objectIdentity)}?includeData=basinformation&srid=3006`
    const detail = await jsonFetch(detailUrl, authorization)
    if (detail.status === 401 || detail.status === 403) {
      return { configured: true, status: 'unauthorized', addressKey: parts.addressKey, sweref99X: null, sweref99Y: null, candidateCount: 1, objectIdentity }
    }
    if (detail.status !== 200 || !detail.data) {
      return { configured: true, status: 'provider_unavailable', addressKey: parts.addressKey, sweref99X: null, sweref99Y: null, candidateCount: 1, objectIdentity }
    }

    const point = geometryCoordinates(detail.data)
    if (!point) {
      return { configured: true, status: 'invalid_response', addressKey: parts.addressKey, sweref99X: null, sweref99Y: null, candidateCount: 1, objectIdentity }
    }

    // SWEREF99 TM (EPSG:3006) sanity envelope for Sweden. This protects the
    // polygon resolver from accidentally treating WGS84 lon/lat as projected
    // coordinates when a provider contract changes.
    if (point.x < 200_000 || point.x > 1_000_000 || point.y < 6_000_000 || point.y > 8_000_000) {
      return { configured: true, status: 'invalid_response', addressKey: parts.addressKey, sweref99X: null, sweref99Y: null, candidateCount: 1, objectIdentity }
    }

    await persistExactAddressPoint({
      parts,
      x: point.x,
      y: point.y,
      objectIdentity,
      searchReference: selected,
      detail: detail.data,
    })

    return {
      configured: true,
      status: 'cached',
      addressKey: parts.addressKey,
      sweref99X: point.x,
      sweref99Y: point.y,
      candidateCount: 1,
      objectIdentity,
    }
  } catch (error) {
    console.error('[lantmateriet-exact-address] lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { configured: true, status: 'provider_unavailable', addressKey: parts.addressKey, sweref99X: null, sweref99Y: null, candidateCount: 0, objectIdentity: null }
  }
}
