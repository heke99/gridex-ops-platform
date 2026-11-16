import {createSupabaseServerClient} from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { listActiveCompanies } from '@/lib/tenant/activeCompanies'

export type TestCenterCompanyOption = { id: string; name?: string | null }
export type TestCenterCustomerOption = {
  id: string
  company_id?: string | null
  customer_number?: string | null
}
export type TestCenterMessageOption = {
  id: string
  company_id?: string | null
  customer_id?: string | null
  message_code?: string | null
  status?: string | null
  created_at?: string | null
}

export type TestCenterRuntimeOptions = {
  companies: TestCenterCompanyOption[]
  customers: TestCenterCustomerOption[]
  messages: TestCenterMessageOption[]
  error: string | null
}

export async function loadTestCenterRuntimeOptions(): Promise<TestCenterRuntimeOptions> {
  const [companiesResult, customersResult, messagesResult] = await Promise.all([
    listActiveCompanies(100)
      .then((data) => ({ data, error: null as Error | null }))
      .catch((error: Error) => ({ data: [] as TestCenterCompanyOption[], error })),
    supabaseService
      .from('customers')
      .select('id,company_id,customer_number')
      .order('created_at', { ascending: false })
      .limit(300),
    supabaseService
      .from('ediel_messages')
      .select('id,company_id,customer_id,message_code,status,created_at')
      .eq('environment', 'test')
      .eq('direction', 'inbound')
      .eq('message_family', 'UTILTS')
      .not('customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300),
  ])

  const errors = [companiesResult.error, customersResult.error, messagesResult.error]
    .filter(Boolean)
    .map((error) => error?.message ?? 'Okänt databasfel')

  const activeCompanyIds = new Set(companiesResult.data.map((company) => company.id))

  return {
    companies: companiesResult.data as TestCenterCompanyOption[],
    customers: ((customersResult.data ?? []) as TestCenterCustomerOption[]).filter((customer) =>
      customer.company_id ? activeCompanyIds.has(customer.company_id) : false,
    ),
    messages: ((messagesResult.data ?? []) as TestCenterMessageOption[]).filter((message) =>
      message.company_id ? activeCompanyIds.has(message.company_id) : false,
    ),
    error: errors.length > 0 ? errors.join(' | ') : null,
  }
}

/** Declarations are visible for onboarding tenants too. This scoped read grants
 * no admission: authenticated native issue revalidates every permission. */
export async function loadLocalSimulationCompanyOptions(): Promise<TestCenterCompanyOption[]> {
  const client = await createSupabaseServerClient()
  const {data:auth,error:authError}=await client.auth.getUser()
  if(authError || !auth.user) throw new Error('local_simulation_authenticated_actor_required')
  const {data,error}=await client.from('companies').select('id,name,status,lifecycle_status,is_active')
    .in('lifecycle_status',['onboarding','active']).limit(100)
  if(error) throw error
  return (data ?? []).filter(row=>row.status !== 'suspended' && row.status !== 'archived').map(row=>({id:row.id,name:row.name}))
}
