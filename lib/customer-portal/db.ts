import { createHash } from 'node:crypto'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { publicSupportStatus } from '@/lib/customer-service/supportConversation'
import { customerMayReadPortalRecords, isPortalCompletionCase } from '@/lib/customer-portal/caseProjection'
import { mapWithConcurrency } from '@/lib/performance/mapWithConcurrency'
import { InvalidReadModelResponseError } from '@/lib/read-models/readResult'
import { isUuid } from '@/lib/validation/uuid'
import type {
  CustomerInvoiceDocumentRow,
  CustomerInvoiceLineRow,
  CustomerInvoiceRow,
  CustomerPortalBranding,
  CustomerPortalContext,
  CustomerPortalCustomerRow,
  CustomerPortalMeteringPointRow,
  CustomerPortalMeteringValueRow,
  CustomerPortalSiteRow,
  CustomerConsumptionMonth,
  CustomerConsumptionReviewReason,
  CustomerPortalCaseRow,
  CustomerPortalCompletionRow,
  CustomerPortalContractRow,
  CustomerPortalInfoRequestRow,
} from '@/lib/customer-portal/types'
import { buildPortalCustomerStatus, displayNameFromCustomer } from '@/lib/customer-portal/status'
import { PORTAL_PUBLISHED_INVOICE_STATUSES } from '@/lib/customer-portal/format'
import { buildPortalDatabasePage, decodePortalCursor, PortalCursorError } from '@/lib/customer-portal/keysetPagination'
import { readInvoiceFileAvailability, readRetiredInvoiceDocuments, type InvoiceFileAvailability } from '@/lib/customer-portal/invoiceFileAvailability'

type PortalAccountLookupRow = {
  customer_id: string
  company_id: string | null
  is_active: boolean
  activated_at: string | null
  status: string | null
  role: string | null
}

const portalSupportEmailSchema = z.email().max(254)

const DEFAULT_PORTAL_BRANDING: CustomerPortalBranding = {
  companyId: null,
  brandName: 'din elhandlare',
  portalName: 'Kundportal',
  supportEmail: null,
  websiteUrl: null,
  logoUrl: null,
  primaryColor: '#047857',
}

function brandingString(source: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isValidHexColor(value: string | null): boolean {
  return Boolean(value && /^#[0-9a-fA-F]{6}$/.test(value))
}

// Resolves the tenant brand the signed-in customer belongs to so that the
// customer portal never shows another company's brand.
async function resolveCustomerPortalBranding(companyIds: string[]): Promise<CustomerPortalBranding> {
  const distinct = Array.from(new Set(companyIds.filter(Boolean)))
  if (distinct.length !== 1) return DEFAULT_PORTAL_BRANDING

  const companyId = distinct[0]
  const { data, error } = await supabaseService
    .from('companies')
    .select('id,name,support_email,website,branding')
    .eq('id', companyId)
    .maybeSingle()

  if (error || !data) return DEFAULT_PORTAL_BRANDING

  const branding = (data.branding && typeof data.branding === 'object' && !Array.isArray(data.branding)
    ? data.branding
    : {}) as Record<string, unknown>

  const brandName = brandingString(branding, 'display_name')
    ?? brandingString(branding, 'customer_portal_name')
    ?? (typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null)
    ?? DEFAULT_PORTAL_BRANDING.brandName
  const portalName = brandingString(branding, 'customer_portal_name') ?? `${brandName} kundportal`
  const supportEmail = [
    brandingString(branding, 'support_email'),
    typeof data.support_email === 'string' ? data.support_email.trim() : null,
  ].find((email): email is string => portalSupportEmailSchema.safeParse(email).success) ?? null
  const websiteUrl = brandingString(branding, 'website_url')
    ?? (typeof data.website === 'string' && data.website.trim() ? data.website.trim() : null)
  const primaryColorCandidate = brandingString(branding, 'primary_color')

  return {
    companyId: String(data.id),
    brandName,
    portalName,
    supportEmail,
    websiteUrl,
    logoUrl: brandingString(branding, 'logo_url'),
    primaryColor: isValidHexColor(primaryColorCandidate) ? primaryColorCandidate! : DEFAULT_PORTAL_BRANDING.primaryColor,
  }
}

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}


function missingPortalDataSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function monthKeyFromValue(row: CustomerPortalMeteringValueRow): string {
  const source = row.period_start ?? row.read_at ?? row.created_at
  const date = new Date(source)
  if (Number.isNaN(date.getTime())) return 'Okänd period'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(monthKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey
  const [year, month] = monthKey.split('-')
  return `${year}-${month}`
}

export const getCustomerPortalContext = cache(async function getCustomerPortalContext(): Promise<CustomerPortalContext> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: accountRows, error: accountError } = await supabaseService
    .from('customer_portal_accounts')
    .select('customer_id,company_id,is_active,activated_at,status,role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('activated_at', { ascending: false, nullsFirst: false })
    .order('id')

  if (accountError) throw accountError

  const accounts = ((accountRows ?? []) as PortalAccountLookupRow[]).filter((row) => Boolean(row.customer_id))
  const linkedCustomerIds = Array.from(new Set(accounts.map((row) => row.customer_id)))

  if (linkedCustomerIds.length === 0) {
    return {
      userEmail: user.email ?? null,
      companyId: null,
      customerIds: [],
      customers: [],
      branding: DEFAULT_PORTAL_BRANDING,
    }
  }

  const { data: customerRows, error: customerError } = await supabaseService
    .from('customers')
    .select(
      'id,company_id,customer_number,customer_type,status,first_name,last_name,full_name,company_name,email,phone'
    )
    .in('id', linkedCustomerIds)
    .order('created_at', { ascending: false })

  if (customerError) throw customerError

  const allRows = (customerRows ?? []) as Array<CustomerPortalCustomerRow & { company_id?: string | null }>
  const companyByCustomerId = new Map(allRows.map((row) => [row.id, row.company_id ?? null]))

  // A portal session is always scoped to exactly one tenant. If the auth user
  // has linked customers in several companies (rare), the most recently
  // activated account decides the active tenant; the other tenants' data is
  // never mixed into the same session.
  let activeCompanyId: string | null = null
  for (const account of accounts) {
    const candidate = account.company_id ?? companyByCustomerId.get(account.customer_id) ?? null
    if (candidate) {
      activeCompanyId = String(candidate)
      break
    }
  }

  const rows = activeCompanyId
    ? allRows.filter((row) => String(row.company_id ?? '') === activeCompanyId)
    : allRows
  const customerIds = rows.map((row) => row.id)

  const branding = await resolveCustomerPortalBranding(activeCompanyId ? [activeCompanyId] : [])

  return {
    userEmail: user.email ?? null,
    companyId: activeCompanyId,
    customerIds,
    requestResponseCustomerIds: Array.from(new Set(accounts.filter(account =>
      activeCompanyId !== null && (account.company_id ?? companyByCustomerId.get(account.customer_id)) === activeCompanyId
      && account.status === 'active' && account.role === 'owner' && customerIds.includes(account.customer_id),
    ).map(account => account.customer_id))),
    customers: rows,
    branding,
  }
})

export function assertPortalAccessToCustomer(
  context: CustomerPortalContext,
  customerId: string
) {
  if (!context.customerIds.includes(customerId)) {
    throw new Error('Du har inte åtkomst till den här kunden.')
  }
}

export async function listPortalInvoices(
  context: CustomerPortalContext
): Promise<CustomerInvoiceRow[]> {
  if (context.customerIds.length === 0 || !context.companyId) return []

  const { data, error } = await supabaseService
    .from('customer_invoices')
    .select('*')
    .eq('company_id', context.companyId)
    .in('customer_id', context.customerIds)
    .in('status', PORTAL_PUBLISHED_INVOICE_STATUSES)
    .order('issued_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as CustomerInvoiceRow[]
}

export async function getPortalInvoiceDetail(
  context: CustomerPortalContext,
  invoiceId: string,
  options: { loadLines?: boolean } = {},
): Promise<{
  invoice: CustomerInvoiceRow | null
  lines: CustomerInvoiceLineRow[]
  documents: Array<CustomerInvoiceDocumentRow & { fileAvailability: InvoiceFileAvailability }>
  invoiceFileAvailability: InvoiceFileAvailability | null
}> {
  if (context.customerIds.length === 0 || !context.companyId) {
    return { invoice: null, lines: [], documents: [], invoiceFileAvailability: null }
  }

  const { data: invoice, error: invoiceError } = await supabaseService
    .from('customer_invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('company_id', context.companyId)
    .in('customer_id', context.customerIds)
    .in('status', PORTAL_PUBLISHED_INVOICE_STATUSES)
    .maybeSingle()

  if (invoiceError) throw invoiceError
  if (!invoice) return { invoice: null, lines: [], documents: [], invoiceFileAvailability: null }
  const invoiceFileAvailability = await readInvoiceFileAvailability({
    companyId: context.companyId, retentionClass: 'customer_invoice_pdf_bytes', targetId: invoice.id,
  })

  // Bounded reads: real invoices have at most a handful of lines/documents; the
  // caps only protect page load time against pathological data.
  const [linesResult, documentsResult] = await Promise.all([
    options.loadLines === false ? Promise.resolve({ data: [], error: null }) : supabaseService
      .from('customer_invoice_lines')
      .select('*')
      .eq('company_id', context.companyId)
      .eq('invoice_id', invoiceId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(500),
    // Legacy PDF rows without a customer ID inherit the verified invoice's scope.
    invoice.customer_id
      ? supabaseService
        .from('customer_invoice_documents')
        .select('*')
        .eq('company_id', context.companyId)
        .eq('invoice_id', invoice.id)
        .eq('document_type', 'invoice_pdf')
        .or(`customer_id.eq.${invoice.customer_id},customer_id.is.null`)
        .order('created_at', { ascending: false })
        .limit(100)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (linesResult.error) throw linesResult.error
  if (documentsResult.error) throw documentsResult.error
  const rows = (documentsResult.data ?? []) as CustomerInvoiceDocumentRow[]
  const retired = await readRetiredInvoiceDocuments(context.companyId, invoiceId, rows.map(document => document.id))
  const documents = rows.map(document => ({
    ...document,
    ...(retired.has(document.id) ? { public_url: null, file_path: null, fileAvailability: 'retired' as const }
      : { fileAvailability: 'not_retired' as const }),
  }))

  return {
    invoice: (invoiceFileAvailability === 'retired' ? { ...invoice, pdf_url: null, pdf_path: null } : invoice) as CustomerInvoiceRow,
    lines: (linesResult.data ?? []) as CustomerInvoiceLineRow[],
    documents,
    invoiceFileAvailability,
  }
}

export async function listPortalSites(
  context: CustomerPortalContext,
  siteIds?: string[]
): Promise<CustomerPortalSiteRow[]> {
  if (context.customerIds.length === 0 || !context.companyId || siteIds?.length === 0) return []

  let query = supabaseService
    .from('customer_sites')
    .select(
      'id,customer_id,site_name,facility_id,street,postal_code,city,grid_owner_id,price_area_code,status,annual_consumption_kwh'
    )
    .eq('company_id', context.companyId)
    .in('customer_id', context.customerIds)
  if (siteIds) query = query.in('id', siteIds)

  const { data, error } = await query.order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return (data ?? []) as CustomerPortalSiteRow[]
}

export async function getPortalSelectedSite(
  context: CustomerPortalContext,
  selection: unknown
): Promise<CustomerPortalSiteRow | null> {
  if (typeof selection !== 'string' || !isUuid(selection)) return null

  const [site] = await listPortalSites(context, [selection.trim().toLowerCase()])
  return site ?? null
}

export async function listPortalMeteringPoints(
  siteIds: string[]
): Promise<CustomerPortalMeteringPointRow[]> {
  if (siteIds.length === 0) return []

  const { data, error } = await supabaseService
    .from('metering_points')
    .select('id,site_id,meter_point_id,grid_owner_id,price_area_code,status')
    .in('site_id', siteIds)
    .order('created_at', { ascending: false })
    .limit(250)

  if (error) throw error
  return (data ?? []) as CustomerPortalMeteringPointRow[]
}

export async function listPortalMeteringValues(
  context: CustomerPortalContext,
  options: {
    limit?: number
    currentOnly?: boolean
  } = {}
): Promise<CustomerPortalMeteringValueRow[]> {
  if (context.customerIds.length === 0 || !context.companyId) return []

  const columns = 'id,customer_id,site_id,metering_point_id,source_request_id,grid_owner_id,reading_type,value_kwh,quality_code,read_at,period_start,period_end,source_system,created_at'
  const query = options.currentOnly
    ? supabaseService.from('gridex_portal_current_metering_values_v1').select(`${columns},meter_point_id`)
    : supabaseService.from('metering_values').select(columns)
  const { data, error } = await query
    .eq('company_id', context.companyId)
    .in('customer_id', context.customerIds)
    .order('period_start', { ascending: false, nullsFirst: false })
    .order('read_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(options.limit ?? 250)

  if (error) throw error
  return (data ?? []) as CustomerPortalMeteringValueRow[]
}

/** Number of Europe/Stockholm calendar months shown on the portal consumption cards. */
export const PORTAL_CONSUMPTION_MONTHS = 12

function stockholmMonthStart(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit' }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${year}-${month}-01`
}

function portalConsumptionMonthArgs(
  companyId: string, customerIds: string[],
  options: { months?: number; now?: Date }
) {
  const months = Math.min(Math.max(Math.trunc(options.months ?? PORTAL_CONSUMPTION_MONTHS), 1), 36)
  const now = options.now ?? new Date()
  const toMonth = stockholmMonthStart(now)
  const [year, month] = toMonth.split('-').map(Number)
  const from = new Date(Date.UTC(year, month - 1 - (months - 1), 1))
  const fromMonth = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}-01`

  return {
    p_company_id: companyId,
    p_customer_ids: customerIds,
    p_from_month: fromMonth,
    p_to_month: toMonth,
  }
}

type PortalConsumptionMonthRow = {
  month_key: string
  total_kwh: number | string | null
  value_count: number | string | null
  is_complete: boolean | null
  reason_codes?: unknown
}

function portalConsumptionMonths(rows: PortalConsumptionMonthRow[]): CustomerConsumptionMonth[] {
  return rows.map((row) => {
    const reasons: unknown[] = Array.isArray(row.reason_codes) ? row.reason_codes : []
    const reviewReasons = reasons.filter((reason): reason is CustomerConsumptionReviewReason =>
      reason === 'coverage_gap' || reason === 'reading_overlap' || reason === 'supply_unconfirmed',
    )
    return {
      monthKey: row.month_key,
      label: monthLabel(row.month_key),
      totalKwh: row.total_kwh === null ? null : normalizeNumber(row.total_kwh),
      valueCount: Number(row.value_count ?? 0),
      complete: Boolean(row.is_complete),
      ...(row.total_kwh === null && reasons.includes('reading_crosses_boundary') ? { needsFinerIntervals: true } : {}),
      ...(reviewReasons.length > 0 ? { reviewReasons } : {}),
    }
  })
}

/**
 * Complete-month consumption totals from the native tenant/customer-bound aggregation. Every
 * current consumption value of each Europe/Stockholm month is summed in the database, independent
 * of the bounded detail list; corrections never double count.
 */
export async function listPortalMonthlyConsumption(
  context: CustomerPortalContext,
  options: { months?: number; now?: Date } = {}
): Promise<CustomerConsumptionMonth[]> {
  if (context.customerIds.length === 0 || !context.companyId) return []
  const args = portalConsumptionMonthArgs(context.companyId, context.customerIds, options)
  const enriched = await supabaseService.rpc('gridex_portal_monthly_consumption_v2', args)
  const missingV2 = enriched.error?.code === 'PGRST202' &&
    enriched.error.message.startsWith('Could not find the function public.gridex_portal_monthly_consumption_v2(')
  // A rolling release can put the app ahead of the V2 schema.
  const { data, error } = missingV2
    ? await supabaseService.rpc('gridex_portal_monthly_consumption_v1', args)
    : enriched
  if (error) throw error

  return portalConsumptionMonths((data ?? []) as PortalConsumptionMonthRow[])
}

/**
 * Read the displayed consumption page in a single source-qualified database
 * snapshot. The limit is applied natively after delivery authorization.
 */
export async function listPortalConsumptionPage(context: CustomerPortalContext): Promise<{
  values: CustomerPortalMeteringValueRow[]
  months: CustomerConsumptionMonth[]
}> {
  if (context.customerIds.length === 0 || !context.companyId) return { values: [], months: [] }
  const args = portalConsumptionMonthArgs(context.companyId, context.customerIds, {})
  type PageRpc = (name: 'gridex_portal_consumption_page_v1', params: typeof args) => PromiseLike<{ data: unknown; error: unknown }>
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as PageRpc
  const { data, error } = await rpc('gridex_portal_consumption_page_v1', args)
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || !('values' in data) || !Array.isArray(data.values) || data.values.length > 500
    || !('months' in data) || !Array.isArray(data.months)
    || data.months.some(row => !row || typeof row.month_key !== 'string')
    || data.values.some(row => !row || !isUuid(row.id) || !context.customerIds.includes(row.customer_id))) {
    throw new InvalidReadModelResponseError()
  }
  return { values: data.values, months: portalConsumptionMonths(data.months) }
}

/**
 * Sums only the rows passed in. Do not use for month cards fed by a limited detail list; use
 * listPortalMonthlyConsumption for complete-month totals.
 */
export function summarizeConsumptionByMonth(
  values: CustomerPortalMeteringValueRow[]
): CustomerConsumptionMonth[] {
  const grouped = new Map<string, CustomerConsumptionMonth & { totalKwh: number }>()

  for (const row of values) {
    const key = monthKeyFromValue(row)
    const current = grouped.get(key) ?? {
      monthKey: key,
      label: monthLabel(key),
      totalKwh: 0,
      valueCount: 0,
    }

    current.totalKwh += normalizeNumber(row.value_kwh)
    current.valueCount += 1
    grouped.set(key, current)
  }

  return Array.from(grouped.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey))
}


async function listPortalPowersOfAttorneyForDashboard(context: CustomerPortalContext): Promise<Array<Record<string, unknown>>> {
  if (context.customerIds.length === 0 || !context.companyId) return []

  const { data, error } = await supabaseService
    .from('powers_of_attorney')
    .select('id,customer_id,site_id,metering_point_id,scope,status,signed_at,valid_from,valid_to,reference,metadata,created_at')
    .eq('company_id', context.companyId)
    .in('customer_id', context.customerIds)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    if (missingPortalDataSchema(error)) return []
    throw error
  }
  return (data ?? []) as Array<Record<string, unknown>>
}

async function listPortalLegalAcceptancesForDashboard(context: CustomerPortalContext): Promise<Array<Record<string, unknown>>> {
  if (context.customerIds.length === 0 || !context.companyId) return []

  const { data, error } = await supabaseService
    .from('customer_legal_acceptances')
    .select('id,customer_id,contract_id,contract_application_id,acceptance_type,legal_bundle_version_document_id,legal_module_key,legal_document_version,legal_document_sha256,request_id,trace_id,legal_text_version_id,accepted_at,source,metadata,created_at')
    .eq('company_id', context.companyId)
    .in('customer_id', context.customerIds)
    .order('accepted_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    if (missingPortalDataSchema(error)) return []
    throw error
  }
  return (data ?? []) as Array<Record<string, unknown>>
}

async function listPortalWebsiteApplicationsForDashboard(context: CustomerPortalContext): Promise<Array<Record<string, unknown>>> {
  if (context.customerIds.length === 0 || !context.companyId) return []

  const { data, error } = await supabaseService
    .from('website_customer_applications')
    .select('id,customer_id,customer_site_id,metering_point_id,contract_id,status,grid_area_code,grid_owner_id,price_area_code,resolution_status,facility_data_verified_at,payload,response_payload,warnings,created_at,updated_at')
    .eq('company_id', context.companyId)
    .in('customer_id', context.customerIds)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    if (missingPortalDataSchema(error)) return []
    throw error
  }
  return (data ?? []) as Array<Record<string, unknown>>
}

async function loadPortalDashboardBasis(context: CustomerPortalContext) {
  const [invoices, sites, contracts, powersOfAttorney, legalAcceptances, websiteApplications, consumptionMonths] = await Promise.all([
    listPortalInvoices(context),
    listPortalSites(context),
    listPortalContracts(context),
    listPortalPowersOfAttorneyForDashboard(context),
    listPortalLegalAcceptancesForDashboard(context),
    listPortalWebsiteApplicationsForDashboard(context),
    listPortalMonthlyConsumption(context),
  ])

  const siteIds = sites.map((site) => site.id)
  const meteringPoints = await listPortalMeteringPoints(siteIds)
  const primaryCustomer = context.customers[0] ?? null
  const customerStatus = buildPortalCustomerStatus({
    customer: primaryCustomer as Record<string, unknown> | null,
    contracts: contracts as Array<Record<string, unknown>>,
    sites: sites as Array<Record<string, unknown>>,
    meteringPoints: meteringPoints as Array<Record<string, unknown>>,
    powersOfAttorney,
    legalAcceptances,
    applications: websiteApplications,
  })

  return {
    context,
    invoices,
    sites,
    meteringPoints,
    contracts,
    powersOfAttorney,
    legalAcceptances,
    websiteApplications,
    customerStatus,
    portalDisplayName: displayNameFromCustomer(primaryCustomer as Record<string, unknown> | null, context.userEmail),
    consumptionMonths,
  }
}

/** Overview cards use native month totals and status inputs, not raw detail rows. */
export async function getPortalOverviewData() {
  const context = await getCustomerPortalContext()
  const { invoices, sites, meteringPoints, customerStatus, portalDisplayName, consumptionMonths } =
    await loadPortalDashboardBasis(context)
  return { context, invoices, sites, meteringPoints, customerStatus, portalDisplayName, consumptionMonths }
}

// Retain the existing dashboard contract for callers that need its raw detail.
export async function getPortalDashboardData() {
  const context = await getCustomerPortalContext()
  const [basis, meteringValues] = await Promise.all([
    loadPortalDashboardBasis(context),
    listPortalMeteringValues(context, { limit: 250 }),
  ])
  return { ...basis, meteringValues }
}

export async function listPortalContracts(
  context: CustomerPortalContext,
  site?: Pick<CustomerPortalSiteRow, 'id' | 'customer_id'>
): Promise<CustomerPortalContractRow[]> {
  if (context.customerIds.length === 0 || !context.companyId) return []

  let query = supabaseService
    .from('customer_contracts')
    .select('id,company_id,customer_id,site_id,contract_name,contract_type,status,starts_at,ends_at,signed_at,monthly_fee_sek,invoice_fee_sek,start_fee_sek,admin_fee_sek,break_fee_sek,spot_markup_ore_per_kwh,variable_fee_ore_per_kwh,fixed_price_ore_per_kwh,green_fee_mode,green_fee_value,binding_months,notice_months,created_at')
    .eq('company_id', context.companyId)
    .in('customer_id', context.customerIds)
  if (site) query = query.eq('site_id', site.id).eq('customer_id', site.customer_id)

  const { data, error } = await query.order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return (data ?? []) as CustomerPortalContractRow[]
}

function portalCaseTitle(row: { source: string | null; reason_category: string | null; support_case: unknown; title: string | null }): string {
  if (isPortalCompletionCase(row.source, row.reason_category)) return 'Kompletterade uppgifter'
  if (row.support_case === true || row.source?.startsWith('tenant_support_')) return row.title?.trim() || 'Kundärende'
  return 'Kundärende'
}

export async function listPortalCases(
  context: CustomerPortalContext
): Promise<CustomerPortalCaseRow[]> {
  if (context.customerIds.length === 0 || !context.companyId) return []

  const { data, error } = await supabaseService
    .from('customer_cases')
    .select('id,company_id,customer_id,site_id,status,title,source,reason_category,support_case:metadata->support_case,description_visibility:metadata->>description_visibility,created_at,updated_at')
    .eq('company_id', context.companyId)
    .in('customer_id', context.customerIds)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(100)
  if (error) throw error

  const companyId = context.companyId
  const customerIds = new Set(context.customerIds)
  if (data.some(row => row.company_id !== companyId || !customerIds.has(row.customer_id) || !isUuid(row.id))) {
    throw new InvalidReadModelResponseError()
  }
  const seen = [...new Set(data.map(row => row.customer_id))]
  const visible = new Set(await mapWithConcurrency(seen, 4, async id => await customerMayReadPortalRecords(companyId, id) ? id : null))
  const rows = data.filter(row => visible.has(row.customer_id))
  const published = new Map(rows.filter(row => row.description_visibility === 'customer').map(row => [row.id, row.customer_id]))
  const descriptions = new Map<string, string | null>()
  if (published.size) {
    const result = await supabaseService.from('customer_cases').select('id,company_id,customer_id,description')
      .eq('company_id', companyId).in('id', [...published.keys()]).in('customer_id', seen)
      .eq('metadata->>description_visibility', 'customer').limit(published.size)
    if (result.error) throw result.error
    for (const row of result.data) {
      if (row.company_id !== companyId || published.get(row.id) !== row.customer_id) throw new InvalidReadModelResponseError()
      descriptions.set(row.id, row.description)
    }
  }
  return rows.map(row => ({
    id: row.id,
    customer_id: row.customer_id,
    status: publicSupportStatus(row.status),
    title: portalCaseTitle(row),
    description: descriptions.get(row.id) ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))
}

async function readEligiblePortalCustomerIds(companyId: string, customerIds: string[]): Promise<string[]> {
  const allowed = await mapWithConcurrency(customerIds, 4, async id => await customerMayReadPortalRecords(companyId, id) ? id : null)
  return allowed.filter(id => id !== null)
}

const listEligiblePortalCustomerIds = cache(readEligiblePortalCustomerIds)

const OPEN_CUSTOMER_CASE_STATUSES = ['open', 'action_required', 'awaiting_external_response', 'billing_blocked', 'manual_follow_up']

export async function listPortalOpenCases(context: CustomerPortalContext, cursor?: string | string[]) {
  const empty = { cases: [], nextCursor: null, continued: false, count: 0, unavailable: false }
  const companyId = context.companyId
  if (!companyId || context.customerIds.length === 0) return empty

  const customerIds = await listEligiblePortalCustomerIds(companyId, context.customerIds)
  if (!customerIds.length) return empty
  const scope = {
    companyId,
    customerId: createHash('sha256').update([...customerIds].sort().join(',')).digest('hex'),
    resource: 'portal-open-cases',
  }
  let position
  try {
    position = decodePortalCursor({ ...scope, cursor: typeof cursor === 'string' && cursor.length <= 1024 ? cursor : null })
  } catch (error) {
    if (!(error instanceof PortalCursorError)) throw error
    position = null
  }

  const limit = 8
  let query = supabaseService.from('customer_cases')
    .select('id,company_id,customer_id,site_id,status,title,source,reason_category,support_case:metadata->support_case,updated_at', { count: 'exact' })
    .eq('company_id', companyId)
    .in('customer_id', customerIds)
    .in('status', OPEN_CUSTOMER_CASE_STATUSES)
    .order('updated_at', { ascending: false })
    .order('id')
    .limit(limit + 1)
  if (position) {
    const { orderValue: time, id } = position
    query = query.lte('updated_at', time).or(`updated_at.lt.${time},and(updated_at.eq.${time},id.gt.${id})`)
  }
  const { data, count, error } = await query
  if (error) throw error
  if (data.some(row => row.company_id !== companyId || !customerIds.includes(row.customer_id) || !isUuid(row.id)
    || !OPEN_CUSTOMER_CASE_STATUSES.includes(row.status))) throw new InvalidReadModelResponseError()

  const page = buildPortalDatabasePage(data, { ...scope, limit, orderColumn: 'updated_at' })
  const siteIds = [...new Set(page.items.flatMap(row => row.site_id ? [row.site_id] : []))]
  const sites = new Map((await listPortalSites({ ...context, customerIds }, siteIds)).map(site => [site.id, site]))
  if (count !== 0) {
    const stillAllowed = await readEligiblePortalCustomerIds(companyId, customerIds)
    if (stillAllowed.length !== customerIds.length) return { ...empty, count: null, unavailable: true }
  }

  const customers = new Map(context.customers.map(customer => [customer.id, customer]))
  const cases = page.items.map(row => {
    const customer = customers.get(row.customer_id)
    const site = row.site_id ? sites.get(row.site_id) : undefined
    return {
      id: row.id,
      title: portalCaseTitle(row),
      status: publicSupportStatus(row.status),
      updatedAt: row.updated_at,
      customerLabel: customer?.customer_number ? `Kundnummer ${customer.customer_number}` : displayNameFromCustomer(customer) ?? 'Kundkonto',
      siteLabel: site && site.customer_id === row.customer_id
        ? [site.street, site.postal_code, site.city].filter(Boolean).join(', ') || site.site_name || site.facility_id
        : null,
    }
  })
  return { cases, nextCursor: page.page.next_cursor, continued: Boolean(position), count, unavailable: false }
}

export async function listPortalInfoRequests(
  context: CustomerPortalContext,
  input: { cursor?: string | string[]; count?: boolean } = {},
): Promise<{
  requests: (CustomerPortalInfoRequestRow & { customerLabel: string; siteLabel: string | null })[];
  nextCursor: string | null; continued: boolean; count: number | null; unavailable: boolean;
}> {
  const empty = { requests: [], nextCursor: null, continued: false, count: 0, unavailable: false }
  const companyId = context.companyId
  if (!context.customerIds.length || !companyId) return empty
  const customerIds = await listEligiblePortalCustomerIds(companyId, context.customerIds)
  if (!customerIds.length) return empty

  const limit = 8
  const scope = {
    companyId,
    customerId: createHash('sha256').update([...customerIds].sort().join(',')).digest('hex'),
    resource: 'portal-open-info-requests',
  }
  let position
  try {
    position = decodePortalCursor({
      ...scope,
      cursor: typeof input.cursor === 'string' && input.cursor.length <= 1024 ? input.cursor : null,
    })
  } catch (error) {
    if (!(error instanceof PortalCursorError)) throw error
    position = null
  }

  let query = supabaseService
    .from('customer_info_requests')
    .select('id,company_id,customer_id,site_id,metering_point_id,request_type,target_party_type,status,requested_data_categories,notes,created_at,updated_at,automation_origin',
      input.count ? { count: 'exact' } : {})
    .eq('company_id', companyId)
    .in('customer_id', customerIds)
    .not('status', 'in', '(completed,closed,cancelled)')
    .order('updated_at', { ascending: false })
    .order('id')
    .limit(limit + 1)

  if (position) {
    const { orderValue: time, id } = position
    query = query.lte('updated_at', time).or(`updated_at.lt.${time},and(updated_at.eq.${time},id.gt.${id})`)
  }
  const result = await query
  if (result.error) throw result.error

  if (result.data.some(row => row.company_id !== companyId || !customerIds.includes(row.customer_id) || !isUuid(row.id))) throw new InvalidReadModelResponseError()
  const page = buildPortalDatabasePage(result.data, { ...scope, limit, orderColumn: 'updated_at' })
  const siteIds = [...new Set(page.items.flatMap(request => request.site_id ? [request.site_id] : []))]
  const sites = new Map((await listPortalSites({ ...context, customerIds }, siteIds)).map(site => [site.id, site]))
  if (result.data.length || result.count) {
    const stillAllowed = await readEligiblePortalCustomerIds(companyId, customerIds)
    if (stillAllowed.length !== customerIds.length) return { ...empty, count: null, unavailable: true }
  }
  const customers = new Map(context.customers.map(customer => [customer.id, customer]))
  const requests = page.items.map(request => {
    const customer = customers.get(request.customer_id)
    const candidate = request.site_id ? sites.get(request.site_id) : undefined
    const site = candidate?.customer_id === request.customer_id ? candidate : undefined
    return {
      ...request,
      customerLabel: customer?.customer_number ? `Kundnummer ${customer.customer_number}` : (displayNameFromCustomer(customer) ?? 'Kundkonto'),
      siteLabel: site
        ? [site.street, site.postal_code, site.city].filter(Boolean).join(', ') || site.site_name || site.facility_id
        : null,
    }
  })
  return { requests, nextCursor: page.page.next_cursor, continued: Boolean(position), count: result.count, unavailable: false }
}

export async function listPortalCompletions(
  context: CustomerPortalContext
): Promise<CustomerPortalCompletionRow[]> {
  if (context.customerIds.length === 0 || !context.companyId) return []

  const { data, error } = await supabaseService
    .from('customer_portal_completions')
    .select('id,customer_id,completion_type,status,submitted_payload,created_at,updated_at')
    .eq('company_id', context.companyId)
    .in('customer_id', context.customerIds)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    const maybe = error as { code?: string; message?: string }
    if (maybe.code === '42P01' || maybe.code === 'PGRST205' || /schema cache|does not exist/i.test(maybe.message ?? '')) return []
    throw error
  }
  return (data ?? []) as CustomerPortalCompletionRow[]
}

// Creates the ops case for a portal completion and binds it via
// linked_case_id. Used by both the native portal UI and the customer portal
// API (profile-update / move-out) so completions never become dead-end rows.
export async function createPortalCompletionCase(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  completionId: string
  completionType: string
  payload: Record<string, unknown>
  source?: string
}): Promise<string | null> {
  const { data: caseRow, error: caseError } = await supabaseService
    .from('customer_cases')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      site_id: input.siteId ?? null,
      case_type: 'technical_blocker',
      status: 'action_required',
      priority: 'normal',
      title:
        input.completionType === 'move_out'
          ? 'Kund har anmält utflytt via portalen'
          : 'Kund har kompletterat uppgifter i portalen',
      description:
        'Kunden har skickat in uppgifter via kundportalen som inte kunde tillämpas automatiskt. Granska payload och uppdatera kund/anläggning/mätpunkt innan flödet fortsätter.',
      reason_category: 'portal_completion',
      next_action: 'Granska portalkompletteringen och uppdatera rätt masterdatafält.',
      source: input.source ?? 'customer_portal_api',
      metadata: { completionId: input.completionId, completionType: input.completionType, payload: input.payload },
    })
    .select('id')
    .maybeSingle()

  if (caseError) {
    if (missingPortalDataSchema(caseError)) return null
    throw caseError
  }

  const caseId = (caseRow as { id?: string } | null)?.id ?? null
  if (!caseId) return null

  const { error: linkError } = await supabaseService
    .from('customer_portal_completions')
    .update({ linked_case_id: caseId, updated_at: new Date().toISOString() })
    .eq('id', input.completionId)
    .eq('company_id', input.companyId)
  if (linkError && !missingPortalDataSchema(linkError)) throw linkError

  return caseId
}
