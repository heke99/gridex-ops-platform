import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import type { PriceArea, PriceAreaAssurance, PriceAreaAssuranceSource, PriceAreaAssuranceStatus } from '@/lib/energy/types'

export type LifecycleBlocker = {
  code: string
  message: string
  retryable: boolean
}

export type EnergyResolutionCapabilities = {
  pricing_ready: boolean
  quote_ready: boolean
  facility_lookup_ready: boolean
  switch_request_creatable: boolean
  switch_dispatch_ready: boolean
}

export type EnergyResolutionBlockers = {
  pricing: LifecycleBlocker[]
  quote: LifecycleBlocker[]
  facility_lookup: LifecycleBlocker[]
  switch_creation: LifecycleBlocker[]
  switch_dispatch: LifecycleBlocker[]
}

export type BoundEnergyResolution = {
  id: string
  companyId: string
  priceArea: PriceArea
  gridAreaCode: string | null
  gridAreaName: string | null
  gridOwnerId: string | null
  gridOwnerName: string | null
  resolutionStatus: string
  confidence: number
  priceAreaAssurance: PriceAreaAssurance
  /**
   * Deprecated internal compatibility alias. It now means that the complete
   * switch context has been evaluated, not that pricing is allowed.
   */
  automationAllowed: boolean
  resolvedAt: string
  expiresAt: string
  resolverVersion: string
  geodataVersion: string | null
  sourceChain: unknown
  conflictCode: string | null
  capabilities: EnergyResolutionCapabilities
  blockers: EnergyResolutionBlockers
}

export class EnergyResolutionBindingError extends Error {
  readonly code:
    | 'resolution_not_found'
    | 'resolution_tenant_mismatch'
    | 'resolution_expired'
    | 'resolution_pricing_not_ready'
    | 'resolution_quote_not_ready'
    | 'resolution_facility_lookup_not_ready'
    | 'resolution_switch_not_ready'
    | 'energy_area_needs_review'
  readonly status: number
  readonly field = 'resolution_id'
  readonly details: Record<string, unknown>

  constructor(input: {
    message: string
    code: EnergyResolutionBindingError['code']
    status?: number
    details?: Record<string, unknown>
  }) {
    super(input.message)
    this.name = 'EnergyResolutionBindingError'
    this.code = input.code
    this.status = input.status ?? 422
    this.details = input.details ?? {}
  }
}

type ResolutionReadinessInput = {
  priceArea?: unknown
  gridAreaCode?: unknown
  gridOwnerId?: unknown
  resolutionStatus?: unknown
  confidence?: unknown
  priceAreaAssuranceStatus?: unknown
  priceAreaAssuranceSource?: unknown
  priceAreaAssuranceConfidence?: unknown
  priceAreaAssuranceSourceVersion?: unknown
  priceAreaCandidateCount?: unknown
  priceAreaUniqueCount?: unknown
  priceAreaEvidence?: unknown
  conflictCode?: unknown
  expiresAt?: unknown
  now?: Date
}

type ResolutionRow = Record<string, unknown>
type ResolutionPurpose = 'pricing' | 'quote' | 'facility_lookup' | 'switch_creation'

const MIN_VERIFIED_PRICE_ASSURANCE_CONFIDENCE = 0.75
const MIN_ESTIMATED_PRICE_ASSURANCE_CONFIDENCE = 0.8
const MIN_POSTAL_CENTROID_PRICE_ASSURANCE_CONFIDENCE = 0.7

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function priceArea(value: unknown): PriceArea | null {
  const normalized = text(value)?.toUpperCase()
  return normalized === 'SE1' || normalized === 'SE2' || normalized === 'SE3' || normalized === 'SE4'
    ? normalized
    : null
}

function integerValue(value: unknown): number {
  const parsed = Math.trunc(numberValue(value))
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function assuranceStatus(value: unknown): PriceAreaAssuranceStatus | null {
  const normalized = text(value)
  return normalized === 'verified' || normalized === 'estimated' || normalized === 'ambiguous' || normalized === 'unresolved'
    ? normalized
    : null
}

function assuranceSource(value: unknown): PriceAreaAssuranceSource {
  const normalized = text(value)
  return normalized === 'facility_data' ||
    normalized === 'grid_area_master' ||
    normalized === 'address_polygon' ||
    normalized === 'postal_city_consensus' ||
    normalized === 'postal_consensus' ||
    normalized === 'postal_centroid'
    ? normalized
    : null
}

function normalizePriceAreaAssurance(input: ResolutionReadinessInput): PriceAreaAssurance {
  const area = priceArea(input.priceArea)
  const status = assuranceStatus(input.priceAreaAssuranceStatus)
  if (status) {
    return {
      status,
      priceArea: area,
      confidence: Math.max(0, Math.min(1, numberValue(input.priceAreaAssuranceConfidence))),
      source: assuranceSource(input.priceAreaAssuranceSource),
      candidateCount: integerValue(input.priceAreaCandidateCount),
      uniquePriceAreaCount: integerValue(input.priceAreaUniqueCount),
      sourceVersion: text(input.priceAreaAssuranceSourceVersion),
      evidence: recordValue(input.priceAreaEvidence),
    }
  }

  // Backward compatibility is intentionally conservative. Only historically
  // verified lifecycle states are promoted. Old postal suggestions must be
  // resolved again so that candidate consensus is evaluated by the new model.
  const resolutionStatus = text(input.resolutionStatus) ?? 'failed'
  const legacyVerified = new Set([
    'grid_area_master_validated',
    'facility_data_requested',
    'facility_data_received',
    'facility_verified',
  ])
  if (area && legacyVerified.has(resolutionStatus)) {
    return {
      status: 'verified',
      priceArea: area,
      confidence: Math.max(0, Math.min(1, numberValue(input.confidence))),
      source: resolutionStatus === 'facility_verified' ? 'facility_data' : 'grid_area_master',
      candidateCount: 1,
      uniquePriceAreaCount: 1,
      sourceVersion: null,
      evidence: { legacy_backfill: true, resolution_status: resolutionStatus },
    }
  }

  return {
    status: 'unresolved',
    priceArea: area,
    confidence: 0,
    source: null,
    candidateCount: 0,
    uniquePriceAreaCount: area ? 1 : 0,
    sourceVersion: null,
    evidence: { legacy_unresolved: true },
  }
}

function priceAreaEvidenceAccepted(assurance: PriceAreaAssurance): boolean {
  if (!assurance.priceArea || assurance.uniquePriceAreaCount !== 1) return false
  if (assurance.status === 'verified') {
    return assurance.confidence >= MIN_VERIFIED_PRICE_ASSURANCE_CONFIDENCE
  }
  if (assurance.status === 'estimated') {
    const minimum = assurance.source === 'postal_centroid'
      ? MIN_POSTAL_CENTROID_PRICE_ASSURANCE_CONFIDENCE
      : MIN_ESTIMATED_PRICE_ASSURANCE_CONFIDENCE
    return assurance.confidence >= minimum
  }
  return false
}

function blocker(code: string, message: string, retryable = false): LifecycleBlocker {
  return { code, message, retryable }
}

export function deriveEnergyResolutionReadiness(
  input: ResolutionReadinessInput,
): { capabilities: EnergyResolutionCapabilities; blockers: EnergyResolutionBlockers; priceAreaAssurance: PriceAreaAssurance } {
  const area = priceArea(input.priceArea)
  const status = text(input.resolutionStatus) ?? 'failed'
  const conflictCode = text(input.conflictCode)
  const gridAreaCode = text(input.gridAreaCode)
  const gridOwnerId = text(input.gridOwnerId)
  const expiresAt = text(input.expiresAt)
  const now = (input.now ?? new Date()).getTime()
  const priceAreaAssurance = normalizePriceAreaAssurance(input)

  const pricing: LifecycleBlocker[] = []
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now) {
    pricing.push(blocker(
      'price_area_evidence_expired',
      'Prisområdesunderlaget har gått ut. Kontrollera adressen igen.',
      true,
    ))
  }
  if (status === 'needs_review' || status === 'failed') {
    pricing.push(blocker('energy_area_needs_review', 'Elområdet kräver manuell granskning.'))
  }
  if (priceAreaAssurance.status === 'ambiguous') {
    pricing.push(blocker(
      'price_area_ambiguous',
      'Adressen kan tillhöra flera elprisområden och behöver verifieras.',
    ))
  }
  if (!area) {
    pricing.push(blocker('price_area_missing', 'Prisområde SE1–SE4 kunde inte fastställas.'))
  }
  if (conflictCode && priceAreaAssurance.status !== 'ambiguous') {
    pricing.push(blocker('price_area_conflict', 'Prisområdesunderlaget innehåller motstridiga uppgifter.'))
  }
  if (
    priceAreaAssurance.status !== 'ambiguous' &&
    !priceAreaEvidenceAccepted(priceAreaAssurance)
  ) {
    pricing.push(blocker(
      'price_area_confidence_insufficient',
      'Prisområdet kunde inte fastställas med tillräcklig säkerhet.',
    ))
  }

  const quote = [...pricing]
  const facilityLookup: LifecycleBlocker[] = []
  if (!gridAreaCode) {
    facilityLookup.push(blocker('grid_area_missing', 'Verifierat nätområde saknas.'))
  }
  if (!gridOwnerId) {
    facilityLookup.push(blocker('grid_owner_missing', 'Verifierad nätägare saknas.'))
  }
  if (status === 'needs_review' || status === 'failed' || conflictCode) {
    facilityLookup.push(blocker('energy_area_needs_review', 'Nätområdet kräver manuell granskning.'))
  }

  const switchCreation = [...facilityLookup]
  const switchDispatch = [
    ...switchCreation,
    blocker(
      'switch_context_required',
      'Fullmakt, anläggning, aktuell leverantör, PRODAT-route och transportberedskap måste verifieras i kundflödet.',
    ),
  ]

  const blockers: EnergyResolutionBlockers = {
    pricing,
    quote,
    facility_lookup: facilityLookup,
    switch_creation: switchCreation,
    switch_dispatch: switchDispatch,
  }
  return {
    capabilities: {
      pricing_ready: pricing.length === 0,
      quote_ready: quote.length === 0,
      facility_lookup_ready: facilityLookup.length === 0,
      switch_request_creatable: switchCreation.length === 0,
      // A standalone area resolution can never prove the customer-specific
      // legal, business and transport prerequisites needed for dispatch.
      switch_dispatch_ready: false,
    },
    blockers,
    priceAreaAssurance,
  }
}

async function loadResolutionRow(input: {
  client: IntegrationApiClient
  resolutionId: string
}): Promise<ResolutionRow> {
  const resolutionId = input.resolutionId.trim()
  if (!resolutionId) {
    throw new EnergyResolutionBindingError({
      message: 'resolution_id saknas. Lös först kundens elområde genom OPS.',
      code: 'resolution_not_found',
      status: 400,
    })
  }

  const { data, error } = await supabaseService
    .from('customer_site_resolution')
    .select('id,company_id,price_area,price_area_assurance_status,price_area_assurance_source,price_area_assurance_confidence,price_area_assurance_source_version,price_area_candidate_count,price_area_unique_count,price_area_evidence,grid_area_code,grid_area_name,grid_owner_id,grid_owner_name,resolution_status,confidence,automation_allowed,resolved_at,expires_at,resolver_version,geodata_version,source_chain,conflict_code,created_at')
    .eq('id', resolutionId)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    throw new EnergyResolutionBindingError({
      message: 'Elområdesresolutionen hittades inte.',
      code: 'resolution_not_found',
      status: 404,
    })
  }
  if (data.company_id !== input.client.company_id) {
    throw new EnergyResolutionBindingError({
      // Do not reveal whether an opaque ID belongs to another tenant.
      message: 'Elområdesresolutionen hittades inte.',
      code: 'resolution_tenant_mismatch',
      status: 403,
    })
  }
  return data as ResolutionRow
}

function purposeFailure(
  purpose: ResolutionPurpose,
  blockers: EnergyResolutionBlockers,
): EnergyResolutionBindingError {
  const config = {
    pricing: {
      code: 'resolution_pricing_not_ready',
      message: 'Elområdesresolutionen är inte redo för prissättning.',
      list: blockers.pricing,
    },
    quote: {
      code: 'resolution_quote_not_ready',
      message: 'Elområdesresolutionen är inte redo för quote.',
      list: blockers.quote,
    },
    facility_lookup: {
      code: 'resolution_facility_lookup_not_ready',
      message: 'Elområdesresolutionen är inte redo för anläggningsuppslag.',
      list: blockers.facility_lookup,
    },
    switch_creation: {
      code: 'resolution_switch_not_ready',
      message: 'Elområdesresolutionen är inte redo för att skapa leverantörsbyte.',
      list: blockers.switch_creation,
    },
  } as const
  const failure = config[purpose]
  const first = failure.list[0]
  return new EnergyResolutionBindingError({
    message: first?.message ?? failure.message,
    code: failure.code,
    status: 409,
    details: { blockers: failure.list },
  })
}

async function loadEnergyResolutionForPurpose(input: {
  client: IntegrationApiClient
  resolutionId: string
  purpose: ResolutionPurpose
  now?: Date
}): Promise<BoundEnergyResolution> {
  const data = await loadResolutionRow(input)
  const now = input.now ?? new Date()
  const readiness = deriveEnergyResolutionReadiness({
    priceArea: data.price_area,
    gridAreaCode: data.grid_area_code,
    gridOwnerId: data.grid_owner_id,
    resolutionStatus: data.resolution_status,
    confidence: data.confidence,
    priceAreaAssuranceStatus: data.price_area_assurance_status,
    priceAreaAssuranceSource: data.price_area_assurance_source,
    priceAreaAssuranceConfidence: data.price_area_assurance_confidence,
    priceAreaAssuranceSourceVersion: data.price_area_assurance_source_version,
    priceAreaCandidateCount: data.price_area_candidate_count,
    priceAreaUniqueCount: data.price_area_unique_count,
    priceAreaEvidence: data.price_area_evidence,
    conflictCode: data.conflict_code,
    expiresAt: data.expires_at,
    now,
  })
  const capability = {
    pricing: readiness.capabilities.pricing_ready,
    quote: readiness.capabilities.quote_ready,
    facility_lookup: readiness.capabilities.facility_lookup_ready,
    switch_creation: readiness.capabilities.switch_request_creatable,
  }[input.purpose]
  if (!capability) throw purposeFailure(input.purpose, readiness.blockers)

  const area = priceArea(data.price_area)
  if (!area) throw purposeFailure(input.purpose, readiness.blockers)
  const expiresAt = text(data.expires_at)
  if (!expiresAt) throw purposeFailure(input.purpose, readiness.blockers)

  return {
    id: String(data.id),
    companyId: String(data.company_id),
    priceArea: area,
    gridAreaCode: text(data.grid_area_code),
    gridAreaName: text(data.grid_area_name),
    gridOwnerId: text(data.grid_owner_id),
    gridOwnerName: text(data.grid_owner_name),
    resolutionStatus: text(data.resolution_status) ?? 'failed',
    confidence: numberValue(data.confidence),
    automationAllowed: readiness.capabilities.switch_dispatch_ready,
    resolvedAt: text(data.resolved_at) ?? text(data.created_at) ?? now.toISOString(),
    expiresAt,
    resolverVersion: text(data.resolver_version) ?? 'energy-resolver-v2',
    geodataVersion: text(data.geodata_version),
    sourceChain: data.source_chain ?? [],
    conflictCode: text(data.conflict_code),
    ...readiness,
  }
}

export function loadPricingEnergyResolution(input: {
  client: IntegrationApiClient
  resolutionId: string
  now?: Date
}): Promise<BoundEnergyResolution> {
  return loadEnergyResolutionForPurpose({ ...input, purpose: 'pricing' })
}

export function loadQuoteEnergyResolution(input: {
  client: IntegrationApiClient
  resolutionId: string
  now?: Date
}): Promise<BoundEnergyResolution> {
  return loadEnergyResolutionForPurpose({ ...input, purpose: 'quote' })
}

export function loadFacilityLookupEnergyResolution(input: {
  client: IntegrationApiClient
  resolutionId: string
  now?: Date
}): Promise<BoundEnergyResolution> {
  return loadEnergyResolutionForPurpose({ ...input, purpose: 'facility_lookup' })
}

export function loadSwitchEnergyResolution(input: {
  client: IntegrationApiClient
  resolutionId: string
  now?: Date
}): Promise<BoundEnergyResolution> {
  return loadEnergyResolutionForPurpose({ ...input, purpose: 'switch_creation' })
}

/**
 * Backward-compatible alias for callers binding a website quote/application.
 * New pricing callers must use loadPricingEnergyResolution explicitly.
 */
export function loadBoundEnergyResolution(input: {
  client: IntegrationApiClient
  resolutionId: string
  now?: Date
}): Promise<BoundEnergyResolution> {
  return loadQuoteEnergyResolution(input)
}

export function resolutionSnapshot(resolution: BoundEnergyResolution): Record<string, unknown> {
  return {
    resolution_id: resolution.id,
    price_area: resolution.priceArea,
    grid_area_code: resolution.gridAreaCode,
    grid_area_name: resolution.gridAreaName,
    grid_owner_name: resolution.gridOwnerName,
    resolution_status: resolution.resolutionStatus,
    confidence: resolution.confidence,
    price_area_assurance: {
      status: resolution.priceAreaAssurance.status,
      price_area: resolution.priceAreaAssurance.priceArea,
      confidence: resolution.priceAreaAssurance.confidence,
      source: resolution.priceAreaAssurance.source,
      candidate_count: resolution.priceAreaAssurance.candidateCount,
      unique_price_area_count: resolution.priceAreaAssurance.uniquePriceAreaCount,
      source_version: resolution.priceAreaAssurance.sourceVersion,
      evidence: resolution.priceAreaAssurance.evidence,
    },
    resolved_at: resolution.resolvedAt,
    expires_at: resolution.expiresAt,
    resolver_version: resolution.resolverVersion,
    geodata_version: resolution.geodataVersion,
    source: {
      chain: resolution.sourceChain,
      conflict_code: resolution.conflictCode,
    },
    capabilities: resolution.capabilities,
    blockers: resolution.blockers,
  }
}
