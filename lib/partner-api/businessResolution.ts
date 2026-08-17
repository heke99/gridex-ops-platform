import type { NextResponse } from 'next/server'
import { deriveEnergyResolutionReadiness } from '@/lib/energy/resolutionBinding'
import { normalizePostalCode, resolveEnergyContext } from '@/lib/energy/resolver'
import type { EnergyResolverResult } from '@/lib/energy/types'
import { supabaseService } from '@/lib/supabase/service'

export type PartnerLocationInput = {
  postalCode: string | null
  address?: string | null
  city?: string | null
  country?: string | null
}

export type PartnerPublicLocation = {
  postal_code: string
  city: string | null
  price_area: 'SE1' | 'SE2' | 'SE3' | 'SE4'
  grid_area: { code: string; name: string | null } | null
  grid_owner: { name: string } | null
  resolution: {
    status: 'resolved' | 'pricing_ready' | 'needs_address'
    confidence: number
    source: string | null
    grid_owner_verified: boolean
  }
}

type PersistedEnergyResolverResult = EnergyResolverResult & {
  resolutionId?: string
  resolvedAt?: string
  expiresAt?: string
}

export class PartnerLocationResolutionError extends Error {
  readonly code: 'postal_code_invalid' | 'location_not_resolved' | 'location_ambiguous' | 'location_requires_address'
  readonly status: number
  readonly requiredFields: string[]

  constructor(input: {
    code: PartnerLocationResolutionError['code']
    message: string
    status?: number
    requiredFields?: string[]
  }) {
    super(input.message)
    this.name = 'PartnerLocationResolutionError'
    this.code = input.code
    this.status = input.status ?? 422
    this.requiredFields = input.requiredFields ?? []
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter((item): item is string => Boolean(item))
    : []
}

function publicLocation(
  input: PartnerLocationInput,
  resolved: PersistedEnergyResolverResult,
): PartnerPublicLocation | null {
  const postalCode = normalizePostalCode(input.postalCode)
  if (!postalCode || !resolved.priceArea) return null

  const evidence = record(resolved.priceAreaAssurance.evidence)
  const candidateGridAreas = Array.from(new Set(stringArray(evidence.grid_area_codes)))
  const singlePostalGridArea = candidateGridAreas.length === 1
  const gridAreaCode = text(resolved.gridAreaCode)
    ?? (singlePostalGridArea ? text(resolved.suggestedGridAreaCode) : null)
  const gridAreaName = text(resolved.gridAreaName)
  const gridOwnerName = text(resolved.gridOwnerName)
    ?? (singlePostalGridArea ? text(resolved.suggestedGridOwnerName) : null)
  const gridOwnerVerified = Boolean(resolved.gridOwnerId && resolved.gridAreaCode)

  const readiness = deriveEnergyResolutionReadiness({
    priceArea: resolved.priceArea,
    gridAreaCode: resolved.gridAreaCode,
    gridOwnerId: resolved.gridOwnerId,
    resolutionStatus: resolved.resolutionStatus,
    confidence: resolved.confidence,
    priceAreaAssuranceStatus: resolved.priceAreaAssurance.status,
    priceAreaAssuranceSource: resolved.priceAreaAssurance.source,
    priceAreaAssuranceConfidence: resolved.priceAreaAssurance.confidence,
    priceAreaAssuranceSourceVersion: resolved.priceAreaAssurance.sourceVersion,
    priceAreaCandidateCount: resolved.priceAreaAssurance.candidateCount,
    priceAreaUniqueCount: resolved.priceAreaAssurance.uniquePriceAreaCount,
    priceAreaEvidence: resolved.priceAreaAssurance.evidence,
    conflictCode: resolved.conflictCode,
    expiresAt: resolved.expiresAt,
  })

  const status: PartnerPublicLocation['resolution']['status'] = gridAreaCode && gridOwnerName
    ? 'resolved'
    : readiness.capabilities.pricing_ready
      ? 'pricing_ready'
      : 'needs_address'

  return {
    postal_code: postalCode,
    city: text(input.city),
    price_area: resolved.priceArea,
    grid_area: gridAreaCode ? { code: gridAreaCode, name: gridAreaName } : null,
    grid_owner: gridOwnerName ? { name: gridOwnerName } : null,
    resolution: {
      status,
      confidence: resolved.confidence,
      source: resolved.priceAreaAssurance.source,
      grid_owner_verified: gridOwnerVerified,
    },
  }
}

export async function resolvePartnerLocation(input: {
  companyId: string
  location: PartnerLocationInput
  purpose: 'location' | 'pricing'
  customerId?: string | null
  customerSiteId?: string | null
}) {
  const postalCode = normalizePostalCode(input.location.postalCode)
  if (!postalCode) {
    throw new PartnerLocationResolutionError({
      code: 'postal_code_invalid',
      message: 'postal_code must contain exactly five digits.',
      status: 400,
      requiredFields: ['postal_code'],
    })
  }

  const resolved = await resolveEnergyContext({
    companyId: input.companyId,
    customerId: input.customerId ?? null,
    customerSiteId: input.customerSiteId ?? null,
    street: text(input.location.address),
    postalCode,
    city: text(input.location.city),
    country: text(input.location.country) ?? 'SE',
  }) as PersistedEnergyResolverResult

  if (!resolved.resolutionId) {
    throw new PartnerLocationResolutionError({
      code: 'location_not_resolved',
      message: 'Gridex could not create a verifiable energy-area resolution.',
    })
  }

  const readiness = deriveEnergyResolutionReadiness({
    priceArea: resolved.priceArea,
    gridAreaCode: resolved.gridAreaCode,
    gridOwnerId: resolved.gridOwnerId,
    resolutionStatus: resolved.resolutionStatus,
    confidence: resolved.confidence,
    priceAreaAssuranceStatus: resolved.priceAreaAssurance.status,
    priceAreaAssuranceSource: resolved.priceAreaAssurance.source,
    priceAreaAssuranceConfidence: resolved.priceAreaAssurance.confidence,
    priceAreaAssuranceSourceVersion: resolved.priceAreaAssurance.sourceVersion,
    priceAreaCandidateCount: resolved.priceAreaAssurance.candidateCount,
    priceAreaUniqueCount: resolved.priceAreaAssurance.uniquePriceAreaCount,
    priceAreaEvidence: resolved.priceAreaAssurance.evidence,
    conflictCode: resolved.conflictCode,
    expiresAt: resolved.expiresAt,
  })

  if (!readiness.capabilities.pricing_ready) {
    const ambiguous = resolved.priceAreaAssurance.status === 'ambiguous'
      || resolved.priceAreaAssurance.uniquePriceAreaCount > 1
      || resolved.conflictCode === 'postal_price_area_ambiguous'
    throw new PartnerLocationResolutionError({
      code: ambiguous ? 'location_ambiguous' : 'location_requires_address',
      message: ambiguous
        ? 'The postal code covers more than one electricity area. Add the full address and city.'
        : 'The postal code alone is not sufficient to resolve the electricity area. Add the full address and city.',
      requiredFields: ['address', 'city'],
    })
  }

  const location = publicLocation(input.location, resolved)
  if (!location) {
    throw new PartnerLocationResolutionError({
      code: 'location_not_resolved',
      message: 'Gridex could not resolve the electricity area.',
    })
  }

  if (input.purpose === 'location' && (!location.grid_area || !location.grid_owner)) {
    const evidence = record(resolved.priceAreaAssurance.evidence)
    const candidateGridAreas = Array.from(new Set(stringArray(evidence.grid_area_codes)))
    throw new PartnerLocationResolutionError({
      code: candidateGridAreas.length > 1 ? 'location_ambiguous' : 'location_requires_address',
      message: candidateGridAreas.length > 1
        ? 'The postal code maps to more than one grid area. Add the full address and city.'
        : 'Grid owner could not be resolved safely from postal code alone. Add the full address and city.',
      requiredFields: ['address', 'city'],
    })
  }

  return {
    resolutionId: resolved.resolutionId,
    resolved,
    readiness,
    location,
  }
}

function responseRecord(value: unknown): Record<string, unknown> {
  return record(value)
}

function extractCreatedSiteReference(payload: Record<string, unknown>, path: string[]): string | null {
  if (path.length === 1 && (path[0] === 'contract' || path[0] === 'contracts')) {
    const direct = responseRecord(payload.site)
    const data = responseRecord(payload.data)
    const nested = responseRecord(data.site)
    return text(direct.entity_id ?? direct.site_reference ?? nested.entity_id ?? nested.site_reference)
  }

  const isSimpleSite = path.length === 3 && path[0] === 'customer' && path[2] === 'site'
  const isLegacySite = path.length === 1 && path[0] === 'sites'
  if (isSimpleSite || isLegacySite) {
    const data = responseRecord(payload.data)
    return text(payload.entity_id ?? payload.site_reference ?? data.entity_id ?? data.site_reference)
  }
  return null
}

/**
 * Contract/site writes keep using the existing transactional Partner API.
 * Once the authenticated write succeeds, this function resolves the newly
 * created canonical customer_sites row with the same resolver used by pricing.
 */
export async function synchronizePartnerCreatedSite(
  response: NextResponse,
  path: string[] | undefined,
): Promise<void> {
  if (response.status < 200 || response.status >= 300) return
  const segments = (path ?? []).filter(Boolean)
  if (!(
    (segments.length === 1 && (segments[0] === 'contract' || segments[0] === 'contracts')) ||
    (segments.length === 3 && segments[0] === 'customer' && segments[2] === 'site') ||
    (segments.length === 1 && segments[0] === 'sites')
  )) return

  let payload: Record<string, unknown>
  try {
    payload = responseRecord(await response.clone().json())
  } catch {
    return
  }
  const siteReference = extractCreatedSiteReference(payload, segments)
  if (!siteReference) return

  const siteResult = await supabaseService
    .from('customer_sites')
    .select('id,company_id,customer_id,facility_id,street,postal_code,city,country,resolution_id')
    .eq('facility_reference', siteReference)
    .limit(2)
  if (siteResult.error) throw siteResult.error
  if ((siteResult.data ?? []).length !== 1) return

  const site = siteResult.data![0]
  // Idempotent write replay: do not create a second equivalent resolution.
  if (site.resolution_id) return

  await resolveEnergyContext({
    companyId: String(site.company_id),
    customerId: site.customer_id ? String(site.customer_id) : null,
    customerSiteId: String(site.id),
    facilityId: text(site.facility_id),
    street: text(site.street),
    postalCode: text(site.postal_code),
    city: text(site.city),
    country: text(site.country) ?? 'SE',
  })
}
