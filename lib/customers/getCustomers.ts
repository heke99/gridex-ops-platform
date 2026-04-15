import { supabaseService } from '@/lib/supabase/service'
import {
  listCustomerIdsByLatestContractBucket,
  type LatestContractBucketFilter,
} from '@/lib/customer-contracts/db'

export type CustomerListRow = {
  id: string
  customer_type: string | null
  status: string | null
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
}

type CustomerBaseRow = {
  id: string
  customer_type: string | null
  status: string | null
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
}

type CustomerSiteSearchRow = {
  id: string
  customer_id: string | null
  site_name: string | null
  facility_id: string | null
  street: string | null
  postal_code: string | null
  city: string | null
}

type CustomerSiteCountRow = {
  id: string
  customer_id: string
  status: string | null
}

type MeteringPointSearchRow = {
  id: string
  site_id: string | null
  meter_point_id: string | null
}

type MeteringPointCountRow = {
  id: string
  site_id: string
  status: string | null
}

type GetCustomersOptions = {
  query?: string | null
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

export type CustomerStatusCounts = {
  all: number
  draft: number
  pending_verification: number
  active: number
  inactive: number
  moved: number
  terminated: number
  blocked: number
}

export type CustomerListPageResult = {
  rows: CustomerListRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  counts: CustomerStatusCounts
}

type SearchContext = {
  query: string
  relatedCustomerIds: string[]
}

function sanitizeSearchTerm(value: string): string {
  return value.replace(/[%_,]/g, ' ').trim()
}

async function resolveRelatedCustomerIds(query: string): Promise<string[]> {
  if (!query) return []

  const { data: matchingSites, error: siteSearchError } = await supabaseService
    .from('customer_sites')
    .select('id, customer_id, site_name, facility_id, street, postal_code, city')
    .or(
      [
        `site_name.ilike.%${query}%`,
        `facility_id.ilike.%${query}%`,
        `street.ilike.%${query}%`,
        `postal_code.ilike.%${query}%`,
        `city.ilike.%${query}%`,
      ].join(',')
    )
    .limit(250)

  if (siteSearchError) throw siteSearchError

  const typedMatchingSites = (matchingSites ?? []) as CustomerSiteSearchRow[]

  const directCustomerIds = typedMatchingSites
    .map((row) => row.customer_id)
    .filter((value): value is string => Boolean(value))

  const { data: matchingPoints, error: pointSearchError } = await supabaseService
    .from('metering_points')
    .select('id, site_id, meter_point_id')
    .or(`meter_point_id.ilike.%${query}%`)
    .limit(250)

  if (pointSearchError) throw pointSearchError

  const typedMatchingPoints = (matchingPoints ?? []) as MeteringPointSearchRow[]
  const siteIds = new Set<string>()

  for (const site of typedMatchingSites) {
    if (site.id) siteIds.add(String(site.id))
  }

  for (const point of typedMatchingPoints) {
    if (point.site_id) siteIds.add(String(point.site_id))
  }

  if (siteIds.size === 0) {
    return Array.from(new Set(directCustomerIds))
  }

  const { data: relatedSites, error: relatedSitesError } = await supabaseService
    .from('customer_sites')
    .select('id, customer_id')
    .in('id', Array.from(siteIds))

  if (relatedSitesError) throw relatedSitesError

  const typedRelatedSites = (relatedSites ?? []) as Array<{
    id: string
    customer_id: string | null
  }>

  const meteringLinkedCustomerIds = typedRelatedSites
    .map((row) => row.customer_id)
    .filter((value): value is string => Boolean(value))

  return Array.from(new Set([...directCustomerIds, ...meteringLinkedCustomerIds]))
}

function buildCustomerOrFilter(context: SearchContext): string | null {
  if (!context.query) return null

  const parts = [
    `full_name.ilike.%${context.query}%`,
    `company_name.ilike.%${context.query}%`,
    `email.ilike.%${context.query}%`,
    `phone.ilike.%${context.query}%`,
    `personal_number.ilike.%${context.query}%`,
    `org_number.ilike.%${context.query}%`,
    `customer_number.ilike.%${context.query}%`,
    `first_name.ilike.%${context.query}%`,
    `last_name.ilike.%${context.query}%`,
  ]

  if (context.relatedCustomerIds.length > 0) {
    parts.push(`id.in.(${context.relatedCustomerIds.join(',')})`)
  }

  return parts.join(',')
}

async function buildCustomerRows(customerRows: CustomerBaseRow[]): Promise<CustomerListRow[]> {
  const customerIds = customerRows.map((row) => row.id)

  if (customerIds.length === 0) {
    return []
  }

  const { data: siteRows, error: siteError } = await supabaseService
    .from('customer_sites')
    .select('id, customer_id, status')
    .in('customer_id', customerIds)

  if (siteError) throw siteError

  const typedSites = (siteRows ?? []) as CustomerSiteCountRow[]
  const siteIds = typedSites.map((row) => row.id)

  const { data: pointRows, error: pointError } =
    siteIds.length > 0
      ? await supabaseService
          .from('metering_points')
          .select('id, site_id, status')
          .in('site_id', siteIds)
      : { data: [], error: null }

  if (pointError) throw pointError

  const typedPoints = (pointRows ?? []) as MeteringPointCountRow[]

  const siteCountByCustomer = new Map<string, number>()
  const activeSiteCountByCustomer = new Map<string, number>()
  const customerIdBySiteId = new Map<string, string>()
  const meteringPointCountByCustomer = new Map<string, number>()
  const activeMeteringPointCountByCustomer = new Map<string, number>()

  for (const site of typedSites) {
    customerIdBySiteId.set(site.id, site.customer_id)

    siteCountByCustomer.set(
      site.customer_id,
      (siteCountByCustomer.get(site.customer_id) ?? 0) + 1
    )

    if (site.status === 'active') {
      activeSiteCountByCustomer.set(
        site.customer_id,
        (activeSiteCountByCustomer.get(site.customer_id) ?? 0) + 1
      )
    }
  }

  for (const point of typedPoints) {
    const customerId = customerIdBySiteId.get(point.site_id)
    if (!customerId) continue

    meteringPointCountByCustomer.set(
      customerId,
      (meteringPointCountByCustomer.get(customerId) ?? 0) + 1
    )

    if (point.status === 'active') {
      activeMeteringPointCountByCustomer.set(
        customerId,
        (activeMeteringPointCountByCustomer.get(customerId) ?? 0) + 1
      )
    }
  }

  return customerRows.map((customer) => ({
    ...customer,
    site_count: siteCountByCustomer.get(customer.id) ?? 0,
    active_site_count: activeSiteCountByCustomer.get(customer.id) ?? 0,
    metering_point_count: meteringPointCountByCustomer.get(customer.id) ?? 0,
    active_metering_point_count:
      activeMeteringPointCountByCustomer.get(customer.id) ?? 0,
  }))
}

async function countCustomersByStatus(
  context: SearchContext,
  status?: Exclude<CustomerStatusFilter, 'all'>
): Promise<number> {
  let query = supabaseService
    .from('customers')
    .select('id', { count: 'exact', head: true })

  const orFilter = buildCustomerOrFilter(context)
  if (orFilter) {
    query = query.or(orFilter)
  }

  if (status) {
    query = query.eq('status', status)
  }

  const { count, error } = await query
  if (error) throw error

  return count ?? 0
}

export async function listCustomersPage(options: {
  query?: string | null
  page?: number
  pageSize?: number
  status?: CustomerStatusFilter
  contractFilter?: LatestContractBucketFilter
} = {}): Promise<CustomerListPageResult> {
  const query = sanitizeSearchTerm(options.query ?? '')
  const page = Math.max(options.page ?? 1, 1)
  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), 100)
  const status = options.status ?? 'all'
  const contractFilter = options.contractFilter ?? 'all'

  const relatedCustomerIds = await resolveRelatedCustomerIds(query)
  const context: SearchContext = {
    query,
    relatedCustomerIds,
  }

  let customerRows: CustomerBaseRow[] = []
  let total = 0

  if (contractFilter !== 'all') {
    const contractFiltered = await listCustomerIdsByLatestContractBucket({
      query,
      customerStatus: status === 'all' ? null : status,
      bucket: contractFilter,
      page,
      pageSize,
    })

    total = contractFiltered.total

    if (contractFiltered.customerIds.length > 0) {
      const { data, error } = await supabaseService
        .from('customers')
        .select(
          'id, customer_type, status, first_name, last_name, full_name, company_name, email, phone, personal_number, org_number, customer_number, apartment_number, created_at'
        )
        .in('id', contractFiltered.customerIds)

      if (error) throw error

      const rows = (data ?? []) as CustomerBaseRow[]
      const rank = new Map(
        contractFiltered.customerIds.map((id, index) => [id, index])
      )

      customerRows = rows.sort(
        (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)
      )
    }
  } else {
    let rowsQuery = supabaseService
      .from('customers')
      .select(
        'id, customer_type, status, first_name, last_name, full_name, company_name, email, phone, personal_number, org_number, customer_number, apartment_number, created_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })

    const orFilter = buildCustomerOrFilter(context)
    if (orFilter) {
      rowsQuery = rowsQuery.or(orFilter)
    }

    if (status !== 'all') {
      rowsQuery = rowsQuery.eq('status', status)
    }

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const { data, error, count } = await rowsQuery.range(from, to)
    if (error) throw error

    customerRows = (data ?? []) as CustomerBaseRow[]
    total = count ?? 0
  }

  const rows = await buildCustomerRows(customerRows)

  const counts: CustomerStatusCounts = {
    all: await countCustomersByStatus(context),
    draft: await countCustomersByStatus(context, 'draft'),
    pending_verification: await countCustomersByStatus(context, 'pending_verification'),
    active: await countCustomersByStatus(context, 'active'),
    inactive: await countCustomersByStatus(context, 'inactive'),
    moved: await countCustomersByStatus(context, 'moved'),
    terminated: await countCustomersByStatus(context, 'terminated'),
    blocked: await countCustomersByStatus(context, 'blocked'),
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return {
    rows,
    total,
    page,
    pageSize,
    totalPages,
    counts,
  }
}

export async function getCustomers(
  options: GetCustomersOptions = {}
): Promise<CustomerListRow[]> {
  const result = await listCustomersPage({
    query: options.query,
    page: 1,
    pageSize: 100,
    status: 'all',
    contractFilter: 'all',
  })

  return result.rows
}