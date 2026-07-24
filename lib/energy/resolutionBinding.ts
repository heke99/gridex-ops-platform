import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import type { PriceArea } from '@/lib/energy/types'

export type BoundEnergyResolution = {
  id: string
  companyId: string
  priceArea: PriceArea
  gridAreaCode: string
  gridAreaName: string | null
  gridOwnerId: string
  gridOwnerName: string | null
  resolutionStatus: string
  confidence: number
  automationAllowed: boolean
  resolvedAt: string
  expiresAt: string
  resolverVersion: string
  geodataVersion: string | null
  sourceChain: unknown
}

export class EnergyResolutionBindingError extends Error {
  readonly code:
    | 'resolution_not_found'
    | 'resolution_tenant_mismatch'
    | 'resolution_expired'
    | 'resolution_not_automation_ready'
    | 'energy_area_needs_review'
  readonly status: number
  readonly field = 'resolution_id'

  constructor(input: { message: string; code: EnergyResolutionBindingError['code']; status?: number }) {
    super(input.message)
    this.name = 'EnergyResolutionBindingError'
    this.code = input.code
    this.status = input.status ?? 422
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function priceArea(value: unknown): PriceArea | null {
  const normalized = text(value)?.toUpperCase()
  return normalized === 'SE1' || normalized === 'SE2' || normalized === 'SE3' || normalized === 'SE4'
    ? normalized
    : null
}

export async function loadBoundEnergyResolution(input: {
  client: IntegrationApiClient
  resolutionId: string
  now?: Date
}): Promise<BoundEnergyResolution> {
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
    .select('id,company_id,price_area,grid_area_code,grid_area_name,grid_owner_id,grid_owner_name,resolution_status,confidence,automation_allowed,resolved_at,expires_at,resolver_version,geodata_version,source_chain,created_at')
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
      message: 'Elområdesresolutionen tillhör inte denna tenant.',
      code: 'resolution_tenant_mismatch',
      status: 403,
    })
  }

  const now = (input.now ?? new Date()).getTime()
  const expiresAt = text(data.expires_at)
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now) {
    throw new EnergyResolutionBindingError({
      message: 'Elområdesresolutionen har gått ut. Lös området på nytt.',
      code: 'resolution_expired',
      status: 409,
    })
  }

  const status = text(data.resolution_status) ?? 'failed'
  if (status === 'needs_review' || status === 'failed') {
    throw new EnergyResolutionBindingError({
      message: 'Elområdet kräver manuell granskning innan en quote kan skapas.',
      code: 'energy_area_needs_review',
      status: 409,
    })
  }
  const area = priceArea(data.price_area)
  const gridAreaCode = text(data.grid_area_code)
  const gridOwnerId = text(data.grid_owner_id)
  if (data.automation_allowed !== true || !area || !gridAreaCode || !gridOwnerId) {
    throw new EnergyResolutionBindingError({
      message: 'Elområdesresolutionen är inte redo för automatisk quote.',
      code: 'resolution_not_automation_ready',
      status: 409,
    })
  }

  return {
    id: String(data.id),
    companyId: String(data.company_id),
    priceArea: area,
    gridAreaCode,
    gridAreaName: text(data.grid_area_name),
    gridOwnerId,
    gridOwnerName: text(data.grid_owner_name),
    resolutionStatus: status,
    confidence: Number(data.confidence ?? 0),
    automationAllowed: true,
    resolvedAt: text(data.resolved_at) ?? text(data.created_at) ?? new Date(now).toISOString(),
    expiresAt,
    resolverVersion: text(data.resolver_version) ?? 'energy-resolver-v2',
    geodataVersion: text(data.geodata_version),
    sourceChain: data.source_chain ?? [],
  }
}

export function resolutionSnapshot(resolution: BoundEnergyResolution): Record<string, unknown> {
  return {
    resolution_id: resolution.id,
    price_area: resolution.priceArea,
    grid_area_code: resolution.gridAreaCode,
    grid_area_name: resolution.gridAreaName,
    grid_owner_id: resolution.gridOwnerId,
    grid_owner_name: resolution.gridOwnerName,
    resolution_status: resolution.resolutionStatus,
    confidence: resolution.confidence,
    automation_allowed: resolution.automationAllowed,
    resolved_at: resolution.resolvedAt,
    expires_at: resolution.expiresAt,
    resolver_version: resolution.resolverVersion,
    geodata_version: resolution.geodataVersion,
    source_chain: resolution.sourceChain,
  }
}
