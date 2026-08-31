import { supabaseService } from '@/lib/supabase/service'
import { INVOICE_TEST_CUSTOMER_SOURCE } from '@/lib/ediel/testing/invoiceTestCenterWorkspace'

type QuarantineInput = {
  companyId: string
  customerId: string
  siteId: string | null
  meteringPointId: string | null
  actorUserId: string
}

export async function quarantineCreatedInvoiceTestGraph(input: QuarantineInput) {
  const now = new Date().toISOString()
  const reason = 'Fakturatest-markering misslyckades; nyss skapad kundgraf arkiverades fail-closed.'

  if (input.meteringPointId) {
    const meteringPoint = await supabaseService
      .from('metering_points')
      .update({
        is_test_data: true,
        archived_at: now,
        archived_by: input.actorUserId,
        archive_reason: reason,
        updated_by: input.actorUserId,
        updated_at: now,
      })
      .eq('company_id', input.companyId)
      .eq('id', input.meteringPointId)
    if (meteringPoint.error) throw meteringPoint.error
  }

  if (input.siteId) {
    const site = await supabaseService
      .from('customer_sites')
      .update({
        is_test_data: true,
        is_active: false,
        archived_at: now,
        archived_by: input.actorUserId,
        archive_reason: reason,
        updated_by: input.actorUserId,
        updated_at: now,
      })
      .eq('company_id', input.companyId)
      .eq('id', input.siteId)
    if (site.error) throw site.error
  }

  const customer = await supabaseService
    .from('customers')
    .update({
      source: INVOICE_TEST_CUSTOMER_SOURCE,
      is_test_data: true,
      archived_at: now,
      archived_by: input.actorUserId,
      archive_reason: reason,
      updated_by: input.actorUserId,
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('id', input.customerId)
    .select('id')
    .maybeSingle()
  if (customer.error) throw customer.error
  if (!customer.data) {
    throw new Error('Fakturatest-karantän kunde inte verifiera den nyss skapade kunden.')
  }

  return { quarantinedAt: now, customerId: input.customerId }
}
