import { supabaseService } from '@/lib/supabase/service'

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

type CustomerSiteCountRow = {
  id: string
  customer_id: string
  status: string | null
  site_name?: string | null
  facility_id?: string | null
  street?: string | null
  postal_code?: string | null
  city?: string | null
}

type MeteringPointCountRow = {
  id: string
  site_id: string
  status: string | null
  meter_point_id?: string | null
}

type GetCustomersOptions = {
  query?: string | null
}

function sanitizeSearchTerm(value: string): string {
  return value.replace(/[%_,]/g, ' ').trim()
}

export async function getCustomers(
  options: GetCustomersOptions = {}
): Promise<CustomerListRow[]> {
  const query = sanitizeSearchTerm(options.query ?? '')

  let matchingCustomerIdsFromSites = new Set<string>()
  let matchingCustomerIdsFromMetering = new Set<string>()

  if (query) {
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
      .limit(100)

    if (siteSearchError) throw siteSearchError

    matchingCustomerIdsFromSites = new Set(
      (matchingSites ?? []).map((row) => String(row.customer_id))
    )

    const { data: matchingPoints, error: pointSearchError } = await supabaseService
      .from('metering_points')
      .select('id, site_id, meter_point_id')
      .or(`meter_point_id.ilike.%${query}%`)
      .limit(100)

    if (pointSearchError) throw pointSearchError

    const allSiteIds = new Set<string>()

    for (const site of matchingSites ?? []) {
      allSiteIds.add(String(site.id))
    }

    for (const point of matchingPoints ?? []) {
      if (point.site_id) {
        allSiteIds.add(String(point.site_id))
      }
    }

    if (allSiteIds.size > 0) {
      const { data: relatedSites, error: relatedSitesError } = await supabaseService
        .from('customer_sites')
        .select('id, customer_id')
        .in('id', Array.from(allSiteIds))

      if (relatedSitesError) throw relatedSitesError

      matchingCustomerIdsFromMetering = new Set(
        (relatedSites ?? []).map((row) => String(row.customer_id))
      )
    }
  }

  let customerQuery = supabaseService
    .from('customers')
    .select(
      'id, customer_type, status, first_name, last_name, full_name, company_name, email, phone, personal_number, org_number, customer_number, apartment_number, created_at'
    )
    .order('created_at', { ascending: false })

  if (query) {
    const customerFilterParts = [
      `full_name.ilike.%${query}%`,
      `company_name.ilike.%${query}%`,
      `email.ilike.%${query}%`,
      `phone.ilike.%${query}%`,
      `personal_number.ilike.%${query}%`,
      `org_number.ilike.%${query}%`,
      `customer_number.ilike.%${query}%`,
      `first_name.ilike.%${query}%`,
      `last_name.ilike.%${query}%`,
    ]

    const customerIdsFromRelations = Array.from(
      new Set([
        ...Array.from(matchingCustomerIdsFromSites),
        ...Array.from(matchingCustomerIdsFromMetering),
      ])
    )

    if (customerIdsFromRelations.length > 0) {
      customerFilterParts.push(`id.in.(${customerIdsFromRelations.join(',')})`)
    }

    customerQuery = customerQuery.or(customerFilterParts.join(','))
  }

  const { data: customers, error: customerError } = await customerQuery
  if (customerError) throw customerError

  const customerRows = (customers ?? []) as CustomerBaseRow[]
  const customerIds = customerRows.map((row) => row.id)

  if (customerIds.length === 0) {
    return []
  }

  const { data: siteRows, error: siteError } = await supabaseService
    .from('customer_sites')
    .select('id, customer_id, status, site_name, facility_id, street, postal_code, city')
    .in('customer_id', customerIds)

  if (siteError) throw siteError

  const typedSites = (siteRows ?? []) as CustomerSiteCountRow[]
  const siteIds = typedSites.map((row) => row.id)

  const { data: pointRows, error: pointError } =
    siteIds.length > 0
      ? await supabaseService
          .from('metering_points')
          .select('id, site_id, status, meter_point_id')
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