import { supabaseService } from '@/lib/supabase/service'

function missingCustomerNumberSchema(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (['42883', '42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(maybe.code ?? '') ||
        /gridex_next_customer_number|does not exist|schema cache|function .* not found/i.test(maybe.message ?? ''))
  )
}

export async function reserveCustomerNumber(companyId: string): Promise<string> {
  const { data, error } = await supabaseService.rpc('gridex_next_customer_number', {
    p_company_id: companyId,
  })

  if (error) {
    if (missingCustomerNumberSchema(error)) {
      throw new Error('Kundnummer-funktionen saknas. Kör Batch 7A-migrationen innan website onboarding används.')
    }
    throw error
  }

  const customerNumber = typeof data === 'string' ? data.trim() : ''
  if (!customerNumber) throw new Error('Kundnummer kunde inte reserveras.')
  return customerNumber
}

export async function ensureCustomerNumber(input: {
  companyId: string
  customerId: string
  existingCustomerNumber?: string | null
}): Promise<string> {
  if (input.existingCustomerNumber?.trim()) return input.existingCustomerNumber.trim()

  const customerNumber = await reserveCustomerNumber(input.companyId)
  const { data, error } = await supabaseService
    .from('customers')
    .update({ customer_number: customerNumber, updated_at: new Date().toISOString() })
    .eq('company_id', input.companyId)
    .eq('id', input.customerId)
    .is('customer_number', null)
    .select('customer_number')
    .maybeSingle()

  if (error) throw error
  return String(data?.customer_number ?? customerNumber)
}
