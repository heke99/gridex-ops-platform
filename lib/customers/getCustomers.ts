import { supabaseService } from '@/lib/supabase/service'
import type { LatestContractBucketFilter } from '@/lib/customer-contracts/db'
import { isMissingRelationError } from '@/lib/tenant/scope'

export type CustomerListRow = {
  id: string
  customer_type: string | null
  status: string | null
  possible_duplicate?: boolean | null
  duplicate_review_status?: string | null
  consolidated_invoice?: boolean | null
  billing_level?: string | null
  intake_status?: string | null
  intake_missing_fields?: unknown
  has_missing_grid_owner?: boolean
  has_signed_power_of_attorney?: boolean
  first_name: string | null
  last_name: string | null
  full_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  personal_number: string | null
  org_number: string | null
  customer_number: string | null
  apartment_number: string | null
  created_at: string
  site_count: number
  active_site_count: number
  metering_point_count: number
  active_metering_point_count: number
  contract_count: number
  source: string | null
  is_test_data?: boolean | null
}

type RawCustomerRow = Record<string, unknown> & { id?: string }

const HIDDEN_CUSTOMER_STATUSES = ['archived', 'deleted', 'deleted_test_only', 'pending_deletion']
const STATUS_COUNT_KEYS: Exclude<CustomerStatusFilter, 'all'>[] = [
  'draft',
  'pending_verification',
  'active',
  'inactive',
  'moved',
  'terminated',
  'blocked',
  'cancelled',
  'rejected',
  'archived',
]
const CUSTOMER_LIST_SELECT = [
  'id',
  'customer_type',
  'status',
  'possible_duplicate',
  'duplicate_review_status',
  'consolidated_invoice',
  'billing_level',
  'intake_status',
  'intake_missing_fields',
  'first_name',
  'last_name',
  'full_name',
  'company_name',
  'email',
  'phone',
  'personal_number',
  'org_number',
  'customer_number',
  'apartment_number',
  'source',
  'is_test_data',
  'created_at',
  'company_id',
].join(',')

type CustomerSiteCountRow = {
  id: string
  customer_id: string | null
  status: string | null
  grid_owner_id?: string | null
}

type MeteringPointCountRow = {
  id: string
  site_id: string | null
  status: string | null
}

export type CustomerTypeFilter = 'all' | 'private' | 'business' | 'association'

export type CustomerFlagFilter =
  | 'all'
  | 'possible_duplicate'
  | 'multi_site'
  | 'multi_contract'
  | 'consolidated_invoice'
  | 'missing_authorization'
  | 'missing_grid_owner'
  | 'ready_for_switch'
  | 'billing_ready'
  | 'test_customers'
  | 'archived'
  | 'cancelled'
  | 'rejected'

type GetCustomersOptions = {
  query?: string | null
  companyId?: string | null
  customerType?: CustomerTypeFilter
  flag?: CustomerFlagFilter
}

type CustomerQueryResult = {
  data?: unknown[] | null
  error: unknown
  count?: number | null
}

type CustomerQuery = PromiseLike<CustomerQueryResult> & {
  eq: (column: string, value: string) => CustomerQuery
  not: (column: string, operator: string, value: unknown) => CustomerQuery
  or: (filters: string) => CustomerQuery
  order: (column: string, options?: { ascending?: boolean }) => CustomerQuery
  range: (from: number, to: number) => CustomerQuery
}

export type CustomerStatusFilter =
  | 'all'
  | 'draft'
  | 'pending_verification'
  | 'active'
  | 'inactive'
  | 'moved'
  | 'terminated'
  | 'blocked'
  | 'cancelled'
  | 'rejected'
  | 'archived'

export type CustomerStatusCounts = {
  all: number
  draft: number
  pending_verification: number
  active: number
  inactive: number
  moved: number
  terminated: number
  blocked: number
  cancelled: number
  rejected: number
  archived: number
}

export type CustomerListPageResult = {
  rows: CustomerListRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  counts: CustomerStatusCounts
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function booleanOrFalse(value: unknown): boolean {
  return value === true
}

function normalizeCustomerRow(row: RawCustomerRow): CustomerListRow {
  const firstName = stringOrNull(row.first_name)
  const lastName = stringOrNull(row.last_name)
  const fallbackFullName = [firstName, lastName].filter(Boolean).join(' ').trim()
  const fullName = stringOrNull(row.full_name) ?? (fallbackFullName.length > 0 ? fallbackFullName : null)

  return {
    id: String(row.id),
    customer_type: stringOrNull(row.customer_type) ?? 'private',
    status: stringOrNull(row.status) ?? 'draft',
    possible_duplicate: booleanOrFalse(row.possible_duplicate),
    duplicate_review_status: stringOrNull(row.duplicate_review_status),
    consolidated_invoice: booleanOrFalse(row.consolidated_invoice),
    billing_level: stringOrNull(row.billing_level),
    intake_status: stringOrNull(row.intake_status),
    intake_missing_fields: row.intake_missing_fields ?? null,
    has_missing_grid_owner: false,
    has_signed_power_of_attorney: false,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    company_name: stringOrNull(row.company_name),
    email: stringOrNull(row.email),
    phone: stringOrNull(row.phone),
    personal_number: stringOrNull(row.personal_number),
    org_number: stringOrNull(row.org_number),
    customer_number: stringOrNull(row.customer_number),
    apartment_number: stringOrNull(row.apartment_number),
    source: stringOrNull(row.source),
    is_test_data: booleanOrFalse(row.is_test_data),
    created_at: stringOrNull(row.created_at) ?? new Date(0).toISOString(),
    site_count: 0,
    active_site_count: 0,
    metering_point_count: 0,
    active_metering_point_count: 0,
    contract_count: 0,
  }
}

function matchesText(row: CustomerListRow, query: string): boolean {
  if (!query) return true
  const normalized = query.toLowerCase()
  return [
    row.full_name,
    row.company_name,
    row.email,
    row.phone,
    row.personal_number,
    row.org_number,
    row.customer_number,
    row.first_name,
    row.last_name,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized))
}

function matchesCustomerType(row: CustomerListRow, customerType: CustomerTypeFilter): boolean {
  if (customerType === 'all') return true
  if (customerType === 'private') return row.customer_type === 'private' || !row.customer_type
  return row.customer_type === customerType
}

function matchesStatus(row: CustomerListRow, status: CustomerStatusFilter): boolean {
  return status === 'all' || row.status === status
}

function matchesContract(row: CustomerListRow, filter: LatestContractBucketFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'none') return row.contract_count === 0
  return row.contract_count > 0
}

function matchesFlag(row: CustomerListRow, flag: CustomerFlagFilter): boolean {
  if (flag === 'all') return true
  if (flag === 'possible_duplicate') return Boolean(row.possible_duplicate)
  if (flag === 'multi_site') return row.site_count > 1
  if (flag === 'multi_contract') return row.contract_count > 1
  if (flag === 'consolidated_invoice') return Boolean(row.consolidated_invoice)
  if (flag === 'missing_grid_owner') return Boolean(row.has_missing_grid_owner)
  if (flag === 'missing_authorization') return !row.has_signed_power_of_attorney
  if (flag === 'ready_for_switch') {
    return row.site_count > 0 && row.metering_point_count > 0 && Boolean(row.has_signed_power_of_attorney) && !row.has_missing_grid_owner
  }
  if (flag === 'billing_ready') {
    return row.site_count > 0 && row.metering_point_count > 0 && row.contract_count > 0 && !row.has_missing_grid_owner
  }
  if (flag === 'test_customers') return row.is_test_data === true || String(row.source ?? '').toLowerCase().includes('test')
  if (flag === 'archived') return row.status === 'archived'
  if (flag === 'cancelled') return row.status === 'cancelled'
  if (flag === 'rejected') return row.status === 'rejected'
  return true
}

function canUsePagedCustomerQuery(params: {
  query: string
  contractFilter: LatestContractBucketFilter
  flag: CustomerFlagFilter
}): boolean {
  return params.query.length === 0 && params.contractFilter === 'all' && params.flag === 'all'
}

function applyBaseCustomerFilters(query: CustomerQuery, companyId: string | null, includeHidden = false): CustomerQuery {
  let scopedQuery = query
    .not('company_id', 'is', null)
    .or('source.is.null,source.neq.ediel_portal_test')

  if (!includeHidden) {
    scopedQuery = scopedQuery.or(`status.is.null,status.not.in.(${HIDDEN_CUSTOMER_STATUSES.join(',')})`)
  }

  if (companyId) scopedQuery = scopedQuery.eq('company_id', companyId)

  return scopedQuery
}


function applyCustomerTypeQueryFilter(
  query: CustomerQuery,
  customerType: CustomerTypeFilter
): CustomerQuery {
  if (customerType === 'all') return query
  if (customerType === 'private') return query.or('customer_type.is.null,customer_type.eq.private')
  return query.eq('customer_type', customerType)
}

function applyStatusQueryFilter(
  query: CustomerQuery,
  status: CustomerStatusFilter
): CustomerQuery {
  return status === 'all' ? query : query.eq('status', status)
}

async function countCustomersByStatus(params: {
  companyId: string | null
  customerType: CustomerTypeFilter
}): Promise<CustomerStatusCounts> {
  const countForStatus = async (status: CustomerStatusFilter) => {
    const query = applyStatusQueryFilter(
      applyCustomerTypeQueryFilter(
        applyBaseCustomerFilters(
          supabaseService.from('customers').select('id', { count: 'exact', head: true }) as unknown as CustomerQuery,
          params.companyId,
          status === 'archived'
        ),
        params.customerType
      ),
      status
    )

    const { count, error } = await query
    if (error) throw error
    return count ?? 0
  }

  const [all, ...statusCounts] = await Promise.all([
    countForStatus('all'),
    ...STATUS_COUNT_KEYS.map((status) => countForStatus(status)),
  ])

  return {
    all,
    draft: statusCounts[0] ?? 0,
    pending_verification: statusCounts[1] ?? 0,
    active: statusCounts[2] ?? 0,
    inactive: statusCounts[3] ?? 0,
    moved: statusCounts[4] ?? 0,
    terminated: statusCounts[5] ?? 0,
    blocked: statusCounts[6] ?? 0,
    cancelled: statusCounts[7] ?? 0,
    rejected: statusCounts[8] ?? 0,
    archived: statusCounts[9] ?? 0,
  }
}

async function loadPagedCustomerRows(params: {
  page: number
  pageSize: number
  status: CustomerStatusFilter
  companyId: string | null
  customerType: CustomerTypeFilter
}): Promise<{ rows: CustomerListRow[]; total: number; counts: CustomerStatusCounts }> {
  const from = (params.page - 1) * params.pageSize
  const to = from + params.pageSize - 1

  const query = applyStatusQueryFilter(
    applyCustomerTypeQueryFilter(
      applyBaseCustomerFilters(
        supabaseService.from('customers').select(CUSTOMER_LIST_SELECT, { count: 'exact' }) as unknown as CustomerQuery,
        params.companyId,
        params.status === 'archived'
      ),
      params.customerType
    ),
    params.status
  )
    .order('created_at', { ascending: false })
    .range(from, to)

  const [{ data, error, count }, counts] = await Promise.all([
    query,
    countCustomersByStatus({
      companyId: params.companyId,
      customerType: params.customerType,
    }),
  ])

  if (error) throw error

  const rows = ((data ?? []) as unknown as RawCustomerRow[])
    .filter((row) => typeof row.id === 'string')
    .map(normalizeCustomerRow)

  return {
    rows: await hydrateDerivedCustomerData(rows, params.companyId),
    total: count ?? rows.length,
    counts,
  }
}

async function loadCustomerRows(
  companyId: string | null,
  status: CustomerStatusFilter,
  includeHidden = false
): Promise<CustomerListRow[]> {
  try {
    let query = supabaseService
      .from('customers')
      .select(CUSTOMER_LIST_SELECT)
      .not('company_id', 'is', null)
      .or('source.is.null,source.neq.ediel_portal_test')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (companyId) query = query.eq('company_id', companyId)
    if (!includeHidden) query = query.or(`status.is.null,status.not.in.(${HIDDEN_CUSTOMER_STATUSES.join(',')})`)

    const { data, error } = await query
    if (error) throw error

    return ((data ?? []) as unknown as RawCustomerRow[])
      .filter((row) => typeof row.id === 'string')
      .map(normalizeCustomerRow)
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

async function hydrateDerivedCustomerData(rows: CustomerListRow[], companyId: string | null): Promise<CustomerListRow[]> {
  if (rows.length === 0) return rows

  const customerIds = rows.map((row) => row.id)
  const byCustomerId = new Map(rows.map((row) => [row.id, row]))

  try {
    let siteQuery = supabaseService
      .from('customer_sites')
      .select('id, customer_id, status, grid_owner_id')
      .in('customer_id', customerIds)

    if (companyId) siteQuery = siteQuery.eq('company_id', companyId)

    const { data, error } = await siteQuery
    if (error) throw error

    const sites = (data ?? []) as CustomerSiteCountRow[]
    const customerIdBySiteId = new Map<string, string>()
    const siteIds: string[] = []

    for (const site of sites) {
      if (!site.id || !site.customer_id) continue
      const customer = byCustomerId.get(site.customer_id)
      if (!customer) continue
      siteIds.push(site.id)
      customerIdBySiteId.set(site.id, site.customer_id)
      customer.site_count += 1
      if (site.status === 'active') customer.active_site_count += 1
      if (!site.grid_owner_id) customer.has_missing_grid_owner = true
    }

    if (siteIds.length > 0) {
      const { data: pointRows, error: pointError } = await supabaseService
        .from('metering_points')
        .select('id, site_id, status')
        .in('site_id', siteIds)

      if (pointError) throw pointError

      for (const point of (pointRows ?? []) as MeteringPointCountRow[]) {
        if (!point.site_id) continue
        const customerId = customerIdBySiteId.get(point.site_id)
        if (!customerId) continue
        const customer = byCustomerId.get(customerId)
        if (!customer) continue
        customer.metering_point_count += 1
        if (point.status === 'active') customer.active_metering_point_count += 1
      }
    }
  } catch (error) {
    if (!isMissingRelationError(error)) throw error
  }

  try {
    const { data, error } = await supabaseService
      .from('customer_contracts')
      .select('id, customer_id')
      .in('customer_id', customerIds)

    if (error) throw error

    for (const contract of (data ?? []) as Array<{ customer_id: string | null }>) {
      if (!contract.customer_id) continue
      const customer = byCustomerId.get(contract.customer_id)
      if (!customer) continue
      customer.contract_count += 1
    }
  } catch (error) {
    if (!isMissingRelationError(error)) throw error
  }

  try {
    const { data, error } = await supabaseService
      .from('powers_of_attorney')
      .select('id, customer_id, status')
      .in('customer_id', customerIds)

    if (error) throw error

    for (const poa of (data ?? []) as Array<{ customer_id: string | null; status: string | null }>) {
      if (!poa.customer_id || poa.status !== 'signed') continue
      const customer = byCustomerId.get(poa.customer_id)
      if (customer) customer.has_signed_power_of_attorney = true
    }
  } catch (error) {
    if (!isMissingRelationError(error)) throw error
  }

  return Array.from(byCustomerId.values())
}

function emptyCounts(): CustomerStatusCounts {
  return {
    all: 0,
    draft: 0,
    pending_verification: 0,
    active: 0,
    inactive: 0,
    moved: 0,
    terminated: 0,
    blocked: 0,
    cancelled: 0,
    rejected: 0,
    archived: 0,
  }
}

function buildCounts(rows: CustomerListRow[]): CustomerStatusCounts {
  const counts = emptyCounts()
  counts.all = rows.length
  for (const row of rows) {
    if (row.status === 'draft') counts.draft += 1
    if (row.status === 'pending_verification') counts.pending_verification += 1
    if (row.status === 'active') counts.active += 1
    if (row.status === 'inactive') counts.inactive += 1
    if (row.status === 'moved') counts.moved += 1
    if (row.status === 'terminated') counts.terminated += 1
    if (row.status === 'blocked') counts.blocked += 1
    if (row.status === 'cancelled') counts.cancelled += 1
    if (row.status === 'rejected') counts.rejected += 1
    if (row.status === 'archived') counts.archived += 1
  }
  return counts
}

export async function listCustomersPage(options: {
  query?: string | null
  page?: number
  pageSize?: number
  status?: CustomerStatusFilter
  contractFilter?: LatestContractBucketFilter
  companyId?: string | null
  customerType?: CustomerTypeFilter
  flag?: CustomerFlagFilter
} = {}): Promise<CustomerListPageResult> {
  const query = (options.query ?? '').trim()
  const page = Math.max(options.page ?? 1, 1)
  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), 100)
  const status = options.status ?? 'all'
  const contractFilter = options.contractFilter ?? 'all'
  const customerType = options.customerType ?? 'all'
  const flag = options.flag ?? 'all'
  const companyId = options.companyId ?? null

  if (canUsePagedCustomerQuery({ query, contractFilter, flag })) {
    const pagedRows = await loadPagedCustomerRows({
      page,
      pageSize,
      status,
      companyId,
      customerType,
    })
    const totalPages = Math.max(1, Math.ceil(pagedRows.total / pageSize))

    return {
      rows: pagedRows.rows,
      total: pagedRows.total,
      page,
      pageSize,
      totalPages,
      counts: pagedRows.counts,
    }
  }

  const includeHiddenRows = status === 'archived' || flag === 'archived'
  const allRows = await hydrateDerivedCustomerData(await loadCustomerRows(companyId, status, includeHiddenRows), companyId)
  const searchedRows = allRows.filter((row) => matchesText(row, query))
  const counts = buildCounts(searchedRows.filter((row) => matchesCustomerType(row, customerType) && matchesFlag(row, flag)))
  const filteredRows = searchedRows.filter(
    (row) =>
      matchesStatus(row, status) &&
      matchesCustomerType(row, customerType) &&
      matchesContract(row, contractFilter) &&
      matchesFlag(row, flag)
  )

  const total = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = (page - 1) * pageSize

  return {
    rows: filteredRows.slice(from, from + pageSize),
    total,
    page,
    pageSize,
    totalPages,
    counts,
  }
}

export async function getCustomers(options: GetCustomersOptions = {}): Promise<CustomerListRow[]> {
  const result = await listCustomersPage({
    query: options.query,
    page: 1,
    pageSize: 100,
    status: 'all',
    contractFilter: 'all',
    companyId: options.companyId ?? null,
    customerType: options.customerType ?? 'all',
    flag: options.flag ?? 'all',
  })

  return result.rows
}
