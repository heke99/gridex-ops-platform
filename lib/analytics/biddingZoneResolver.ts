import { supabaseService } from '@/lib/supabase/service'

export type BiddingZoneResolverInput = {
  companyId: string
  meteringPointId?: string | null
  siteId?: string | null
  postalCode?: string | null
  gridOwnerId?: string | null
  existingBiddingZoneCode?: string | null
  manualOverride?: string | null
}

export type BiddingZoneResolution = {
  biddingZoneCode: string | null
  confidenceScore: number
  source: 'metering_point' | 'site' | 'grid_owner_postal_code' | 'postal_code' | 'manual' | 'unknown'
  issues: string[]
}

function cleanZone(value?: string | null): string | null {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^SE[1-4]$/.test(normalized) ? normalized : null
}

function cleanPostalCode(value?: string | null): string | null {
  return value?.replace(/\s+/g, '').trim() || null
}

async function createMissingIssue(companyId: string, meteringPointId?: string | null): Promise<void> {
  const { error } = await supabaseService
    .from('data_quality_issues')
    .upsert({
      company_id: companyId,
      entity_type: 'metering_point',
      entity_id: meteringPointId ?? null,
      issue_type: 'missing_bidding_zone',
      severity: 'warning',
      message: 'Mätpunkt saknar SE-område och kunde inte lösas med tillräcklig säkerhet.',
      status: 'open',
      resolved_at: null,
    }, { onConflict: 'company_id,entity_type,entity_id,issue_type,status' })

  if (error && !/does not exist|schema cache|Could not find/i.test(error.message)) throw error
}

export async function resolveBiddingZone(input: BiddingZoneResolverInput): Promise<BiddingZoneResolution> {
  const manual = cleanZone(input.manualOverride)
  if (manual) return { biddingZoneCode: manual, confidenceScore: 1, source: 'manual', issues: [] }

  const existing = cleanZone(input.existingBiddingZoneCode)
  if (existing) return { biddingZoneCode: existing, confidenceScore: 0.98, source: 'manual', issues: [] }

  if (input.meteringPointId) {
    const { data } = await supabaseService
      .from('metering_points')
      .select('bidding_zone_code, price_area_code')
      .eq('company_id', input.companyId)
      .eq('id', input.meteringPointId)
      .maybeSingle()
    const meteringPointZone = cleanZone(data?.bidding_zone_code ?? data?.price_area_code)
    if (meteringPointZone) return { biddingZoneCode: meteringPointZone, confidenceScore: 0.95, source: 'metering_point', issues: [] }
  }

  if (input.siteId) {
    const { data } = await supabaseService
      .from('customer_sites')
      .select('bidding_zone_code, price_area_code, postal_code, grid_owner_id')
      .eq('company_id', input.companyId)
      .eq('id', input.siteId)
      .maybeSingle()
    const siteZone = cleanZone(data?.bidding_zone_code ?? data?.price_area_code)
    if (siteZone) return { biddingZoneCode: siteZone, confidenceScore: 0.9, source: 'site', issues: [] }
    input = {
      ...input,
      postalCode: input.postalCode ?? data?.postal_code ?? null,
      gridOwnerId: input.gridOwnerId ?? data?.grid_owner_id ?? null,
    }
  }

  const postalCode = cleanPostalCode(input.postalCode)
  if (postalCode && input.gridOwnerId) {
    const { data } = await supabaseService
      .from('grid_area_mappings')
      .select('bidding_zone_code, confidence_score')
      .or(`company_id.is.null,company_id.eq.${input.companyId}`)
      .eq('grid_owner_id', input.gridOwnerId)
      .eq('postal_code', postalCode)
      .order('confidence_score', { ascending: false })
      .limit(1)
    const row = data?.[0]
    const mappedZone = cleanZone(row?.bidding_zone_code)
    if (mappedZone && Number(row?.confidence_score ?? 0) >= 0.7) {
      return { biddingZoneCode: mappedZone, confidenceScore: Number(row?.confidence_score ?? 0.7), source: 'grid_owner_postal_code', issues: [] }
    }
  }

  if (postalCode) {
    const { data } = await supabaseService
      .from('grid_area_mappings')
      .select('bidding_zone_code, confidence_score')
      .or(`company_id.is.null,company_id.eq.${input.companyId}`)
      .eq('postal_code', postalCode)
      .order('confidence_score', { ascending: false })
      .limit(1)
    const row = data?.[0]
    const mappedZone = cleanZone(row?.bidding_zone_code)
    if (mappedZone && Number(row?.confidence_score ?? 0) >= 0.8) {
      return { biddingZoneCode: mappedZone, confidenceScore: Number(row?.confidence_score ?? 0.8), source: 'postal_code', issues: [] }
    }
  }

  await createMissingIssue(input.companyId, input.meteringPointId)
  return {
    biddingZoneCode: null,
    confidenceScore: 0,
    source: 'unknown',
    issues: ['missing_bidding_zone'],
  }
}
