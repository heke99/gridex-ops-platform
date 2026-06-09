import type { NextRequest } from 'next/server'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'

type PortalCustomerContext = {
  companyId: string
  customerId: string
  externalCustomerId: string
  provider: string
}

function isMissingSchemaError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(maybe && ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(maybe.code ?? '') || /does not exist|schema cache|column .* does not exist/i.test(maybe?.message ?? ''))
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function externalCustomerIdFromRequest(request: NextRequest): string | null {
  const url = request.nextUrl
  return (
    clean(url.searchParams.get('external_customer_id')) ??
    clean(url.searchParams.get('externalCustomerId')) ??
    clean(request.headers.get('x-external-customer-id')) ??
    clean(request.headers.get('x-gridex-external-customer-id'))
  )
}

export async function resolvePortalCustomerContext(input: {
  client: IntegrationApiClient
  externalCustomerId: string | null
}): Promise<PortalCustomerContext> {
  const externalCustomerId = clean(input.externalCustomerId)
  if (!externalCustomerId) throw new Error('external_customer_id krävs för Mina sidor-API.')

  const link = await supabaseService
    .from('tenant_portal_customer_links')
    .select('company_id,customer_id,provider,external_customer_id,status')
    .eq('company_id', input.client.company_id)
    .eq('external_customer_id', externalCustomerId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!link.error && link.data?.customer_id) {
    return {
      companyId: input.client.company_id,
      customerId: String(link.data.customer_id),
      externalCustomerId,
      provider: clean(link.data.provider) ?? 'tenant_portal',
    }
  }
  if (link.error && !isMissingSchemaError(link.error)) throw link.error

  const identity = await supabaseService
    .from('customer_portal_identities')
    .select('company_id,customer_id,external_customer_id,provider,status')
    .eq('company_id', input.client.company_id)
    .eq('external_customer_id', externalCustomerId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!identity.error && identity.data?.customer_id) {
    return {
      companyId: input.client.company_id,
      customerId: String(identity.data.customer_id),
      externalCustomerId,
      provider: clean(identity.data.provider) ?? 'tenant_portal',
    }
  }
  if (identity.error && !isMissingSchemaError(identity.error)) throw identity.error

  throw new Error('Kundkontot är inte säkert länkat till en Gridex-kund ännu.')
}

async function logPortalAccess(input: {
  context: PortalCustomerContext
  route: string
  action: string
  metadata?: Record<string, unknown>
}) {
  await supabaseService.from('customer_portal_api_access_logs').insert({
    company_id: input.context.companyId,
    customer_id: input.context.customerId,
    external_customer_id: input.context.externalCustomerId,
    route: input.route,
    action: input.action,
    metadata: input.metadata ?? {},
  }).then(() => null)
}

export async function listPortalContracts(context: PortalCustomerContext, route = '/api/v1/customer/contracts') {
  await logPortalAccess({ context, route, action: 'read_contracts' })
  const { data, error } = await supabaseService
    .from('customer_contracts')
    .select('id,status,contract_type,starts_at,ends_at,signed_at,price_plan_id,campaign_id,monthly_fee_sek,spot_markup_ore_per_kwh,green_fee_mode,green_fee_value,created_at')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('starts_at', { ascending: false })
    .limit(100)
  if (error) {
    if (isMissingSchemaError(error)) return []
    throw error
  }
  return data ?? []
}

export async function listPortalSites(context: PortalCustomerContext, route = '/api/v1/customer/sites') {
  await logPortalAccess({ context, route, action: 'read_sites' })
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('id,status,site_name,facility_id,normalized_facility_id,street,postal_code,city,price_area_code,grid_area_code,grid_owner_id,move_in_date,move_out_date,created_at')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    if (isMissingSchemaError(error)) return []
    throw error
  }
  return data ?? []
}

export async function listPortalMeteringValues(context: PortalCustomerContext, route = '/api/v1/customer/metering-values') {
  await logPortalAccess({ context, route, action: 'read_metering_values' })
  const { data, error } = await supabaseService
    .from('normalized_metering_values')
    .select('id,metering_point_id,customer_site_id,facility_id,price_area,period_start,period_end,quantity_kwh,resolution,status,source,created_at')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('period_start', { ascending: false })
    .limit(500)
  if (error) {
    if (isMissingSchemaError(error)) return []
    throw error
  }
  return data ?? []
}

export async function listPortalInvoices(context: PortalCustomerContext, route = '/api/v1/customer/invoices') {
  await logPortalAccess({ context, route, action: 'read_invoices' })

  const exported = await supabaseService
    .from('invoice_export_items')
    .select('id,status,provider,provider_invoice_guid,provider_invoice_number,provider_payment_reference,provider_ocr,provider_status,purchase_status,recourse_status,amount_ex_vat,vat_amount,amount_inc_vat,created_at,sent_at,metadata')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (!exported.error) return exported.data ?? []
  if (!isMissingSchemaError(exported.error)) throw exported.error

  const pricing = await supabaseService
    .from('pricing_runs')
    .select('id,billing_underlay_id,status,total_ex_vat,vat_amount,total_inc_vat,billing_period_start,billing_period_end,created_at')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (pricing.error) {
    if (isMissingSchemaError(pricing.error)) return []
    throw pricing.error
  }
  return pricing.data ?? []
}

export async function getPortalInvoice(context: PortalCustomerContext, invoiceId: string, route = '/api/v1/customer/invoices/[id]') {
  await logPortalAccess({ context, route, action: 'read_invoice', metadata: { invoice_id: invoiceId } })

  const exported = await supabaseService
    .from('invoice_export_items')
    .select('*')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .eq('id', invoiceId)
    .maybeSingle()

  if (!exported.error && exported.data) return exported.data
  if (exported.error && !isMissingSchemaError(exported.error)) throw exported.error

  const pricing = await supabaseService
    .from('pricing_runs')
    .select('*,pricing_preview_lines(*)')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .eq('id', invoiceId)
    .maybeSingle()

  if (pricing.error) {
    if (isMissingSchemaError(pricing.error)) return null
    throw pricing.error
  }
  return pricing.data ?? null
}

export async function listPortalDocuments(context: PortalCustomerContext, route = '/api/v1/customer/documents') {
  await logPortalAccess({ context, route, action: 'read_documents' })
  const { data, error } = await supabaseService
    .from('customer_documents')
    .select('id,document_type,file_name,status,created_at,metadata')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    if (isMissingSchemaError(error)) return []
    throw error
  }
  return data ?? []
}

export async function createPortalRequest(context: PortalCustomerContext, input: {
  type: 'profile_update' | 'move_out' | 'support_case'
  payload: Record<string, unknown>
  route: string
}) {
  await logPortalAccess({ context, route: input.route, action: input.type })
  const row = {
    company_id: context.companyId,
    customer_id: context.customerId,
    external_customer_id: context.externalCustomerId,
    request_type: input.type,
    status: 'submitted',
    payload: input.payload,
    source: 'customer_portal_api',
  }
  const { data, error } = await supabaseService.from('customer_portal_requests').insert(row).select('*').maybeSingle()
  if (error) {
    if (!isMissingSchemaError(error)) throw error
    return row
  }
  return data ?? row
}
