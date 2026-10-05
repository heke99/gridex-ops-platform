import { supabaseService } from '@/lib/supabase/service'

export type ActiveCompanyOption = {
  id: string
  name: string | null
}

export function activeCompaniesQuery() {
  return supabaseService
    .from('companies')
    .select('id,name')
    .eq('status', 'active')
    .eq('lifecycle_status', 'active')
    .eq('is_active', true)
    .is('archived_at', null)
}

export async function listActiveCompanies(limit = 300): Promise<ActiveCompanyOption[]> {
  const { data, error } = await activeCompaniesQuery()
    .order('name', { ascending: true })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as ActiveCompanyOption[]
}

export async function getActiveCompany(companyId: string): Promise<ActiveCompanyOption | null> {
  const { data, error } = await activeCompaniesQuery()
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as ActiveCompanyOption | null
}
