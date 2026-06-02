import { createHash } from 'crypto'
import { supabaseService } from '@/lib/supabase/service'

export type BusinessActionIdempotencyResult =
  | { acquired: true; key: string }
  | { acquired: false; key: string; reason: 'duplicate' }

function stablePart(value: string | null | undefined): string {
  return String(value ?? '').trim() || 'none'
}

export function buildBusinessActionIdempotencyKey(parts: {
  companyId: string
  action: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  switchRequestId?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  explicitKey?: string | null
}): string {
  if (parts.explicitKey?.trim()) {
    return `business-action:${parts.companyId}:${parts.explicitKey.trim()}`
  }

  const raw = [
    parts.companyId,
    parts.action,
    parts.customerId,
    stablePart(parts.siteId),
    stablePart(parts.meteringPointId),
    stablePart(parts.switchRequestId),
    stablePart(parts.periodStart),
    stablePart(parts.periodEnd),
  ].join('|')

  return `business-action:${parts.action}:${createHash('sha256').update(raw).digest('hex')}`
}

export async function acquireBusinessActionIdempotencyKey(params: {
  companyId: string
  key: string
  action: string
  actorUserId: string
  metadata?: Record<string, unknown>
}): Promise<BusinessActionIdempotencyResult> {
  const { error } = await supabaseService
    .from('ediel_dedupe_keys')
    .insert({
      company_id: params.companyId,
      dedupe_key: params.key,
      status: 'active',
      metadata: {
        scope: 'business_action',
        action: params.action,
        actorUserId: params.actorUserId,
        ...(params.metadata ?? {}),
      },
    })

  if (!error) return { acquired: true, key: params.key }
  if (error.code === '23505') return { acquired: false, key: params.key, reason: 'duplicate' }
  throw error
}
