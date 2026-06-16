import type { NextRequest } from 'next/server'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import { resolvePortalCustomer, isMissingPortalSchemaError } from '@/lib/customer-portal/customerResolver'

export type PortalCustomerContext = {
  companyId: string
  customerId: string
  externalCustomerId: string
  provider: string
}

export function isMissingSchemaError(error: unknown): boolean {
  return isMissingPortalSchemaError(error)
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
  const resolution = await resolvePortalCustomer({
    client: input.client,
    identifiers: { externalCustomerId: input.externalCustomerId },
  })
  if (!resolution.ok) throw new Error(resolution.error)

  return {
    companyId: input.client.company_id,
    customerId: resolution.customer.customer_id,
    externalCustomerId: resolution.customer.external_customer_id ?? resolution.customer.customer_number ?? input.externalCustomerId ?? resolution.customer.customer_id,
    provider: resolution.customer.provider ?? 'tenant_portal',
  }
}

export function portalContextFromResolved(input: {
  companyId: string
  customerId: string
  externalCustomerId?: string | null
  customerNumber?: string | null
  provider?: string | null
}): PortalCustomerContext {
  return {
    companyId: input.companyId,
    customerId: input.customerId,
    externalCustomerId: input.externalCustomerId ?? input.customerNumber ?? input.customerId,
    provider: input.provider ?? 'tenant_portal',
  }
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

  const invoices = await supabaseService
    .from('customer_invoices')
    .select('id,customer_id,agreement_id,billing_underlay_id,partner_export_id,partner_invoice_reference,invoice_number,period_start,period_end,total_kwh,amount_ex_vat,vat_amount,amount_inc_vat,currency,due_date,issued_at,paid_at,status,pdf_url,source_system,created_at')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('period_start', { ascending: false, nullsFirst: false })
    .limit(100)

  if (!invoices.error) return invoices.data ?? []
  if (!isMissingSchemaError(invoices.error)) throw invoices.error

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
  type: 'profile_update' | 'move_out'
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


export async function listPortalLegalAcceptances(context: PortalCustomerContext, route = '/api/v1/customer/legal-acceptances') {
  await logPortalAccess({ context, route, action: 'read_legal_acceptances' })
  const { data, error } = await supabaseService
    .from('customer_legal_acceptances')
    .select('id,acceptance_type,legal_text_version_id,contract_id,contract_application_id,accepted_at,source,snapshot,metadata,created_at')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('accepted_at', { ascending: false })
    .limit(100)
  if (error) {
    if (isMissingSchemaError(error)) return []
    throw error
  }
  return data ?? []
}

export async function listPortalEvents(context: PortalCustomerContext, route = '/api/v1/customer/events') {
  await logPortalAccess({ context, route, action: 'read_events' })
  const { data, error } = await supabaseService
    .from('customer_events')
    .select('id,event_type,source,payload,metadata,occurred_at,created_at')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('occurred_at', { ascending: false })
    .limit(100)
  if (error) {
    if (isMissingSchemaError(error)) return []
    throw error
  }
  return data ?? []
}

export async function listPortalNotifications(context: PortalCustomerContext, route = '/api/v1/customer/notifications') {
  await logPortalAccess({ context, route, action: 'read_notifications' })
  const { data, error } = await supabaseService
    .from('customer_notifications')
    .select('id,type,title,message,status,read_at,action_url,metadata,created_at')
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
