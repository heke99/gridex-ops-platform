import 'server-only'
import { getPortalSelectedSite } from '@/lib/customer-portal/db'
import { isPortalResponseRequest, requestedPortalFields } from '@/lib/customer-portal/targetedRequestFields'
import type { CustomerPortalContext } from '@/lib/customer-portal/types'
import { customerMayReadPortalRecords } from '@/lib/customer-portal/caseProjection'
import { supabaseService } from '@/lib/supabase/service'
import { isUuid } from '@/lib/validation/uuid'

export async function loadPortalTargetedRequest(context: CustomerPortalContext, id: string) {
  if (!context.companyId || !context.requestResponseCustomerIds?.length || !isUuid(id)) return null

  const requestId = id.trim().toLowerCase()
  const { data, error } = await supabaseService.from('customer_info_requests')
    .select('id,customer_id,site_id,request_type,target_party_type,status,automation_origin,requested_data_categories')
    .eq('company_id', context.companyId)
    .eq('id', requestId)
    .in('customer_id', context.requestResponseCustomerIds)
    .maybeSingle()
  if (error) throw error
  if (!data || data.id !== requestId || !context.requestResponseCustomerIds.includes(data.customer_id) || !isPortalResponseRequest(data)) return null

  if (!await customerMayReadPortalRecords(context.companyId, data.customer_id)) return null

  const site = data.site_id ? await getPortalSelectedSite(context, data.site_id) : null
  if (data.site_id && (!site || site.customer_id !== data.customer_id)) return null

  const customer = context.customers.find(entry => entry.id === data.customer_id)
  return {
    id: data.id,
    siteId: data.site_id,
    siteLabel: site ? [site.street, site.postal_code, site.city].filter(Boolean).join(', ') || site.site_name : null,
    customerLabel: customer?.customer_number ? 'Kundnummer ' + customer.customer_number : 'Ditt länkade kundkonto',
    fields: requestedPortalFields(data.requested_data_categories),
  }
}
