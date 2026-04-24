import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import type {
  CustomerInvoiceDocumentRow,
  CustomerInvoiceLineRow,
  CustomerInvoiceRow,
  CustomerPortalContext,
  CustomerPortalCustomerRow,
  CustomerPortalMeteringPointRow,
  CustomerPortalMeteringValueRow,
  CustomerPortalSiteRow,
  CustomerConsumptionMonth,
} from '@/lib/customer-portal/types'

type PortalAccountLookupRow = {
  customer_id: string
  is_active: boolean
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

export async function getCustomerPortalContext(): Promise<CustomerPortalContext> {
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
    }
  }

  const { data: customerRows, error: customerError } = await supabaseService
    .from('customers')
    .select(
      'id,customer_number,customer_type,status,first_name,last_name,full_name,company_name,email,phone'
    )
    .in('id', customerIds)
    .order('created_at', { ascending: false })

  if (customerError) throw customerError

  return {
    userEmail: user.email ?? null,
    customerIds,
    customers: (customerRows ?? []) as CustomerPortalCustomerRow[],
  }
}

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
