import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'

export type PermissionMarketTransitionResult = {
  applied: boolean
  permissionId: string | null
  status: string | null
  reason: string | null
  idempotent: boolean
}

/** All consumers, including operator-selected messages, use the same durable
 * source executor. No caller-provided status, date, actor or object is evidence. */
export async function applyPermissionMarketSource(params: {
  actorUserId: string
  message: Pick<EdielMessageRow, 'id' | 'company_id' | 'direction' | 'message_family' | 'message_code'>
  expectedPermissionId?: string | null
}): Promise<PermissionMarketTransitionResult> {
  if (!params.message.company_id || params.message.direction !== 'inbound'
    || params.message.message_family !== 'PRODAT'
    || !['Z14', 'Z15'].includes(String(params.message.message_code ?? '').toUpperCase().slice(0, 3))) {
    return { applied: false, permissionId: null, status: null, reason: 'not_inbound_permission_source', idempotent: false }
  }
  const { data, error } = await supabaseService.rpc('ediel_apply_permission_source_v1', {
    p_company_id: params.message.company_id,
    p_source_message_id: params.message.id,
    p_actor_user_id: params.actorUserId,
    p_expected_permission_id: params.expectedPermissionId ?? null,
  })
  if (error) throw error
  const result = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  return { applied: result.applied === true, permissionId: typeof result.permissionId === 'string' ? result.permissionId : null,
    status: typeof result.status === 'string' ? result.status : null, reason: typeof result.reason === 'string' ? result.reason : null,
    idempotent: result.idempotent === true }
}

/** Advance only an already source-approved end timestamp. Never fabricates a
 * market response or originates a request. Durable locks serialize with C. */
export async function advancePermissionMarketDeadlines(params: { actorUserId: string; companyId?: string | null; limit?: number }): Promise<{ updated: number }> {
  const { data, error } = await supabaseService.rpc('ediel_advance_permission_deadlines_v1', {
    p_actor_user_id: params.actorUserId, p_company_id: params.companyId ?? null,
    p_limit: Math.min(Math.max(Math.floor(params.limit ?? 100), 1), 200),
  })
  if (error) throw error
  return { updated: typeof data?.updated === 'number' ? data.updated : 0 }
}
