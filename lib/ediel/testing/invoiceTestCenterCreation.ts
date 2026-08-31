import { supabaseService } from '@/lib/supabase/service'
import { INVOICE_TEST_CUSTOMER_SOURCE } from '@/lib/ediel/testing/invoiceTestCenterWorkspace'

export async function getInvoiceTestOnboardingGeneration(companyId: string): Promise<number> {
  const result = await supabaseService
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('source', INVOICE_TEST_CUSTOMER_SOURCE)
    .eq('is_test_data', true)
    .not('archived_at', 'is', null)
  if (result.error) throw result.error
  return result.count ?? 0
}

export async function resolveSingleInvoiceTestContractId(input: {
  companyId: string
  customerId: string
}): Promise<string> {
  const result = await supabaseService
    .from('customer_contracts')
    .select('id,status')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .order('created_at', { ascending: false })
    .limit(2)
  if (result.error) throw result.error
  const rows = result.data ?? []
  if (rows.length !== 1 || !rows[0]?.id) {
    throw new Error('Fakturatest blockerad: den nya testkunden måste ha exakt ett canonical avtal.')
  }
  if (!['draft', 'pending_signature', 'signed', 'active'].includes(String(rows[0].status))) {
    throw new Error('Fakturatest blockerad: testkundens canonical avtal har en ogiltig skapandestatus.')
  }
  return String(rows[0].id)
}
