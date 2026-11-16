import 'server-only'
import { isCompanyVisibleInTenantWorkspace } from '@/lib/tenant/lifecycle'
import { getVerifiedAuthUser } from '@/lib/auth/currentUser'
import { readAuthenticatedTenantContext } from '@/lib/auth/authenticatedTenantContext'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type CompanySelectionAccess = {
  userId: string
  selectedCompanyId: string
  companies: Array<{ companyId: string; companyName: string }>
}

/** Request JWT only. A visible option never grants business or platform access. */
export async function readCompanySelectionAccess(selectedCompanyId: string): Promise<CompanySelectionAccess> {
  const user = await getVerifiedAuthUser()
  if (!user || !selectedCompanyId) throw new Error('Company selection unavailable')
  const client = await createSupabaseServerClient()
  const context = await readAuthenticatedTenantContext(client, user.id, selectedCompanyId)
  if (context.is_platform_admin || !context.access_invariant_ok) throw new Error('Company selection unavailable')
  const { data, error } = await client.from('company_memberships')
    .select('company_id,status,is_active,accepted_at')
    .eq('user_id', user.id).eq('status', 'active').eq('is_active', true)
    .not('accepted_at', 'is', null)
  if (error) throw error
  const accepted = new Set((data ?? []).filter(row => row.status === 'active' && row.is_active === true && row.accepted_at)
    .map(row => row.company_id))
  const companies: CompanySelectionAccess['companies'] = []
  for (const row of context.memberships) {
    const member = row as typeof row & { company_name?: unknown }
    if (typeof member.company_id !== 'string' || !accepted.has(member.company_id) ||
      !isCompanyVisibleInTenantWorkspace(typeof member.status === 'string' ? member.status : null)) continue
    if (companies.some(company => company.companyId === member.company_id)) continue
    companies.push({ companyId: member.company_id, companyName: typeof member.company_name === 'string' ? member.company_name : member.company_id })
  }
  if (!companies.some(company => company.companyId === selectedCompanyId)) throw new Error('Company selection unavailable')
  return { userId: user.id, selectedCompanyId, companies }
}
