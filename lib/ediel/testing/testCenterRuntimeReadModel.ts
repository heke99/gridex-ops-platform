import { supabaseService } from '@/lib/supabase/service'

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
    supabaseService.from('companies').select('id,name').order('name', { ascending: true }).limit(100),
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

  return {
    companies: (companiesResult.data ?? []) as TestCenterCompanyOption[],
    customers: (customersResult.data ?? []) as TestCenterCustomerOption[],
    messages: (messagesResult.data ?? []) as TestCenterMessageOption[],
    error: errors.length > 0 ? errors.join(' | ') : null,
  }
}
