import { supabaseService } from '@/lib/supabase/service'

export async function getCustomers() {
  const { data, error } = await supabaseService
    .from('customers')
    .select('id, customer_type, status, first_name, last_name, full_name, company_name, email, phone, created_at')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}