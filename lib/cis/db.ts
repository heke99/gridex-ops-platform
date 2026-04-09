import { supabaseService } from '@/lib/supabase/service'
import type {
  BillingUnderlayRow,
  GridOwnerDataRequestRow,
  MeteringValueRow,
  PartnerExportRow,
} from '@/lib/cis/types'

function normalizeQuery(value?: string | null): string {
  return (value ?? '').trim().toLowerCase()
}

function matchesQuery(values: Array<string | null | undefined>, query: string): boolean {
  if (!query) return true

  return values
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query)
}

export async function listGridOwnerDataRequestsByCustomerId(
  customerId: string
): Promise<GridOwnerDataRequestRow[]> {
  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as GridOwnerDataRequestRow[]
}

export async function listMeteringValuesByCustomerId(
  customerId: string
): Promise<MeteringValueRow[]> {
  const { data, error } = await supabaseService
    .from('metering_values')
    .select('*')
    .eq('customer_id', customerId)
    .order('read_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as MeteringValueRow[]
}

export async function listBillingUnderlaysByCustomerId(
  customerId: string
): Promise<BillingUnderlayRow[]> {
  const { data, error } = await supabaseService
    .from('billing_underlays')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as BillingUnderlayRow[]
}

export async function listPartnerExportsByCustomerId(
  customerId: string
): Promise<PartnerExportRow[]> {
  const { data, error } = await supabaseService
    .from('partner_exports')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as PartnerExportRow[]
}

export async function createGridOwnerDataRequest(input: {
  actorUserId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
  requestScope: 'meter_values' | 'billing_underlay' | 'customer_masterdata'
  requestedPeriodStart?: string | null
  requestedPeriodEnd?: string | null
  externalReference?: string | null
  notes?: string | null
}): Promise<GridOwnerDataRequestRow> {
  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .insert({
      customer_id: input.customerId,
      site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      grid_owner_id: input.gridOwnerId ?? null,
      request_scope: input.requestScope,
      status: 'pending',
      requested_period_start: input.requestedPeriodStart ?? null,
      requested_period_end: input.requestedPeriodEnd ?? null,
      external_reference: input.externalReference ?? null,
      notes: input.notes ?? null,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as GridOwnerDataRequestRow
}

export async function createPartnerExport(input: {
  actorUserId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  billingUnderlayId?: string | null
  exportKind: 'billing_underlay' | 'meter_values' | 'customer_snapshot'
  targetSystem: string
  externalReference?: string | null
  notes?: string | null
}): Promise<PartnerExportRow> {
  const { data, error } = await supabaseService
    .from('partner_exports')
    .insert({
      customer_id: input.customerId,
      site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      billing_underlay_id: input.billingUnderlayId ?? null,
      export_kind: input.exportKind,
      target_system: input.targetSystem,
      status: 'queued',
      payload: {
        notes: input.notes ?? null,
      },
      external_reference: input.externalReference ?? null,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as PartnerExportRow
}

export async function listAllGridOwnerDataRequests(options: {
  status?: string | null
  scope?: string | null
  query?: string | null
} = {}): Promise<GridOwnerDataRequestRow[]> {
  let requestQuery = supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status && options.status !== 'all') {
    requestQuery = requestQuery.eq('status', options.status)
  }

  if (options.scope && options.scope !== 'all') {
    requestQuery = requestQuery.eq('request_scope', options.scope)
  }

  const { data, error } = await requestQuery
  if (error) throw error

  const rows = (data ?? []) as GridOwnerDataRequestRow[]
  const query = normalizeQuery(options.query)

  return rows.filter((row) =>
    matchesQuery(
      [
        row.id,
        row.customer_id,
        row.site_id,
        row.metering_point_id,
        row.grid_owner_id,
        row.request_scope,
        row.status,
        row.external_reference,
        row.notes,
      ],
      query
    )
  )
}

export async function listAllMeteringValues(options: {
  query?: string | null
} = {}): Promise<MeteringValueRow[]> {
  const { data, error } = await supabaseService
    .from('metering_values')
    .select('*')
    .order('read_at', { ascending: false })
    .limit(250)

  if (error) throw error

  const rows = (data ?? []) as MeteringValueRow[]
  const query = normalizeQuery(options.query)

  return rows.filter((row) =>
    matchesQuery(
      [
        row.id,
        row.customer_id,
        row.site_id,
        row.metering_point_id,
        row.grid_owner_id,
        row.reading_type,
        row.quality_code,
        row.source_system,
      ],
      query
    )
  )
}

export async function listAllBillingUnderlays(options: {
  status?: string | null
  query?: string | null
} = {}): Promise<BillingUnderlayRow[]> {
  let underlayQuery = supabaseService
    .from('billing_underlays')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status && options.status !== 'all') {
    underlayQuery = underlayQuery.eq('status', options.status)
  }

  const { data, error } = await underlayQuery
  if (error) throw error

  const rows = (data ?? []) as BillingUnderlayRow[]
  const query = normalizeQuery(options.query)

  return rows.filter((row) =>
    matchesQuery(
      [
        row.id,
        row.customer_id,
        row.site_id,
        row.metering_point_id,
        row.grid_owner_id,
        row.status,
        row.source_system,
        row.failure_reason,
        row.underlay_year?.toString(),
        row.underlay_month?.toString(),
      ],
      query
    )
  )
}

export async function listAllPartnerExports(options: {
  status?: string | null
  exportKind?: string | null
  query?: string | null
} = {}): Promise<PartnerExportRow[]> {
  let exportQuery = supabaseService
    .from('partner_exports')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status && options.status !== 'all') {
    exportQuery = exportQuery.eq('status', options.status)
  }

  if (options.exportKind && options.exportKind !== 'all') {
    exportQuery = exportQuery.eq('export_kind', options.exportKind)
  }

  const { data, error } = await exportQuery
  if (error) throw error

  const rows = (data ?? []) as PartnerExportRow[]
  const query = normalizeQuery(options.query)

  return rows.filter((row) =>
    matchesQuery(
      [
        row.id,
        row.customer_id,
        row.site_id,
        row.metering_point_id,
        row.billing_underlay_id,
        row.export_kind,
        row.target_system,
        row.status,
        row.external_reference,
        row.failure_reason,
      ],
      query
    )
  )
}