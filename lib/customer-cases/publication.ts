import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
import { SupportCommandError, type SupportActor } from '@/lib/customer-operations/supportCommand'
import { supportActorContext } from './customerRead'

export type CurrentCasePublication = {
  id: string
  customer_case_id: string
  customer_id: string
  revision: number
  public_title: string
  public_body: string
  public_status: 'open' | 'waiting_for_customer' | 'resolved' | 'closed'
  channel: 'ops' | 'phone'
  author_user_id: string
  published_at: string
}

export async function listCurrentCasePublications(companyId: string, caseIds: string[]) {
  if (caseIds.length === 0) return [] as CurrentCasePublication[]
  const { data, error } = await (tenantDb(companyId)
    .from('customer_case_publications')
    .select('id,customer_case_id,customer_id,revision,public_title,public_body,public_status,channel,author_user_id,published_at') as ReturnType<ReturnType<typeof supabaseService.from>['select']>)
    .in('customer_case_id', caseIds)
    .is('revoked_at', null)
    .limit(caseIds.length)
  if (error) throw error
  return (data ?? []) as CurrentCasePublication[]
}

export async function listCasePublicationHeads(companyId: string, caseIds: string[]): Promise<Map<string, number>> {
  if (caseIds.length === 0) return new Map()
  const { data, error } = await supabaseService.rpc('gridex_case_publication_heads_v1', {
    p_company_id: companyId,
    p_case_ids: caseIds,
  })
  if (error) throw error
  return new Map((data ?? []).map((row: { customer_case_id: string; revision: number }) => [row.customer_case_id, row.revision]))
}

type PublicationContext = {
  companyId: string; customerId: string; caseId: string; actorUserId: string;
  actor: Extract<SupportActor, { kind: 'ops' | 'portal' }>; expectedRevision: number
}

function checkedContext(input: PublicationContext) {
  if (!input.actor || input.actor.kind !== 'ops' || input.actor.userId !== input.actorUserId) {
    throw new SupportCommandError('support_actor_forbidden', 403)
  }
  return supportActorContext(input)
}
function publicationError(error: { code?: string; message?: string }) {
  if (error.message === 'support_actor_forbidden') throw new SupportCommandError(error.message, 403)
  if (['42883', '42P01', 'PGRST202'].includes(error.code ?? '')) throw new SupportCommandError('support_schema_unavailable', 503)
  throw error
}
export async function publishCustomerCase(input: PublicationContext & {
  title: string; body: string; status: CurrentCasePublication['public_status']; channel?: 'ops' | 'phone'
}) {
  const channel = input.channel ?? 'ops'
  const { data, error } = await supabaseService.rpc('gridex_support_case_publication_v1', {
    p_context: checkedContext(input), p_publication: { operation: 'publish', caseId: input.caseId,
      title: input.title, body: input.body, status: input.status, expectedRevision: input.expectedRevision, channel },
  })
  if (error) publicationError(error)
  const result = data as CurrentCasePublication | null
  if (!result || result.customer_case_id !== input.caseId || result.customer_id !== input.customerId ||
      result.author_user_id !== input.actorUserId || result.channel !== channel || result.revision !== input.expectedRevision + 1) {
    throw new SupportCommandError('support_result_invalid', 503)
  }
  return result
}

export async function revokeCustomerCasePublication(input: PublicationContext) {
  const { data, error } = await supabaseService.rpc('gridex_support_case_publication_v1', {
    p_context: checkedContext(input), p_publication: { operation: 'revoke', caseId: input.caseId, expectedRevision: input.expectedRevision },
  })
  if (error) publicationError(error)
  if (data !== true) throw new SupportCommandError('support_result_invalid', 503)
  return true
}
