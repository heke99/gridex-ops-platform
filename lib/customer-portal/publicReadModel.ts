import { ApiInputError } from '@/lib/api/strictRequest'
import { isMissingPortalSchemaError } from '@/lib/customer-portal/customerResolver'
import {
  descendingKeysetFilter,
  finalizeKeysetPage,
  keysetPageInput,
  type KeysetPage,
} from '@/lib/customer-portal/keysetPagination'
import {
  publicPortalContract,
  publicPortalEvent,
  publicPortalInvoice,
  publicPortalLegalAcceptance,
  publicPortalMeteringPoint,
  publicPortalMeteringValue,
  publicPortalNotification,
  publicPortalPowerOfAttorney,
  publicPortalSite,
} from '@/lib/customer-portal/publicDto'
import { supabaseService } from '@/lib/supabase/service'

type Row = Record<string, unknown>

export type PortalPublicReadContext = {
  companyId: string
  customerId: string
  externalCustomerId?: string | null
  customerNumber?: string | null
}

function schemaNotReady(error: unknown): never {
  if (isMissingPortalSchemaError(error)) {
    throw new ApiInputError(
      'Kundportalens datamodell är inte tillgänglig för den här operationen.',
      'platform_schema_not_ready',
      503,
    )
  }
  throw error
}

function rowsFromUnknown(data: unknown): Row[] {
  if (!Array.isArray(data)) return []
  return data.filter(
    (row): row is Row => Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  )
}

function rowFromUnknown(data: unknown): Row | null {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Row
    : null
}

function recordReadAccess(
  context: PortalPublicReadContext,
  route: string,
  action: string,
  metadata?: Record<string, unknown>,
): void {
  void Promise.resolve(
    supabaseService
      .from('customer_portal_api_access_logs')
      .insert({
        company_id: context.companyId,
        customer_id: context.customerId,
        external_customer_id: context.externalCustomerId ?? null,
        route,
        action,
        metadata: {
          customer_number: context.customerNumber ?? null,
          ...(metadata ?? {}),
        },
      }),
  )
    .then(({ error }) => {
      if (error) {
        console.warn('[customer-portal-access-log] write failed', {
          route,
          code: error.code,
        })
      }
    })
    .catch((error: unknown) => {
      console.warn('[customer-portal-access-log] write failed', { route, error })
    })
}

function queryCursor<T>(query: T, sortColumn: string, cursor: { v: 1; sort: string; id: string } | null): T {
  if (!cursor) return query
  return (query as T & { or: (filter: string) => T }).or(
    descendingKeysetFilter(sortColumn, cursor),
  )
}

const CONTRACT_PUBLIC_SELECT = [
  'id',
  'customer_contract_reference',
  'status',
  'contract_number',
  'contract_name',
  'contract_type',
  'energy_direction',
  'actual_start_date',
  'confirmed_start_date',
  'starts_at',
  'requested_start_date',
  'ends_at',
  'signed_at',
  'withdrawal_deadline_at',
  'offer_reference',
  'signature_snapshot_sha256',
  'price_area_used',
  'monthly_fee_sek',
  'invoice_fee_sek',
  'fixed_price_ore_per_kwh',
  'markup_ore_per_kwh',
  'spot_markup_ore_per_kwh',
  'variable_fee_ore_per_kwh',
  'binding_months',
  'notice_months',
  'auto_renew_enabled',
  'created_at',
].join(',')

export async function readPortalContractsPage(
  context: PortalPublicReadContext,
  searchParams: URLSearchParams,
): Promise<{ items: Row[]; page: KeysetPage }> {
  recordReadAccess(context, '/api/v1/customer/contracts', 'read_contracts')
  const pageInput = keysetPageInput(searchParams)
  let query = supabaseService
    .from('customer_contracts')
    .select(CONTRACT_PUBLIC_SELECT)
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageInput.limit + 1)
  query = queryCursor(query, 'created_at', pageInput.cursor)
  const { data, error } = await query
  if (error) schemaNotReady(error)
  return finalizeKeysetPage({
    rows: rowsFromUnknown(data),
    limit: pageInput.limit,
    sortColumn: 'created_at',
    map: (row) => publicPortalContract(context.companyId, row),
  })
}

const SITE_PUBLIC_SELECT = [
  'id',
  'facility_reference',
  'status',
  'site_name',
  'facility_id',
  'site_type',
  'street',
  'care_of',
  'postal_code',
  'city',
  'country',
  'price_area_code',
  'grid_area_code',
  'move_in_date',
  'move_out_date',
  'annual_consumption_kwh',
  'created_at',
].join(',')

const METERING_POINT_PUBLIC_SELECT = [
  'id',
  'site_id',
  'customer_site_id',
  'metering_point_id',
  'meter_point_id',
  'ediel_metering_point_id',
  'site_facility_id',
  'status',
  'metering_type',
  'measurement_type',
  'reading_frequency',
  'price_area_code',
  'grid_area_code',
  'start_date',
  'end_date',
  'verification_status',
  'created_at',
].join(',')

export async function readPortalSitesPage(
  context: PortalPublicReadContext,
  searchParams: URLSearchParams,
): Promise<{ sites: Row[]; meteringPoints: Row[]; page: KeysetPage }> {
  recordReadAccess(context, '/api/v1/customer/sites', 'read_sites')
  const pageInput = keysetPageInput(searchParams)
  let sitesQuery = supabaseService
    .from('customer_sites')
    .select(SITE_PUBLIC_SELECT)
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageInput.limit + 1)
  sitesQuery = queryCursor(sitesQuery, 'created_at', pageInput.cursor)
  const sitesResult = await sitesQuery
  if (sitesResult.error) schemaNotReady(sitesResult.error)

  const finalized = finalizeKeysetPage({
    rows: rowsFromUnknown(sitesResult.data),
    limit: pageInput.limit,
    sortColumn: 'created_at',
    map: (row) => row,
  })
  const siteRows = finalized.items
  const siteIds = siteRows.map((row) => String(row.id ?? '')).filter(Boolean)

  let meteringPointRows: Row[] = []
  if (siteIds.length > 0) {
    recordReadAccess(context, '/api/v1/customer/sites', 'read_metering_points', {
      site_count: siteIds.length,
    })
    const siteList = siteIds.join(',')
    const meteringResult = await supabaseService
      .from('metering_points')
      .select(METERING_POINT_PUBLIC_SELECT)
      .eq('company_id', context.companyId)
      .eq('customer_id', context.customerId)
      .or(`site_id.in.(${siteList}),customer_site_id.in.(${siteList})`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
    if (meteringResult.error) schemaNotReady(meteringResult.error)
    meteringPointRows = rowsFromUnknown(meteringResult.data)
  }

  return {
    sites: siteRows.map((row) => publicPortalSite(context.companyId, row)),
    meteringPoints: meteringPointRows.map((row) =>
      publicPortalMeteringPoint(context.companyId, row),
    ),
    page: finalized.page,
  }
}

const INVOICE_PUBLIC_SELECT = [
  'id',
  'partner_invoice_reference',
  'invoice_number',
  'period_start',
  'period_end',
  'total_kwh',
  'amount_ex_vat',
  'vat_amount',
  'amount_inc_vat',
  'currency',
  'issued_at',
  'due_date',
  'paid_at',
  'status',
  'created_at',
].join(',')

const PUBLIC_INVOICE_STATUSES = [
  'issued',
  'sent',
  'paid',
  'overdue',
  'cancelled',
  'credited',
]

export async function readPortalInvoicesPage(
  context: PortalPublicReadContext,
  searchParams: URLSearchParams,
): Promise<{ items: Row[]; page: KeysetPage }> {
  recordReadAccess(context, '/api/v1/customer/invoices', 'read_invoices')
  const pageInput = keysetPageInput(searchParams)
  let query = supabaseService
    .from('customer_invoices')
    .select(INVOICE_PUBLIC_SELECT)
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .in('status', PUBLIC_INVOICE_STATUSES)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageInput.limit + 1)
  query = queryCursor(query, 'created_at', pageInput.cursor)
  const { data, error } = await query
  if (error) schemaNotReady(error)
  return finalizeKeysetPage({
    rows: rowsFromUnknown(data),
    limit: pageInput.limit,
    sortColumn: 'created_at',
    map: (row) => publicPortalInvoice(context.companyId, row),
  })
}

export async function readPortalInvoiceByReference(
  context: PortalPublicReadContext,
  invoiceReference: string,
): Promise<{ raw: Row; publicInvoice: Row } | null> {
  recordReadAccess(context, '/api/v1/customer/invoices/[id]', 'read_invoice')

  const base = () => supabaseService
    .from('customer_invoices')
    .select(INVOICE_PUBLIC_SELECT)
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .in('status', PUBLIC_INVOICE_STATUSES)

  let result = await base()
    .eq('partner_invoice_reference', invoiceReference)
    .limit(1)
    .maybeSingle()
  if (result.error) schemaNotReady(result.error)

  if (!result.data) {
    result = await base()
      .eq('invoice_number', invoiceReference)
      .limit(1)
      .maybeSingle()
    if (result.error) schemaNotReady(result.error)
  }

  if (!result.data) return null
  const row = rowFromUnknown(result.data)
  if (!row) throw new Error('portal_invoice_row_invalid')
  return {
    raw: row,
    publicInvoice: publicPortalInvoice(context.companyId, row),
  }
}

const METERING_VALUE_PUBLIC_SELECT = [
  'id',
  'metering_point_id',
  'facility_id',
  'period_start',
  'period_end',
  'resolution',
  'quantity_kwh',
  'quality_status',
  'status',
  'created_at',
].join(',')

export async function readPortalMeteringValuesPage(
  context: PortalPublicReadContext,
  searchParams: URLSearchParams,
  filters: {
    from?: string | null
    to?: string | null
    facilityId?: string | null
  } = {},
): Promise<{ items: Row[]; page: KeysetPage }> {
  recordReadAccess(context, '/api/v1/customer/metering-values', 'read_metering_values', filters)
  const pageInput = keysetPageInput(searchParams)
  let query = supabaseService
    .from('normalized_metering_values')
    .select(METERING_VALUE_PUBLIC_SELECT)
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('period_start', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageInput.limit + 1)
  if (filters.from) query = query.gte('period_start', filters.from)
  if (filters.to) query = query.lte('period_end', filters.to)
  if (filters.facilityId) query = query.eq('facility_id', filters.facilityId)
  query = queryCursor(query, 'period_start', pageInput.cursor)
  const { data, error } = await query
  if (error) schemaNotReady(error)
  return finalizeKeysetPage({
    rows: rowsFromUnknown(data),
    limit: pageInput.limit,
    sortColumn: 'period_start',
    map: (row) => publicPortalMeteringValue(context.companyId, row),
  })
}

export async function readPortalEventsPage(
  context: PortalPublicReadContext,
  searchParams: URLSearchParams,
): Promise<{ items: Row[]; page: KeysetPage }> {
  recordReadAccess(context, '/api/v1/customer/events', 'read_events')
  const pageInput = keysetPageInput(searchParams)
  let query = supabaseService
    .from('customer_events')
    .select('id,event_type,source,occurred_at,created_at')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageInput.limit + 1)
  query = queryCursor(query, 'occurred_at', pageInput.cursor)
  const { data, error } = await query
  if (error) schemaNotReady(error)
  return finalizeKeysetPage({
    rows: rowsFromUnknown(data),
    limit: pageInput.limit,
    sortColumn: 'occurred_at',
    map: (row) => publicPortalEvent(context.companyId, row),
  })
}

export async function readPortalNotificationsPage(
  context: PortalPublicReadContext,
  searchParams: URLSearchParams,
): Promise<{ items: Row[]; page: KeysetPage }> {
  recordReadAccess(context, '/api/v1/customer/notifications', 'read_notifications')
  const pageInput = keysetPageInput(searchParams)
  let query = supabaseService
    .from('customer_notifications')
    .select('id,type,title,message,status,read_at,created_at')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageInput.limit + 1)
  query = queryCursor(query, 'created_at', pageInput.cursor)
  const { data, error } = await query
  if (error) schemaNotReady(error)
  return finalizeKeysetPage({
    rows: rowsFromUnknown(data),
    limit: pageInput.limit,
    sortColumn: 'created_at',
    map: (row) => publicPortalNotification(context.companyId, row),
  })
}

export async function readPortalLegalAcceptancesPage(
  context: PortalPublicReadContext,
  searchParams: URLSearchParams,
): Promise<{ items: Row[]; page: KeysetPage }> {
  recordReadAccess(context, '/api/v1/customer/legal-acceptances', 'read_legal_acceptances')
  const pageInput = keysetPageInput(searchParams)
  let query = supabaseService
    .from('customer_legal_acceptances')
    .select('id,acceptance_type,legal_bundle_version_document_id,legal_module_key,legal_document_version,legal_document_sha256,legal_text_version_id,accepted_at,source,created_at')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('accepted_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageInput.limit + 1)
  query = queryCursor(query, 'accepted_at', pageInput.cursor)
  const { data, error } = await query
  if (error) schemaNotReady(error)
  return finalizeKeysetPage({
    rows: rowsFromUnknown(data),
    limit: pageInput.limit,
    sortColumn: 'accepted_at',
    map: (row) => publicPortalLegalAcceptance(context.companyId, row),
  })
}

export async function readPortalPowersOfAttorneyPage(
  context: PortalPublicReadContext,
  searchParams: URLSearchParams,
): Promise<{ items: Row[]; page: KeysetPage }> {
  recordReadAccess(context, '/api/v1/customer/powers-of-attorney', 'read_powers_of_attorney')
  const pageInput = keysetPageInput(searchParams)
  let query = supabaseService
    .from('powers_of_attorney')
    .select('id,reference,contract_id,customer_site_id,site_id,scope,status,signed_at,accepted_at,valid_from,valid_to,valid_until,created_at')
    .eq('company_id', context.companyId)
    .eq('customer_id', context.customerId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageInput.limit + 1)
  query = queryCursor(query, 'created_at', pageInput.cursor)
  const { data, error } = await query
  if (error) schemaNotReady(error)
  return finalizeKeysetPage({
    rows: rowsFromUnknown(data),
    limit: pageInput.limit,
    sortColumn: 'created_at',
    map: (row) => publicPortalPowerOfAttorney(context.companyId, row),
  })
}
