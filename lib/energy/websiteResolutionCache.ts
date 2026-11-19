import { createHash } from 'node:crypto'

import { normaliseSwedishAddress } from '@/lib/energy/address'
import { resolveEnergyContext, normaliseGridAreaCode, normalizePostalCode } from '@/lib/energy/resolver'
import type { EnergyResolverInput, EnergyResolverResult } from '@/lib/energy/types'
import { supabaseService } from '@/lib/supabase/service'

const CACHE_SCHEMA_VERSION = 'website-energy-resolution-v2-papilite-first'
const CACHE_TTL_MS = 15 * 60 * 1000
const pendingResolutions = new Map<string, Promise<EnergyResolverResult>>()

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizedText(value: unknown): string {
  return clean(value)?.normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/\s+/g, ' ') ?? ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function cacheEligibleInput(input: EnergyResolverInput): input is EnergyResolverInput & { companyId: string } {
  return Boolean(
    clean(input.companyId) &&
      !clean(input.customerId) &&
      !clean(input.customerSiteId) &&
      !clean(input.customerApplicationId),
  )
}

export function websiteEnergyResolutionCacheKey(input: EnergyResolverInput): string | null {
  const companyId = clean(input.companyId)
  if (!companyId) return null

  const parsedAddress = normaliseSwedishAddress(input.street, input.streetNumber)
  const identity = {
    grid_area_code: normaliseGridAreaCode(input.gridAreaCode) ?? '',
    street: normalizedText(parsedAddress.streetName ?? input.street),
    street_number: normalizedText(parsedAddress.streetNumber ?? input.streetNumber),
    postal_code: normalizePostalCode(input.postalCode) ?? '',
    city: normalizedText(input.city),
    country: normalizedText(input.country ?? 'SE').toUpperCase(),
    facility_id: normalizedText(input.facilityId),
    metering_point_id: normalizedText(input.meteringPointId),
  }
  const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  return `${CACHE_SCHEMA_VERSION}:${companyId}:${digest}`
}

function cacheableResult(result: EnergyResolverResult): boolean {
  return Boolean(
    clean(result.resolutionId) &&
      result.priceArea &&
      result.priceAreaAssurance.uniquePriceAreaCount === 1 &&
      (result.priceAreaAssurance.status === 'verified' || result.priceAreaAssurance.status === 'estimated') &&
      !['failed', 'needs_review'].includes(result.resolutionStatus) &&
      (!result.expiresAt || Date.parse(result.expiresAt) > Date.now()),
  )
}

function cachedResult(value: unknown): EnergyResolverResult | null {
  if (!isRecord(value)) return null
  if (!clean(value.resolutionId) || !clean(value.lookupKey)) return null
  if (!isRecord(value.priceAreaAssurance)) return null
  if (!Array.isArray(value.sourceChain) || !Array.isArray(value.warnings)) return null
  if (!clean(value.resolutionStatus) || !clean(value.nextRequiredAction)) return null

  const result = value as unknown as EnergyResolverResult
  if (!cacheableResult(result)) return null
  return {
    ...result,
    sourceChain: [...result.sourceChain, 'platform_energy_lookup_cache'],
    diagnostics: {
      ...(result.diagnostics ?? {}),
      geocodeProvider: 'resolution_cache',
      providerStatus: 'resolution_cache_hit',
    },
  }
}

async function readCachedResolution(key: string): Promise<EnergyResolverResult | null> {
  const now = new Date().toISOString()
  const response = await supabaseService
    .from('platform_energy_lookup_cache')
    .select('result,expires_at')
    .eq('lookup_key', key)
    .gt('expires_at', now)
    .maybeSingle()

  if (response.error) {
    console.warn('[website-energy-resolution-cache] read failed; resolving normally', {
      code: response.error.code ?? null,
    })
    return null
  }
  if (!response.data) return null

  const expiresAt = clean(response.data.expires_at)
  if (!expiresAt || Date.parse(expiresAt) <= Date.now()) return null
  return cachedResult(response.data.result)
}

async function writeCachedResolution(key: string, companyId: string, result: EnergyResolverResult): Promise<void> {
  if (!cacheableResult(result)) return

  const resolutionExpiry = result.expiresAt ? Date.parse(result.expiresAt) : Number.POSITIVE_INFINITY
  const cacheExpiry = Math.min(Date.now() + CACHE_TTL_MS, resolutionExpiry)
  if (!Number.isFinite(cacheExpiry) || cacheExpiry <= Date.now()) return

  const now = new Date().toISOString()
  const response = await supabaseService
    .from('platform_energy_lookup_cache')
    .upsert(
      {
        lookup_key: key,
        input: {
          cache_schema_version: CACHE_SCHEMA_VERSION,
          company_id: companyId,
        },
        result,
        resolution_status: result.resolutionStatus,
        confidence: result.confidence,
        expires_at: new Date(cacheExpiry).toISOString(),
        updated_at: now,
      },
      { onConflict: 'lookup_key' },
    )

  if (response.error) {
    console.warn('[website-energy-resolution-cache] write failed; result remains valid', {
      code: response.error.code ?? null,
    })
  }
}

function pendingResolutionKey(cacheKey: string, resolverInput: EnergyResolverInput): string | null {
  try {
    // The resolver stores this input with its receipt. Include each persisted
    // value, even provenance that the durable address cache does not use.
    const entries = Object.entries(resolverInput).sort(([left], [right]) => left.localeCompare(right))
    const identity = JSON.stringify([cacheKey, Object.fromEntries(entries)])
    return createHash('sha256').update(identity).digest('hex')
  } catch {
    return null
  }
}

async function readOrResolve(cacheKey: string, companyId: string, resolverInput: EnergyResolverInput): Promise<EnergyResolverResult> {
  const cached = await readCachedResolution(cacheKey)
  if (cached) return cached

  const resolved = await resolveEnergyContext(resolverInput)
  await writeCachedResolution(cacheKey, companyId, resolved)
  return resolved
}

/**
 * Website-only fast path. The public website needs authoritative SE1-SE4 from
 * OPS, but it must not depend on exact-address/Lantmateriet evidence. Exact
 * address precision belongs to the customer continuation flow after signup.
 *
 * Keep the original address in this cache key/token context, but deliberately
 * remove street data from the resolver call so it can use verified postcode
 * masterdata and Papilite postcode centroid only. Bumping the cache schema
 * prevents an older exact-address result from being served to the website.
 */
export async function resolveWebsiteEnergyContext(input: EnergyResolverInput): Promise<EnergyResolverResult> {
  const resolverInput = {
    ...input,
    street: null,
    streetNumber: null,
    metadata: {
      ...(input.metadata ?? {}),
      resolution_mode: 'website_price_area_only',
      exact_address_provider_allowed: false,
    },
  }
  if (!cacheEligibleInput(input)) return resolveEnergyContext(resolverInput)
  const cacheKey = websiteEnergyResolutionCacheKey(input)
  if (!cacheKey) return resolveEnergyContext(resolverInput)

  const key = pendingResolutionKey(cacheKey, resolverInput)
  if (!key) return readOrResolve(cacheKey, input.companyId, resolverInput)
  const existing = pendingResolutions.get(key)
  if (existing) return existing

  const pending = readOrResolve(cacheKey, input.companyId, resolverInput).finally(() => {
    pendingResolutions.delete(key)
  })
  pendingResolutions.set(key, pending)
  return pending
}
