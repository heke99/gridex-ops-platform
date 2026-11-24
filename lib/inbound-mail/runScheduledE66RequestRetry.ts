import { supabaseService } from '@/lib/supabase/service'

type Scope = {
  environment: 'test' | 'production'
  actorUserId: string
  companyId: string | null
  mailboxIds: readonly string[]
}

type Status = 'idle' | 'deferred' | 'request_received' | 'request_partial' | 'replaced' | 'cancelled' | 'held'
type Reply = PromiseLike<{ data: unknown; error: { code: string } | null }>
type SchedulerRpc = {
  (name: 'gridex_find_scheduled_e66_request_retry_v1', args: {
    p_environment: Scope['environment']; p_mailboxes: string[]; p_company: string | null; p_actor: string
  }): Reply
  (name: 'gridex_drain_e66_request_retry_v1', args: {
    p_environment: Scope['environment']; p_company: string; p_mailbox: string; p_actor: string
  }): Reply
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('e66_scheduled_request_receipt_invalid')
  }
  return value as Record<string, unknown>
}

export async function runScheduledE66RequestRetry(input: Scope): Promise<Status> {
  if (!input.mailboxIds.length) return 'idle'
  const mailboxIds = [...new Set(input.mailboxIds)]
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as SchedulerRpc
  const scope = await rpc('gridex_find_scheduled_e66_request_retry_v1', {
    p_environment: input.environment,
    p_mailboxes: mailboxIds,
    p_company: input.companyId,
    p_actor: input.actorUserId,
  })
  if (scope.error) throw new Error('e66_scheduled_request_scope_unavailable')
  if (scope.data === null) return 'idle'

  const { companyId, mailboxId } = asRecord(scope.data)
  if (typeof companyId !== 'string' || !UUID.test(companyId) ||
      (input.companyId !== null && companyId !== input.companyId) ||
      typeof mailboxId !== 'string' || !mailboxIds.includes(mailboxId)) {
    throw new Error('e66_scheduled_request_scope_invalid')
  }

  const claimed = await rpc('gridex_drain_e66_request_retry_v1', {
    p_environment: input.environment,
    p_company: companyId,
    p_mailbox: mailboxId,
    p_actor: input.actorUserId,
  })
  if (claimed.error) throw new Error('e66_scheduled_request_drain_unavailable')
  if (claimed.data === null) return 'idle'
  const { sourceId, status } = asRecord(claimed.data)
  if (typeof sourceId !== 'string' || !UUID.test(sourceId)) {
    throw new Error('e66_scheduled_request_receipt_invalid')
  }
  if (status === 'received') return 'request_received'
  if (status === 'partial') return 'request_partial'
  if (status === 'deferred' || status === 'replaced' || status === 'cancelled' || status === 'held') return status
  throw new Error('e66_scheduled_request_receipt_invalid')
}
