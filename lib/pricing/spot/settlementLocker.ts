import { supabaseService } from '@/lib/supabase/service'
import type { PriceArea } from '@/lib/pricing/types'

export type LockedSpotSettlement = {
  id: string
  source: string
  price_area: PriceArea
  billing_month: string
  status: 'locked'
  average_sek_per_kwh: number
  verified_at: string
  locked_at: string
  source_checksum: string | null
}

/**
 * Final settlement locking is deliberately separate from import and preview.
 * The database RPC verifies complete coverage and is the only supported path
 * from verified evidence to immutable locked billing evidence.
 */
export async function lockSpotSettlementMonth(input: {
  provider?: string
  priceArea: PriceArea
  billingMonth: string
  actorUserId?: string | null
  reason?: string | null
}): Promise<LockedSpotSettlement> {
  if (!/^\d{4}-\d{2}$/.test(input.billingMonth)) {
    throw new Error('billing_month måste anges som YYYY-MM.')
  }
  const { data, error } = await supabaseService.rpc('gridex_lock_spot_price_month', {
    p_provider: input.provider ?? 'elprisetjustnu',
    p_price_area: input.priceArea,
    p_billing_month: input.billingMonth,
    p_actor_user_id: input.actorUserId ?? null,
    p_reason: input.reason ?? null,
  })
  if (error) throw error
  const row = data as Record<string, unknown> | null
  if (!row || row.status !== 'locked') throw new Error('Spotprisperioden kunde inte låsas.')
  return {
    id: String(row.id),
    source: String(row.source),
    price_area: String(row.price_area) as PriceArea,
    billing_month: String(row.billing_month),
    status: 'locked',
    average_sek_per_kwh: Number(row.average_sek_per_kwh),
    verified_at: String(row.verified_at),
    locked_at: String(row.locked_at),
    source_checksum: typeof row.source_checksum === 'string' ? row.source_checksum : null,
  }
}
