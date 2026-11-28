import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { resolveCustomerCardLookup } from '@/app/admin/customers/[id]/customer-lookup-outcome'
import { formatAdminDate, formatAdminDateTime } from '@/lib/ui/format'
import { isUuid } from '@/lib/validation/uuid'
import type { GridOwnerDataRequestRow, MeteringValueRow } from '@/lib/cis/types'

export const METERING_REQUEST_ROW_LIMIT = 20

type Customer = { id: string; full_name: string | null; first_name: string | null; last_name: string | null; company_name: string | null; customer_number: string | null }
type Site = { id: string; customer_id: string; site_name: string | null; facility_id: string | null; street: string | null }
type Meter = { id: string; site_id: string; meter_point_id: string | null }
export type MeteringBusinessData = {
  customers: Customer[]
  sites: Site[]
  meters: Meter[]
  customerCardIds?: ReadonlySet<string>
}
type Identity = { customer_id: string; site_id: string | null; metering_point_id: string | null }
const ids = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))]

export async function readMeteringCustomerCardIds(companyId: string, customerIds: string[]): Promise<Set<string>> {
  const distinct = ids(customerIds).filter(isUuid)
  if (distinct.length === 0) return new Set()
  const { data, error } = await tenantSelect(companyId, 'customers', 'id,company_id,source').in('id', distinct)
  if (error) return new Set()
  const scope = { companyId, isPlatformAdmin: false }
  const requested = new Set(distinct)
  const qualified = new Set<string>()
  for (const row of data ?? []) {
    if (!row || typeof row !== 'object') continue
    const { id, company_id, source } = row as Record<string, unknown>
    if (typeof id !== 'string' || !requested.has(id) || typeof company_id !== 'string') continue
    if ((typeof source === 'string' || source === null)
      && resolveCustomerCardLookup(scope, { company_id, source }).kind === 'ok') qualified.add(id)
  }
  return qualified
}

export async function loadMeteringBusinessData(
  companyId: string,
  requests: GridOwnerDataRequestRow[],
  values: MeteringValueRow[],
  options: { includeCustomerCardTargets?: boolean } = {},
): Promise<MeteringBusinessData> {
  if (!companyId) throw new Error('company_required_for_metering_labels')
  async function read<T>(table: string, columns: string, requestedIds: string[]): Promise<T[]> {
    if (requestedIds.length === 0) return []
    const { data, error } = await tenantSelect(companyId, table, columns).in('id', requestedIds)
    if (error) throw error
    return (data ?? []) as unknown as T[]
  }
  const records = [...requests, ...values]
  const [customers, meters, customerCardIds] = await Promise.all([
    read<Customer>('customers', 'id,full_name,first_name,last_name,company_name,customer_number', ids(records.map(row => row.customer_id))),
    read<Meter>('metering_points', 'id,site_id,meter_point_id', ids(records.map(row => row.metering_point_id))),
    options.includeCustomerCardTargets
      ? readMeteringCustomerCardIds(companyId, values.map(row => row.customer_id))
      : undefined,
  ])
  const sites = await read<Site>('customer_sites', 'id,customer_id,site_name,facility_id,street', ids([...records.map(row => row.site_id), ...meters.map(row => row.site_id)]))
  return { customers, sites, meters, customerCardIds }
}

export function meteringBusinessIdentity(row: Identity, data: MeteringBusinessData) {
  const customer = data.customers.find(item => item.id === row.customer_id)
  const meter = data.meters.find(item => item.id === row.metering_point_id)
  const site = data.sites.find(item => item.id === (row.site_id ?? meter?.site_id) && item.customer_id === row.customer_id)
  const meterNumber = site && meter?.site_id === site.id ? meter.meter_point_id : null
  const name = customer?.company_name || customer?.full_name || [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || customer?.customer_number || 'Kunduppgifter saknas'
  return {
    customer: customer?.customer_number && name !== customer.customer_number ? `${name} (${customer.customer_number})` : name,
    site: site ? [site.site_name, site.street, site.facility_id].filter(Boolean).join(' · ') || 'Anläggningsuppgifter saknas' : 'Anläggningsuppgifter saknas',
    meter: meterNumber,
    customerSiteId: site && data.customerCardIds?.has(row.customer_id) ? site.id : null,
  }
}

/** Filter the same scoped, bounded dataset the operator can inspect. */
export function filterMeteringBusinessRows<T extends GridOwnerDataRequestRow | MeteringValueRow>(rows: T[], data: MeteringBusinessData, query: string): T[] {
  const needle = query.trim().toLocaleLowerCase('sv-SE')
  if (!needle) return rows
  return rows.filter(row => {
    const identity = meteringBusinessIdentity(row, data)
    const dates = 'requested_period_start' in row ? [row.requested_period_start, row.requested_period_end] : [row.period_start, row.period_end, row.read_at]
    return [row.id, row.customer_id, row.site_id, row.metering_point_id, identity.customer, identity.site, identity.meter, ...dates.flatMap(value => [value, formatAdminDate(value, ''), formatAdminDateTime(value, '')])].filter(Boolean).some(value => String(value).toLocaleLowerCase('sv-SE').includes(needle))
  })
}
