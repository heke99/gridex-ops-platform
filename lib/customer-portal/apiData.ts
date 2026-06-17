import type { NextRequest } from 'next/server'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import { resolvePortalCustomer, isMissingPortalSchemaError } from '@/lib/customer-portal/customerResolver'

export type PortalCustomerContext = {
  companyId: string
  customerId: string
  externalCustomerId: string | null
  customerNumber: string | null
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
    externalCustomerId: resolution.customer.external_customer_id ?? input.externalCustomerId ?? null,
    customerNumber: resolution.customer.customer_number ?? null,
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
    externalCustomerId: input.externalCustomerId ?? null,
    customerNumber: input.customerNumber ?? null,
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
    metadata: {
      customer_number: input.context.customerNumber,
      ...(input.metadata ?? {}),
    },
  }).then(() => null)
}

const CONTRACT_SELECT = [
  'id',
  'customer_id',
  'site_id',
  'customer_site_id',
  'metering_point_id',
  'status',
  'contract_number',
  'contract_name',
  'contract_type',
  'source_type',
  'starts_at',
  'expected_start_at',
  'requested_start_date',
  'requested_start_mode',
  'calculated_earliest_start_date',
  'confirmed_start_date',
  'confirmed_start_at',
  'actual_start_date',
  'actual_start_at',
  'ends_at',
  'signed_at',
  'price_plan_id',
  'price_plan_version_id',
  'contract_price_snapshot_id',
  'price_area_used',
  'grid_area_code_used',
  'resolution_status',
  'monthly_fee_sek',
  'invoice_fee_sek',
  'markup_ore_per_kwh',
  'spot_markup_ore_per_kwh',
  'variable_fee_ore_per_kwh',
  'fixed_price_ore_per_kwh',
  'green_fee_mode',
  'green_fee_value',
  'binding_months',
  'notice_months',
  'terms_version',
  'metadata',
  'created_at',
].join(',')

const CONTRACT_LEGACY_SELECT = [
  'id',
  'customer_id',
  'site_id',
  'metering_point_id',
  'status',
  'contract_number',
  'contract_name',
  'contract_type',
  'starts_at',
  'ends_at',
  'signed_at',
  'monthly_fee_sek',
  'spot_markup_ore_per_kwh',
  'variable_fee_ore_per_kwh',
  'fixed_price_ore_per_kwh',
  'green_fee_mode',
  'green_fee_value',
  'binding_months',
  'notice_months',
  'created_at',
].join(',')

type ListResult = { data: Array<Record<string, unknown>> | null; error: unknown | null }
type PortalListQuery = () => Promise<ListResult>

export function portalQueryErrorMetadata(error: unknown): Record<string, unknown> {
  const maybe = error as { code?: string; message?: string; details?: string; hint?: string } | null
  return {
    code: maybe?.code ?? null,
    message: maybe?.message ?? String(error ?? 'unknown_error'),
    details: maybe?.details ?? null,
    hint: maybe?.hint ?? null,
  }
}

async function listWithSchemaFallback(queries: PortalListQuery[]): Promise<Array<Record<string, unknown>>> {
  for (const query of queries) {
    const result = await query()
    if (!result.error) return result.data ?? []
    if (!isMissingSchemaError(result.error)) throw result.error
  }
  return []
}

export async function listPortalContracts(context: PortalCustomerContext, route = '/api/v1/customer/contracts') {
  await logPortalAccess({ context, route, action: 'read_contracts' })
  let result = await supabaseService
    .from('customer_contracts')
    .select(CONTRACT_SELECT)
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('created_at', { ascending: false })
    .limit(100) as ListResult

  if (result.error && isMissingSchemaError(result.error)) {
    result = await supabaseService
      .from('customer_contracts')
      .select(CONTRACT_LEGACY_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult
  }

  if (result.error) {
    if (isMissingSchemaError(result.error)) return []
    throw result.error
  }
  return result.data ?? []
}

const SITE_SELECT = 'id,customer_id,status,site_name,facility_id,normalized_facility_id,site_type,street,postal_code,city,country,price_area_code,grid_area_code,grid_owner_id,resolution_status,move_in_date,move_out_date,annual_consumption_kwh,metadata,created_at'
const SITE_LEGACY_SELECT = 'id,customer_id,status,site_name,facility_id,site_type,street,postal_code,city,country,price_area_code,grid_owner_id,move_in_date,move_out_date,annual_consumption_kwh,created_at'
const SITE_MINIMAL_SELECT = 'id,customer_id,status,site_name,facility_id,street,postal_code,city,country,price_area_code,created_at'

export async function listPortalSites(context: PortalCustomerContext, route = '/api/v1/customer/sites') {
  await logPortalAccess({ context, route, action: 'read_sites' })
  return listWithSchemaFallback([
    async () => await supabaseService
      .from('customer_sites')
      .select(SITE_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('customer_sites')
      .select(SITE_LEGACY_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('customer_sites')
      .select(SITE_MINIMAL_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
  ])
}


const WEBSITE_APPLICATION_SELECT = 'id,company_id,customer_id,customer_site_id,metering_point_id,contract_id,status,grid_area_code,grid_owner_id,price_area_code,resolution_status,facility_data_verified_at,payload,response_payload,warnings,created_at,updated_at'
const WEBSITE_APPLICATION_MINIMAL_SELECT = 'id,customer_id,customer_site_id,metering_point_id,contract_id,status,response_payload,warnings,created_at,updated_at'

export async function listPortalWebsiteApplications(context: PortalCustomerContext, route = '/api/v1/customer/portal-bundle') {
  await logPortalAccess({ context, route, action: 'read_website_applications' })
  return listWithSchemaFallback([
    async () => await supabaseService
      .from('website_customer_applications')
      .select(WEBSITE_APPLICATION_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(20) as ListResult,
    async () => await supabaseService
      .from('website_customer_applications')
      .select(WEBSITE_APPLICATION_MINIMAL_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(20) as ListResult,
  ])
}

const METERING_VALUES_SELECT = 'id,customer_id,customer_site_id,site_id,metering_point_id,facility_id,price_area,grid_area,period_start,period_end,resolution,quantity_kwh,quality_status,source_type,status,created_at'
const METERING_VALUES_LEGACY_SELECT = 'id,metering_point_id,customer_site_id,facility_id,price_area,period_start,period_end,quantity_kwh,resolution,status,created_at'
const METERING_VALUES_MINIMAL_SELECT = 'id,metering_point_id,period_start,period_end,quantity_kwh,status,created_at'

export async function listPortalMeteringValues(context: PortalCustomerContext, route = '/api/v1/customer/metering-values') {
  await logPortalAccess({ context, route, action: 'read_metering_values' })
  return listWithSchemaFallback([
    async () => await supabaseService
      .from('normalized_metering_values')
      .select(METERING_VALUES_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('period_start', { ascending: false })
      .limit(500) as ListResult,
    async () => await supabaseService
      .from('normalized_metering_values')
      .select(METERING_VALUES_LEGACY_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('period_start', { ascending: false })
      .limit(500) as ListResult,
    async () => await supabaseService
      .from('normalized_metering_values')
      .select(METERING_VALUES_MINIMAL_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('period_start', { ascending: false })
      .limit(500) as ListResult,
  ])
}

const CUSTOMER_INVOICE_SELECT = 'id,customer_id,agreement_id,billing_underlay_id,partner_export_id,partner_invoice_reference,invoice_number,period_start,period_end,total_kwh,amount_ex_vat,vat_amount,amount_inc_vat,currency,due_date,issued_at,paid_at,status,pdf_url,source_system,metadata,created_at'
const CUSTOMER_INVOICE_MINIMAL_SELECT = 'id,customer_id,invoice_number,period_start,period_end,amount_ex_vat,vat_amount,amount_inc_vat,currency,due_date,issued_at,paid_at,status,pdf_url,created_at'

export async function listPortalInvoices(context: PortalCustomerContext, route = '/api/v1/customer/invoices') {
  await logPortalAccess({ context, route, action: 'read_invoices' })

  const invoices = await listWithSchemaFallback([
    async () => await supabaseService
      .from('customer_invoices')
      .select(CUSTOMER_INVOICE_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('period_start', { ascending: false, nullsFirst: false })
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('customer_invoices')
      .select(CUSTOMER_INVOICE_MINIMAL_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('period_start', { ascending: false, nullsFirst: false })
      .limit(100) as ListResult,
  ])

  if (invoices.length > 0) return invoices

  const exported = await listWithSchemaFallback([
    async () => await supabaseService
      .from('invoice_export_items')
      .select('id,status,provider,provider_invoice_guid,provider_invoice_number,provider_payment_reference,provider_ocr,provider_status,purchase_status,recourse_status,amount_ex_vat,vat_amount,amount_inc_vat,created_at,sent_at,metadata')
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
  ])

  if (exported.length > 0) return exported

  return listWithSchemaFallback([
    async () => await supabaseService
      .from('pricing_runs')
      .select('id,billing_underlay_id,status,total_ex_vat,vat_amount,total_inc_vat,billing_period_start,billing_period_end,created_at')
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
  ])
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

const DOCUMENT_SELECT = 'id,document_type,title,file_name,mime_type,file_size_bytes,status,public_url,source_system,source,metadata,raw_payload,power_of_attorney_id,customer_site_id,metering_point_id,contract_id,customer_contract_id,customer_number,external_customer_id,document_version,created_at'
const DOCUMENT_LEGACY_SELECT = 'id,document_type,title,file_name,mime_type,file_size_bytes,public_url,source_system,power_of_attorney_id,metadata,created_at'
const DOCUMENT_MINIMAL_SELECT = 'id,document_type,title,file_name,power_of_attorney_id,created_at'
const AUTH_DOCUMENT_SELECT = 'id,document_type,status,title,file_name,mime_type,file_size_bytes,storage_bucket,file_path,reference,notes,power_of_attorney_id,customer_contract_id,metering_point_id,metadata,uploaded_at,created_at'

export async function listPortalDocuments(context: PortalCustomerContext, route = '/api/v1/customer/documents') {
  await logPortalAccess({ context, route, action: 'read_documents' })
  const customerDocuments = await listWithSchemaFallback([
    async () => await supabaseService
      .from('customer_documents')
      .select(DOCUMENT_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('customer_documents')
      .select(DOCUMENT_LEGACY_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('customer_documents')
      .select(DOCUMENT_MINIMAL_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
  ])

  const authorizationDocuments = await listWithSchemaFallback([
    async () => await supabaseService
      .from('customer_authorization_documents')
      .select(AUTH_DOCUMENT_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
  ])

  const normalizedAuthorizationDocuments: Array<Record<string, unknown>> = authorizationDocuments.map((row) => ({
    ...row,
    source_system: row.source_system ?? 'customer_authorization_documents',
    source: row.source ?? 'customer_authorization_documents',
    public_url: row.public_url ?? null,
    file_path: row.file_path ?? null,
  }))

  const documents: Array<Record<string, unknown>> = [
    ...customerDocuments,
    ...normalizedAuthorizationDocuments,
  ]

  const seen = new Set<string>()
  return documents
    .filter((row) => {
      const id = String(row.id ?? '')
      const key = String(row.power_of_attorney_id ?? id)
      if (key && seen.has(key)) return false
      if (key) seen.add(key)
      return true
    })
    .sort((a, b) => String(b.created_at ?? b.uploaded_at ?? '').localeCompare(String(a.created_at ?? a.uploaded_at ?? '')))
}

const POA_SELECT = 'id,contract_id,customer_site_id,site_id,metering_point_id,scope,status,signed_at,accepted_at,valid_from,valid_to,valid_until,legal_text_version_id,scope_summary,fullmakt_snapshot,metadata,created_at'
const POA_CURRENT_SELECT = 'id,contract_id,customer_site_id,scope,status,accepted_at,valid_until,legal_text_version_id,scope_summary,fullmakt_snapshot,metadata,created_at'
const POA_MINIMAL_SELECT = 'id,contract_id,customer_site_id,scope,status,metadata,created_at'

export async function listPortalPowersOfAttorney(context: PortalCustomerContext, route = '/api/v1/customer/powers-of-attorney') {
  await logPortalAccess({ context, route, action: 'read_powers_of_attorney' })
  return listWithSchemaFallback([
    async () => await supabaseService
      .from('powers_of_attorney')
      .select(POA_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('powers_of_attorney')
      .select(POA_CURRENT_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('powers_of_attorney')
      .select(POA_MINIMAL_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
  ])
}

const METERING_POINT_SELECT = 'id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,ediel_metering_point_id,site_facility_id,status,metering_type,measurement_type,reading_frequency,grid_owner_id,grid_area_code,price_area_code,start_date,end_date,verification_status,onboarding_status,data_quality_status,created_at'
const METERING_POINT_LEGACY_SELECT = 'id,customer_id,site_id,metering_point_id,meter_point_id,ediel_metering_point_id,site_facility_id,status,measurement_type,reading_frequency,grid_owner_id,price_area_code,start_date,end_date,created_at'
const METERING_POINT_MINIMAL_SELECT = 'id,customer_id,site_id,metering_point_id,meter_point_id,status,price_area_code,created_at'

export async function listPortalMeteringPoints(context: PortalCustomerContext, sites: Array<Record<string, unknown>> = [], route = '/api/v1/customer/sites') {
  await logPortalAccess({ context, route, action: 'read_metering_points' })
  const siteIds = sites.map((site) => String(site.id ?? '')).filter(Boolean)

  if (siteIds.length === 0) {
    return listWithSchemaFallback([
      async () => await supabaseService
        .from('metering_points')
        .select(METERING_POINT_SELECT)
        .eq('company_id', context.companyId)
        .eq('customer_id', context.customerId)
        .limit(100) as ListResult,
      async () => await supabaseService
        .from('metering_points')
        .select(METERING_POINT_LEGACY_SELECT)
        .eq('company_id', context.companyId)
        .eq('customer_id', context.customerId)
        .limit(100) as ListResult,
      async () => await supabaseService
        .from('metering_points')
        .select(METERING_POINT_MINIMAL_SELECT)
        .eq('company_id', context.companyId)
        .eq('customer_id', context.customerId)
        .limit(100) as ListResult,
    ])
  }

  return listWithSchemaFallback([
    async () => await supabaseService
      .from('metering_points')
      .select(METERING_POINT_SELECT)
      .eq('company_id', context.companyId)
      .or(`site_id.in.(${siteIds.join(',')}),customer_site_id.in.(${siteIds.join(',')})`)
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('metering_points')
      .select(METERING_POINT_SELECT)
      .eq('company_id', context.companyId)
      .in('customer_site_id', siteIds)
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('metering_points')
      .select(METERING_POINT_LEGACY_SELECT)
      .eq('company_id', context.companyId)
      .in('site_id', siteIds)
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('metering_points')
      .select(METERING_POINT_MINIMAL_SELECT)
      .eq('company_id', context.companyId)
      .in('site_id', siteIds)
      .limit(100) as ListResult,
  ])
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


const LEGAL_ACCEPTANCE_SELECT = 'id,acceptance_type,legal_text_version_id,contract_id,contract_application_id,accepted_at,source,snapshot,metadata,created_at'
const LEGAL_ACCEPTANCE_LEGACY_SELECT = 'id,acceptance_type,legal_text_version_id,contract_id,contract_application_id,accepted_at,snapshot,metadata,created_at'
const LEGAL_ACCEPTANCE_MINIMAL_SELECT = 'id,acceptance_type,accepted_at,metadata,created_at'

export async function listPortalLegalAcceptances(context: PortalCustomerContext, route = '/api/v1/customer/legal-acceptances') {
  await logPortalAccess({ context, route, action: 'read_legal_acceptances' })
  return listWithSchemaFallback([
    async () => await supabaseService
      .from('customer_legal_acceptances')
      .select(LEGAL_ACCEPTANCE_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('accepted_at', { ascending: false })
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('customer_legal_acceptances')
      .select(LEGAL_ACCEPTANCE_LEGACY_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('accepted_at', { ascending: false })
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('customer_legal_acceptances')
      .select(LEGAL_ACCEPTANCE_MINIMAL_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('accepted_at', { ascending: false })
      .limit(100) as ListResult,
  ])
}

const EVENT_SELECT = 'id,event_type,source,payload,metadata,occurred_at,created_at'
const EVENT_LEGACY_SELECT = 'id,event_type,payload,metadata,created_at'

export async function listPortalEvents(context: PortalCustomerContext, route = '/api/v1/customer/events') {
  await logPortalAccess({ context, route, action: 'read_events' })
  return listWithSchemaFallback([
    async () => await supabaseService
      .from('customer_events')
      .select(EVENT_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('occurred_at', { ascending: false })
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('customer_events')
      .select(EVENT_LEGACY_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
  ])
}

const NOTIFICATION_SELECT = 'id,type,title,message,status,read_at,action_url,metadata,created_at'
const NOTIFICATION_LEGACY_SELECT = 'id,type,title,message,status,created_at'

export async function listPortalNotifications(context: PortalCustomerContext, route = '/api/v1/customer/notifications') {
  await logPortalAccess({ context, route, action: 'read_notifications' })
  return listWithSchemaFallback([
    async () => await supabaseService
      .from('customer_notifications')
      .select(NOTIFICATION_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
    async () => await supabaseService
      .from('customer_notifications')
      .select(NOTIFICATION_LEGACY_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .order('created_at', { ascending: false })
      .limit(100) as ListResult,
  ])
}
