// lib/ediel/matching.ts

import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'

function normalize(value?: string | null): string {
  return (value ?? '').trim().toLowerCase()
}

function extractMeterPointCandidates(message: EdielMessageRow): string[] {
  const parsed = message.parsed_payload ?? {}
  const values = [
    parsed.meterPointId,
    parsed.meteringPointId,
    parsed.edielReference,
    parsed.installationId,
    parsed.objectId,
  ]

  return values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
}

export async function matchMeteringPointForEdielMessage(
  message: EdielMessageRow
): Promise<string | null> {
  const candidates = extractMeterPointCandidates(message)

  for (const candidate of candidates) {
    const { data, error } = await supabaseService
      .from('metering_points')
      .select('id, meter_point_id, metering_point_id, ediel_reference')
      .or(
        [
          `meter_point_id.eq.${candidate}`,
          `metering_point_id.eq.${candidate}`,
          `ediel_reference.eq.${candidate}`,
        ].join(',')
      )
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (data?.id) return data.id as string
  }

  return message.metering_point_id ?? null
}

export async function matchSiteAndCustomerForMeteringPoint(params: {
  meteringPointId: string | null
}): Promise<{
  siteId: string | null
  customerId: string | null
  gridOwnerId: string | null
} | null> {
  if (!params.meteringPointId) return null

  const { data, error } = await supabaseService
    .from('metering_points')
    .select('id, site_id, grid_owner_id')
    .eq('id', params.meteringPointId)
    .maybeSingle()

  if (error) throw error
  if (!data?.site_id) return null

  const { data: site, error: siteError } = await supabaseService
    .from('customer_sites')
    .select('id, customer_id')
    .eq('id', data.site_id)
    .maybeSingle()

  if (siteError) throw siteError

  return {
    siteId: (site?.id as string | null) ?? null,
    customerId: (site?.customer_id as string | null) ?? null,
    gridOwnerId: (data.grid_owner_id as string | null) ?? null,
  }
}

export async function findMatchingSupplierSwitchRequest(
  message: EdielMessageRow
): Promise<SupplierSwitchRequestRow | null> {
  const meteringPointId =
    message.metering_point_id ?? (await matchMeteringPointForEdielMessage(message))

  if (!meteringPointId) return null

  let query = supabaseService
    .from('supplier_switch_requests')
    .select('*')
    .eq('metering_point_id', meteringPointId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (message.grid_owner_id) {
    query = query.eq('grid_owner_id', message.grid_owner_id)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as SupplierSwitchRequestRow[]
  const tx = normalize(message.transaction_reference)
  const ext = normalize(message.external_reference)

  const exact =
    rows.find((row) => normalize(row.external_reference) === ext) ??
    rows.find((row) => normalize(row.external_reference) === tx)

  return exact ?? rows[0] ?? null
}

export async function findMatchingGridOwnerDataRequest(
  message: EdielMessageRow
): Promise<GridOwnerDataRequestRow | null> {
  const meteringPointId =
    message.metering_point_id ?? (await matchMeteringPointForEdielMessage(message))

  let query = supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)

  if (meteringPointId) {
    query = query.eq('metering_point_id', meteringPointId)
  }

  if (message.grid_owner_id) {
    query = query.eq('grid_owner_id', message.grid_owner_id)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as GridOwnerDataRequestRow[]
  const ext = normalize(message.external_reference)
  const tx = normalize(message.transaction_reference)

  const exact =
    rows.find((row) => normalize(row.external_reference) === ext) ??
    rows.find((row) => normalize(row.external_reference) === tx)

  return exact ?? rows[0] ?? null
}