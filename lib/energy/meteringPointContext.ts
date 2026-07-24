import { supabaseService } from '@/lib/supabase/service'
import type { EnergyResolverResult } from '@/lib/energy/types'

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function patchMeteringPointEnergyContext(input: {
  companyId: string
  meteringPointId: string
  resolution: EnergyResolverResult
}): Promise<{ updated: boolean; needsReview: boolean; conflicts: string[] }> {
  const { data: current, error: readError } = await supabaseService
    .from('metering_points')
    .select('id,grid_area_code,grid_owner_id,grid_owner_name,price_area,price_area_code,bidding_zone_code,energy_resolution_id,resolution_status,metadata')
    .eq('company_id', input.companyId)
    .eq('id', input.meteringPointId)
    .maybeSingle()
  if (readError) throw readError
  if (!current) throw new Error('metering_point_not_found_for_tenant')

  const canonicalArea = input.resolution.priceArea
  const conflicts: string[] = []
  const currentPriceArea = text(current.price_area) ?? text(current.price_area_code) ?? text(current.bidding_zone_code)
  if (text(current.grid_area_code) && input.resolution.gridAreaCode && text(current.grid_area_code) !== input.resolution.gridAreaCode) conflicts.push('grid_area_code')
  if (text(current.grid_owner_id) && input.resolution.gridOwnerId && text(current.grid_owner_id) !== input.resolution.gridOwnerId) conflicts.push('grid_owner_id')
  if (currentPriceArea && canonicalArea && currentPriceArea !== canonicalArea) conflicts.push('price_area')

  const now = new Date().toISOString()
  const needsReview = conflicts.length > 0
  const patch = needsReview
    ? {
        resolution_status: 'needs_review',
        resolution_source: 'ops_energy_resolver_conflict',
        energy_resolution_id: input.resolution.resolutionId ?? null,
        resolution_confidence: input.resolution.confidence,
        resolved_at: input.resolution.resolvedAt ?? now,
        geodata_version: input.resolution.geodataVersion ?? null,
        metadata: {
          ...((current.metadata && typeof current.metadata === 'object' && !Array.isArray(current.metadata)) ? current.metadata as Record<string, unknown> : {}),
          energy_context_conflicts: conflicts,
          conflicting_resolution_id: input.resolution.resolutionId ?? null,
        },
        updated_at: now,
      }
    : {
        grid_area_code: input.resolution.gridAreaCode,
        grid_owner_id: input.resolution.gridOwnerId,
        grid_owner_name: input.resolution.gridOwnerName,
        price_area: canonicalArea,
        price_area_code: canonicalArea,
        bidding_zone_code: canonicalArea,
        energy_resolution_id: input.resolution.resolutionId ?? null,
        resolution_source: input.resolution.sourceChain.join(' -> '),
        resolution_confidence: input.resolution.confidence,
        resolution_status: input.resolution.resolutionStatus,
        resolved_at: input.resolution.resolvedAt ?? now,
        geodata_version: input.resolution.geodataVersion ?? null,
        updated_at: now,
      }

  const { error: updateError } = await supabaseService
    .from('metering_points')
    .update(patch)
    .eq('company_id', input.companyId)
    .eq('id', input.meteringPointId)
  if (updateError) throw updateError

  return { updated: true, needsReview, conflicts }
}
