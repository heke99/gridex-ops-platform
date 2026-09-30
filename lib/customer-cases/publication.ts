import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'

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

export async function publishCustomerCase(input: {
  companyId: string
  caseId: string
  actorUserId: string
  title: string
  body: string
  status: CurrentCasePublication['public_status']
  expectedRevision: number
}) {
  const { data, error } = await supabaseService.rpc('gridex_publish_customer_case_v1', {
    p_company_id: input.companyId,
    p_case_id: input.caseId,
    p_actor_user_id: input.actorUserId,
    p_title: input.title,
    p_body: input.body,
    p_status: input.status,
    p_expected_revision: input.expectedRevision,
    p_channel: 'ops',
  })
  if (error) throw error
  return data as CurrentCasePublication
}

export async function revokeCustomerCasePublication(input: {
  companyId: string
  caseId: string
  actorUserId: string
  expectedRevision: number
}) {
  const { data, error } = await supabaseService.rpc('gridex_revoke_customer_case_publication_v1', {
    p_company_id: input.companyId,
    p_case_id: input.caseId,
    p_actor_user_id: input.actorUserId,
    p_expected_revision: input.expectedRevision,
  })
  if (error) throw error
  return data === true
}
