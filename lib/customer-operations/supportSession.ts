import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { SupportCommandError, type SupportActor } from './supportCommand'

/** Identity comes from verified auth results; session revocation is rechecked
 * under a DB lock by the support command/read RPC. Never accept actor form fields. */
export async function currentSupportSession(kind: 'ops' | 'portal', expectedUserId?: string): Promise<Extract<SupportActor, { kind: 'ops' | 'portal' }>> {
  const client = await createSupabaseServerClient()
  const claims = await client.auth.getClaims()
  const user = await client.auth.getUser()
  const userId = user.data.user?.id
  const sessionId = claims.data?.claims.session_id
  if (user.error || claims.error || !userId || claims.data?.claims.sub !== userId ||
      typeof sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId) ||
      (expectedUserId && userId !== expectedUserId)) {
    throw new SupportCommandError('support_session_revoked', 403)
  }
  return { kind, userId, sessionId }
}

/** Auth validates the user and token, while the database additionally enforces
 * the live session clock and current tenant read permission for OPS lists. */
export async function requireCurrentOpsSupportReadSession(companyId: string, expectedUserId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) {
    throw new SupportCommandError('support_actor_forbidden', 403)
  }
  const actor = await currentSupportSession('ops', expectedUserId)
  const { data, error } = await supabaseService.rpc('gridex_support_ops_read_access_v1', {
    p_company_id: companyId, p_user_id: actor.userId, p_session_id: actor.sessionId,
  })
  if (error) {
    if (['42883', '42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code)) {
      throw new SupportCommandError('support_schema_unavailable', 503)
    }
    if (error.code === '42501') throw new SupportCommandError('support_actor_forbidden', 403)
    throw new SupportCommandError('support_unavailable', 503)
  }
  if (data !== true) throw new SupportCommandError('support_actor_forbidden', 403)
  return { ...actor, kind: 'ops' as const }
}
