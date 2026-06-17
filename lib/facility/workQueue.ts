import type { SupabaseClient } from '@supabase/supabase-js'

export type FacilityWorkQueueStatus =
  | 'missing_authorization'
  | 'needs_facility_data'
  | 'needs_grid_owner_review'
  | 'awaiting_grid_owner'
  | 'ready_for_switch'
  | 'manual_review'

export type FacilityWorkQueuePriority = 'low' | 'normal' | 'high' | 'critical'

export type FacilityWorkQueueRow = {
  id: string
  companyId: string
  customerId: string
  customerNumber: string | null
  customerLabel: string
  siteId: string | null
  siteLabel: string
  meteringPointId: string | null
  meteringPointLabel: string | null
  facilityId: string | null
  gridOwnerId: string | null
  gridOwnerName: string | null
  priceAreaCode: string | null
  status: FacilityWorkQueueStatus
  statusLabel: string
  priority: FacilityWorkQueuePriority
  missingFields: string[]
  nextAction: string
  description: string
  createdAt: string | null
  updatedAt: string | null
  href: string
}

type RawRow = Record<string, unknown>

type CustomerRow = {
  id: string
  company_id: string | null
  customer_number: string | null
  full_name: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  email: string | null
}

type SiteRow = {
  id: string
  company_id: string | null
  customer_id: string | null
  site_name: string | null
  facility_id: string | null
  grid_owner_id: string | null
  price_area_code: string | null
  status: string | null
  street: string | null
  postal_code: string | null
  city: string | null
  created_at: string | null
  updated_at: string | null
}

type MeteringPointRow = {
  id: string
  company_id: string | null
  customer_id: string | null
  site_id: string | null
  meter_point_id: string | null
  metering_point_id?: string | null
  grid_owner_id: string | null
  price_area_code: string | null
  status: string | null
  created_at: string | null
  updated_at: string | null
}

type RequestRow = {
  id: string
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  status: string | null
  target_party_type?: string | null
  request_scope?: string | null
  request_type?: string | null
  created_at: string | null
  updated_at: string | null
}

type GridOwnerRow = {
  id: string
  name: string | null
  owner_code: string | null
  ediel_id: string | null
}

type PowerOfAttorneyRow = {
  id: string
  customer_id: string | null
  site_id: string | null
  status: string | null
  scope: string | null
  document_path: string | null
}

function isMissingSchemaError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(maybe.code ?? '') ||
        /does not exist|schema cache|relation .* does not exist|column .* does not exist|function .* not found/i.test(maybe.message ?? '')),
  )
}

function rpcRows(data: unknown): RawRow[] {
  if (!Array.isArray(data)) return []
  return data.filter((row): row is RawRow => Boolean(row) && typeof row === 'object')
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function normalizePriority(value: unknown): FacilityWorkQueuePriority {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'critical' || normalized === 'high' || normalized === 'low') return normalized
  return 'normal'
}

function normalizeStatus(value: unknown): FacilityWorkQueueStatus {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'missing_authorization') return 'missing_authorization'
  if (normalized === 'needs_grid_owner_review') return 'needs_grid_owner_review'
  if (normalized === 'awaiting_grid_owner') return 'awaiting_grid_owner'
  if (normalized === 'ready_for_switch') return 'ready_for_switch'
  if (normalized === 'manual_review') return 'manual_review'
  return 'needs_facility_data'
}

export function facilityStatusLabel(status: FacilityWorkQueueStatus): string {
  const labels: Record<FacilityWorkQueueStatus, string> = {
    missing_authorization: 'Saknar fullmakt',
    needs_facility_data: 'Saknar anläggningsuppgifter',
    needs_grid_owner_review: 'Saknar verifierad nätägare',
    awaiting_grid_owner: 'Väntar på nätägare',
    ready_for_switch: 'Redo för leverantörsbyte',
    manual_review: 'Kräver manuell granskning',
  }
  return labels[status]
}

export function facilityMissingFieldLabel(value: string): string {
  const labels: Record<string, string> = {
    facility_id: 'Anläggnings-ID',
    metering_point_id: 'Mätpunkt',
    grid_owner: 'Verifierad nätägare',
    price_area: 'Elområde',
    power_of_attorney: 'Signerad fullmakt',
    grid_area_code: 'Nätområdeskod',
  }
  return labels[value] ?? value.replaceAll('_', ' ')
}

function customerLabel(customer: CustomerRow | undefined): string {
  if (!customer) return 'Kund utan namn'
  return (
    customer.company_name?.trim() ||
    customer.full_name?.trim() ||
    [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() ||
    customer.email?.trim() ||
    customer.customer_number?.trim() ||
    'Kund utan namn'
  )
}

function siteLabel(site: SiteRow): string {
  return site.site_name?.trim() || site.facility_id?.trim() || [site.street, site.postal_code, site.city].filter(Boolean).join(', ') || 'Anläggning'
}

function meteringPointLabel(point: MeteringPointRow | undefined): string | null {
  if (!point) return null
  return point.meter_point_id?.trim() || point.metering_point_id?.trim() || point.id
}

function isSignedPowerOfAttorney(row: PowerOfAttorneyRow): boolean {
  const raw = row as unknown as Record<string, unknown>
  const evidence = row.document_path?.trim() || raw.signed_at || raw.accepted_at || raw.reference || raw.fullmakt_snapshot
  return row.status === 'signed' && Boolean(evidence)
}

function hasOpenRequest(rows: RequestRow[]): boolean {
  return rows.some((row) =>
    ['pending', 'sent', 'waiting_response', 'waiting_for_z02', 'z01_prepared', 'ready_to_send', 'manual_review_required'].includes(
      String(row.status ?? '').toLowerCase(),
    ),
  )
}

function latestDate(...values: Array<string | null | undefined>): string | null {
  const dates = values.filter((value): value is string => Boolean(value))
  if (dates.length === 0) return null
  return dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
}

function buildFallbackDescription(missingFields: string[], status: FacilityWorkQueueStatus, gridOwnerName: string | null): string {
  if (status === 'awaiting_grid_owner') return `Uppgifter är begärda${gridOwnerName ? ` från ${gridOwnerName}` : ' från nätägare'}. Följ upp svar och koppla inkommen Z02/manuellt svar till kundkortet.`
  if (status === 'missing_authorization') return 'Kunden kan ligga kvar i OPS, men utskick till nätägare stoppas tills signerad fullmakt finns.'
  if (status === 'needs_grid_owner_review') return 'Adress/postnummer kan ge förslag, men verifierad nätägare eller nätområdeskod saknas. Kontrollera resolver-resultat innan switch.'
  if (missingFields.length === 0) return 'Anläggningsdata ser komplett ut. Nästa steg är leverantörsbyte eller aktiv kundprocess.'
  return `Saknas: ${missingFields.map(facilityMissingFieldLabel).join(', ')}.`
}

function nextActionFor(status: FacilityWorkQueueStatus): string {
  const labels: Record<FacilityWorkQueueStatus, string> = {
    missing_authorization: 'Ladda upp eller verifiera fullmakt',
    needs_facility_data: 'Begär uppgifter från nätägare',
    needs_grid_owner_review: 'Verifiera nätägare/nätområde',
    awaiting_grid_owner: 'Följ upp nätägarens svar',
    ready_for_switch: 'Starta leverantörsbyte',
    manual_review: 'Granska manuellt',
  }
  return labels[status]
}

function mapRpcRow(row: RawRow): FacilityWorkQueueRow {
  const status = normalizeStatus(row.status)
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    customerId: String(row.customer_id),
    customerNumber: stringOrNull(row.customer_number),
    customerLabel: stringOrNull(row.customer_label) ?? 'Kund utan namn',
    siteId: stringOrNull(row.site_id),
    siteLabel: stringOrNull(row.site_label) ?? 'Anläggning',
    meteringPointId: stringOrNull(row.metering_point_id),
    meteringPointLabel: stringOrNull(row.metering_point_label),
    facilityId: stringOrNull(row.facility_id),
    gridOwnerId: stringOrNull(row.grid_owner_id),
    gridOwnerName: stringOrNull(row.grid_owner_name),
    priceAreaCode: stringOrNull(row.price_area_code),
    status,
    statusLabel: facilityStatusLabel(status),
    priority: normalizePriority(row.priority),
    missingFields: stringArray(row.missing_fields),
    nextAction: stringOrNull(row.next_action) ?? nextActionFor(status),
    description: stringOrNull(row.description) ?? '',
    createdAt: stringOrNull(row.created_at),
    updatedAt: stringOrNull(row.updated_at),
    href: stringOrNull(row.href) ?? `/admin/customers/${String(row.customer_id)}?tab=data-requests`,
  }
}

async function safeSelect<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await query
  if (error) {
    if (isMissingSchemaError(error)) return []
    throw error
  }
  return (Array.isArray(data) ? data : []) as T[]
}

async function fallbackFacilityQueue(
  supabase: SupabaseClient,
  companyId: string | null | undefined,
  limit: number,
): Promise<FacilityWorkQueueRow[]> {
  let siteQuery = supabase
    .from('customer_sites')
    .select('id,company_id,customer_id,site_name,facility_id,grid_owner_id,price_area_code,status,street,postal_code,city,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(Math.min(Math.max(limit * 2, 50), 500))

  if (companyId) siteQuery = siteQuery.eq('company_id', companyId)

  const sites = await safeSelect<SiteRow>(siteQuery)
  if (sites.length === 0) return []

  const customerIds = [...new Set(sites.map((site) => site.customer_id).filter((value): value is string => Boolean(value)))]
  const siteIds = sites.map((site) => site.id)
  const gridOwnerIds = [...new Set(sites.map((site) => site.grid_owner_id).filter((value): value is string => Boolean(value)))]

  const [customers, meteringPoints, infoRequests, gridOwnerRequests, powersOfAttorney, gridOwners] = await Promise.all([
    customerIds.length
      ? safeSelect<CustomerRow>(
          supabase
            .from('customers')
            .select('id,company_id,customer_number,full_name,first_name,last_name,company_name,email')
            .in('id', customerIds),
        )
      : Promise.resolve([]),
    siteIds.length
      ? safeSelect<MeteringPointRow>(
          supabase
            .from('metering_points')
            .select('id,company_id,customer_id,site_id,meter_point_id,metering_point_id,grid_owner_id,price_area_code,status,created_at,updated_at')
            .in('site_id', siteIds),
        )
      : Promise.resolve([]),
    customerIds.length
      ? safeSelect<RequestRow>(
          supabase
            .from('customer_info_requests')
            .select('id,customer_id,site_id,metering_point_id,status,target_party_type,request_type,created_at,updated_at')
            .in('customer_id', customerIds)
            .in('status', ['pending', 'sent', 'waiting_response', 'waiting_for_z02', 'z01_prepared', 'ready_to_send', 'manual_review_required']),
        )
      : Promise.resolve([]),
    customerIds.length
      ? safeSelect<RequestRow>(
          supabase
            .from('grid_owner_data_requests')
            .select('id,customer_id,site_id,metering_point_id,status,request_scope,created_at,updated_at')
            .in('customer_id', customerIds)
            .in('status', ['pending', 'sent', 'failed']),
        )
      : Promise.resolve([]),
    customerIds.length
      ? safeSelect<PowerOfAttorneyRow>(
          supabase
            .from('powers_of_attorney')
            .select('id,customer_id,site_id,status,scope,document_path')
            .in('customer_id', customerIds),
        )
      : Promise.resolve([]),
    gridOwnerIds.length
      ? safeSelect<GridOwnerRow>(
          supabase
            .from('grid_owners')
            .select('id,name,owner_code,ediel_id')
            .in('id', gridOwnerIds),
        )
      : Promise.resolve([]),
  ])

  const customersById = new Map(customers.map((customer) => [customer.id, customer]))
  const pointsBySiteId = new Map<string, MeteringPointRow[]>()
  for (const point of meteringPoints) {
    if (!point.site_id) continue
    const list = pointsBySiteId.get(point.site_id) ?? []
    list.push(point)
    pointsBySiteId.set(point.site_id, list)
  }
  const gridOwnersById = new Map(gridOwners.map((owner) => [owner.id, owner]))
  const requestsBySiteId = new Map<string, RequestRow[]>()
  for (const request of [...infoRequests, ...gridOwnerRequests]) {
    const key = request.site_id ?? `customer:${request.customer_id ?? ''}`
    const list = requestsBySiteId.get(key) ?? []
    list.push(request)
    requestsBySiteId.set(key, list)
  }
  const signedPowerByCustomerId = new Map<string, boolean>()
  for (const power of powersOfAttorney) {
    if (!power.customer_id) continue
    if (isSignedPowerOfAttorney(power)) signedPowerByCustomerId.set(power.customer_id, true)
  }

  const rows: FacilityWorkQueueRow[] = []
  for (const site of sites) {
    if (!site.customer_id || !site.company_id) continue
    const points = pointsBySiteId.get(site.id) ?? []
    const primaryPoint = points.find((point) => point.status === 'active') ?? points[0]
    const effectiveGridOwnerId = site.grid_owner_id ?? primaryPoint?.grid_owner_id ?? null
    const effectivePriceAreaCode = site.price_area_code ?? primaryPoint?.price_area_code ?? null
    const missingFields = [
      site.facility_id?.trim() ? null : 'facility_id',
      effectiveGridOwnerId ? null : 'grid_owner',
      effectivePriceAreaCode ? null : 'price_area',
      points.some((point) => point.meter_point_id?.trim() || point.metering_point_id?.trim()) ? null : 'metering_point_id',
      signedPowerByCustomerId.get(site.customer_id) ? null : 'power_of_attorney',
    ].filter((value): value is string => Boolean(value))
    const activeRequests = [...(requestsBySiteId.get(site.id) ?? []), ...(requestsBySiteId.get(`customer:${site.customer_id}`) ?? [])]
    const waitingForGridOwner = hasOpenRequest(activeRequests)

    if (missingFields.length === 0 && !waitingForGridOwner) continue

    const status: FacilityWorkQueueStatus = waitingForGridOwner
      ? 'awaiting_grid_owner'
      : missingFields.includes('power_of_attorney')
        ? 'missing_authorization'
        : missingFields.includes('grid_owner')
          ? 'needs_grid_owner_review'
          : 'needs_facility_data'
    const priority: FacilityWorkQueuePriority = status === 'missing_authorization' || status === 'needs_grid_owner_review' ? 'high' : 'normal'
    const customer = customersById.get(site.customer_id)
    const gridOwner = effectiveGridOwnerId ? gridOwnersById.get(effectiveGridOwnerId) : undefined
    const gridOwnerName = gridOwner?.name ?? gridOwner?.owner_code ?? null

    rows.push({
      id: site.id,
      companyId: site.company_id,
      customerId: site.customer_id,
      customerNumber: customer?.customer_number ?? null,
      customerLabel: customerLabel(customer),
      siteId: site.id,
      siteLabel: siteLabel(site),
      meteringPointId: primaryPoint?.id ?? null,
      meteringPointLabel: meteringPointLabel(primaryPoint),
      facilityId: site.facility_id,
      gridOwnerId: effectiveGridOwnerId,
      gridOwnerName,
      priceAreaCode: effectivePriceAreaCode,
      status,
      statusLabel: facilityStatusLabel(status),
      priority,
      missingFields,
      nextAction: nextActionFor(status),
      description: buildFallbackDescription(missingFields, status, gridOwnerName),
      createdAt: site.created_at,
      updatedAt: latestDate(site.updated_at, primaryPoint?.updated_at, ...activeRequests.map((request) => request.updated_at ?? request.created_at)),
      href: `/admin/customers/${site.customer_id}?tab=data-requests`,
    })
  }

  return rows
    .sort((a, b) => {
      const priorityRank = { critical: 4, high: 3, normal: 2, low: 1 }
      const priorityDiff = priorityRank[b.priority] - priorityRank[a.priority]
      if (priorityDiff !== 0) return priorityDiff
      return new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()
    })
    .slice(0, limit)
}

export async function listFacilityWorkQueue(
  supabase: SupabaseClient,
  companyId: string | null | undefined,
  options: { limit?: number } = {},
): Promise<FacilityWorkQueueRow[]> {
  const limit = options.limit ?? 200
  try {
    const rpcResult = await supabase.rpc('gridex_get_facility_work_queue', {
      p_company_id: companyId ?? null,
      p_limit: limit,
    })

    if (!rpcResult.error) {
      return rpcRows(rpcResult.data).map(mapRpcRow)
    }

    if (!isMissingSchemaError(rpcResult.error)) throw rpcResult.error
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error
  }

  return fallbackFacilityQueue(supabase, companyId, limit)
}
