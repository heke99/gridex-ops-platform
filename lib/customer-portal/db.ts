import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
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
  CustomerPortalCaseRow,
  CustomerPortalCompletionRow,
  CustomerPortalContractRow,
  CustomerPortalInfoRequestRow,
} from '@/lib/customer-portal/types'

type PortalAccountLookupRow = {
  customer_id: string
  is_active: boolean
}

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
// customer portal never shows another company's brand. When the portal account
// spans several companies (rare) we fall back to neutral, brand-agnostic copy
// instead of leaking a specific company name.
async function resolveCustomerPortalBranding(companyIds: string[]): Promise<CustomerPortalBranding> {
  const distinct = Array.from(new Set(companyIds.filter(Boolean)))
  if (distinct.length !== 1) return DEFAULT_PORTAL_BRANDING

  const companyId = distinct[0]
  const { data, error } = await supabaseService
    .from('companies')
    .select('id,name,support_email,primary_contact_email,website,branding')
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
  const supportEmail = brandingString(branding, 'support_email')
    ?? (typeof data.support_email === 'string' && data.support_email.trim() ? data.support_email.trim() : null)
    ?? (typeof data.primary_contact_email === 'string' && data.primary_contact_email.trim() ? data.primary_contact_email.trim() : null)
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
    .select('customer_id,is_active')
    .eq('user_id', user.id)
    .eq('is_active', true)

  if (accountError) throw accountError

  const customerIds = Array.from(
    new Set(
      ((accountRows ?? []) as PortalAccountLookupRow[])
        .map((row) => row.customer_id)
        .filter(Boolean)
    )
  )

  if (customerIds.length === 0) {
    return {
      userEmail: user.email ?? null,
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
    .in('id', customerIds)
    .order('created_at', { ascending: false })

  if (customerError) throw customerError

  const rows = (customerRows ?? []) as Array<CustomerPortalCustomerRow & { company_id?: string | null }>
  const branding = await resolveCustomerPortalBranding(
    rows.map((row) => row.company_id ?? '').filter(Boolean)
  )

  return {
    userEmail: user.email ?? null,
    customerIds,
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
  if (context.customerIds.length === 0) return []

  const { data, error } = await supabaseService
    .from('customer_invoices')
    .select('*')
    .in('customer_id', context.customerIds)
    .order('issued_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as CustomerInvoiceRow[]
}

export async function getPortalInvoiceDetail(
  context: CustomerPortalContext,
  invoiceId: string
): Promise<{
  invoice: CustomerInvoiceRow | null
  lines: CustomerInvoiceLineRow[]
  documents: CustomerInvoiceDocumentRow[]
}> {
  if (context.customerIds.length === 0) {
    return { invoice: null, lines: [], documents: [] }
  }

  const { data: invoice, error: invoiceError } = await supabaseService
    .from('customer_invoices')
    .select('*')
    .eq('id', invoiceId)
    .in('customer_id', context.customerIds)
    .maybeSingle()

  if (invoiceError) throw invoiceError
  if (!invoice) return { invoice: null, lines: [], documents: [] }

  const [linesResult, documentsResult] = await Promise.all([
    supabaseService
      .from('customer_invoice_lines')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabaseService
      .from('customer_invoice_documents')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false }),
  ])

  if (linesResult.error) throw linesResult.error
  if (documentsResult.error) throw documentsResult.error

  return {
    invoice: invoice as CustomerInvoiceRow,
    lines: (linesResult.data ?? []) as CustomerInvoiceLineRow[],
    documents: (documentsResult.data ?? []) as CustomerInvoiceDocumentRow[],
  }
}

export async function listPortalSites(
  context: CustomerPortalContext
): Promise<CustomerPortalSiteRow[]> {
  if (context.customerIds.length === 0) return []

  const { data, error } = await supabaseService
    .from('customer_sites')
    .select(
      'id,customer_id,site_name,facility_id,street,postal_code,city,grid_owner_id,price_area_code,status,annual_consumption_kwh'
    )
    .in('customer_id', context.customerIds)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as CustomerPortalSiteRow[]
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
  } = {}
): Promise<CustomerPortalMeteringValueRow[]> {
  if (context.customerIds.length === 0) return []

  const { data, error } = await supabaseService
    .from('metering_values')
    .select(
      'id,customer_id,site_id,metering_point_id,source_request_id,grid_owner_id,reading_type,value_kwh,quality_code,read_at,period_start,period_end,source_system,created_at'
    )
    .in('customer_id', context.customerIds)
    .order('period_start', { ascending: false, nullsFirst: false })
    .order('read_at', { ascending: false })
    .limit(options.limit ?? 250)

  if (error) throw error
  return (data ?? []) as CustomerPortalMeteringValueRow[]
}

export function summarizeConsumptionByMonth(
  values: CustomerPortalMeteringValueRow[]
): CustomerConsumptionMonth[] {
  const grouped = new Map<string, CustomerConsumptionMonth>()

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

export async function getPortalDashboardData() {
  const context = await getCustomerPortalContext()

  const [invoices, sites, meteringValues] = await Promise.all([
    listPortalInvoices(context),
    listPortalSites(context),
    listPortalMeteringValues(context, { limit: 250 }),
  ])

  const siteIds = sites.map((site) => site.id)
  const meteringPoints = await listPortalMeteringPoints(siteIds)

  return {
    context,
    invoices,
    sites,
    meteringPoints,
    meteringValues,
    consumptionMonths: summarizeConsumptionByMonth(meteringValues),
  }
}

export async function listPortalContracts(
  context: CustomerPortalContext
): Promise<CustomerPortalContractRow[]> {
  if (context.customerIds.length === 0) return []

  const { data, error } = await supabaseService
    .from('customer_contracts')
    .select('id,company_id,customer_id,site_id,contract_name,contract_type,status,starts_at,ends_at,signed_at,monthly_fee_sek,spot_markup_ore_per_kwh,variable_fee_ore_per_kwh,fixed_price_ore_per_kwh,green_fee_mode,green_fee_value,binding_months,notice_months,created_at')
    .in('customer_id', context.customerIds)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as CustomerPortalContractRow[]
}

export async function listPortalCases(
  context: CustomerPortalContext
): Promise<CustomerPortalCaseRow[]> {
  if (context.customerIds.length === 0) return []

  const { data, error } = await supabaseService
    .from('customer_cases')
    .select('id,customer_id,site_id,metering_point_id,case_type,status,priority,title,description,reason_category,next_action,created_at,updated_at')
    .in('customer_id', context.customerIds)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as CustomerPortalCaseRow[]
}

export async function listPortalInfoRequests(
  context: CustomerPortalContext
): Promise<CustomerPortalInfoRequestRow[]> {
  if (context.customerIds.length === 0) return []

  const { data, error } = await supabaseService
    .from('customer_info_requests')
    .select('id,customer_id,site_id,metering_point_id,request_type,target_party_type,status,requested_data_categories,notes,created_at,updated_at')
    .in('customer_id', context.customerIds)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as CustomerPortalInfoRequestRow[]
}

export async function listPortalCompletions(
  context: CustomerPortalContext
): Promise<CustomerPortalCompletionRow[]> {
  if (context.customerIds.length === 0) return []

  const { data, error } = await supabaseService
    .from('customer_portal_completions')
    .select('id,customer_id,completion_type,status,submitted_payload,created_at,updated_at')
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

export async function submitPortalCompletion(input: {
  context: CustomerPortalContext
  customerId: string
  completionType: string
  payload: Record<string, unknown>
  userId: string
}): Promise<string> {
  assertPortalAccessToCustomer(input.context, input.customerId)

  const { data: customer, error: customerError } = await supabaseService
    .from('customers')
    .select('id,company_id')
    .eq('id', input.customerId)
    .maybeSingle()

  if (customerError) throw customerError
  const companyId = (customer as { company_id?: string | null } | null)?.company_id
  if (!companyId) throw new Error('Kundens bolagskoppling saknas.')

  const { data: completion, error } = await supabaseService
    .from('customer_portal_completions')
    .insert({
      company_id: companyId,
      customer_id: input.customerId,
      completion_type: input.completionType,
      status: 'submitted',
      submitted_payload: input.payload,
      created_by_user_id: input.userId,
    })
    .select('id')
    .single()

  if (error) throw error

  await supabaseService.from('customer_cases').insert({
    company_id: companyId,
    customer_id: input.customerId,
    case_type: 'technical_blocker',
    status: 'action_required',
    priority: 'normal',
    title: 'Kund har kompletterat uppgifter i portalen',
    description: 'Kunden har skickat in kompletterande uppgifter. Granska payload och uppdatera kund/anläggning/mätpunkt innan flödet fortsätter.',
    reason_category: 'portal_completion',
    next_action: 'Granska portalkompletteringen och uppdatera rätt masterdatafält.',
    source: 'customer_portal',
    metadata: { completionId: (completion as { id: string }).id, payload: input.payload },
  })

  return (completion as { id: string }).id
}
