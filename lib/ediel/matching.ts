// lib/ediel/matching.ts

import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function messageCompanyId(message: EdielMessageRow): string | null {
  return stringOrNull(message.company_id)
}

function parsedText(message: EdielMessageRow, ...keys: string[]): string[] {
  const payload = message.parsed_payload ?? {}
  return uniqueStrings(keys.map((key) => stringOrNull(payload[key])))
}

export async function matchMeteringPointIdByIdentifier(params: {
  companyId: string
  identifiers: string[]
}): Promise<string | null> {
  const identifiers = params.identifiers
  if (identifiers.length === 0) return null

  const { data, error } = await supabaseService
    .from('metering_points')
    .select('id,company_id,meter_point_id,metering_point_id,ediel_reference')
    .eq('company_id', params.companyId)
    .or(
      identifiers
        .map((identifier) => {
          const safe = identifier.replace(/,/g, '')
          return `meter_point_id.eq.${safe},metering_point_id.eq.${safe},ediel_reference.eq.${safe}`
        })
        .join(',')
    )
    .limit(5)

  if (error) throw error

  return (data?.[0] as { id: string } | undefined)?.id ?? null
}

export async function matchMeteringPointForEdielMessage(
  message: EdielMessageRow
): Promise<string | null> {
  const companyId = messageCompanyId(message)
  if (!companyId) return null

  if (message.metering_point_id) {
    const { data, error } = await supabaseService
      .from('metering_points')
      .select('id')
      .eq('id', message.metering_point_id)
      .eq('company_id', companyId)
      .maybeSingle()

    if (error) throw error
    return (data as { id: string } | null)?.id ?? null
  }

  const identifiers = uniqueStrings([
    ...parsedText(
      message,
      'meterPointId',
      'meteringPointId',
      'edielReference',
      'installationId',
      'facilityId'
    ),
    stringOrNull(message.external_reference),
    stringOrNull(message.transaction_reference),
  ])

  return matchMeteringPointIdByIdentifier({ companyId, identifiers })
}

export async function matchSiteAndCustomerForMeteringPoint(params: {
  meteringPointId: string | null
  companyId?: string | null
}): Promise<{
  siteId: string | null
  customerId: string | null
  gridOwnerId: string | null
} | null> {
  if (!params.meteringPointId) return null

  const { data, error } = await supabaseService
    .from('metering_points')
    .select('id,company_id,site_id,grid_owner_id')
    .eq('id', params.meteringPointId)
    .eq('company_id', params.companyId ?? '')
    .maybeSingle()

  if (error) throw error
  if (!data?.site_id) {
    return {
      siteId: null,
      customerId: null,
      gridOwnerId: (data as { grid_owner_id?: string | null } | null)?.grid_owner_id ?? null,
    }
  }

  const siteId = data.site_id as string
  const gridOwnerId = (data as { grid_owner_id?: string | null }).grid_owner_id ?? null

  const siteRes = await supabaseService
    .from('customer_sites')
    .select('id,customer_id')
    .eq('id', siteId)
    .eq('company_id', params.companyId ?? '')
    .maybeSingle()

  if (siteRes.error) throw siteRes.error

  return {
    siteId,
    customerId: (siteRes.data as { customer_id?: string | null } | null)?.customer_id ?? null,
    gridOwnerId,
  }
}

export async function findMatchingSupplierSwitchRequest(
  message: EdielMessageRow
): Promise<SupplierSwitchRequestRow | null> {
  const companyId = messageCompanyId(message)
  if (!companyId) return null

  if (message.switch_request_id) {
    const { data, error } = await supabaseService
      .from('supplier_switch_requests')
      .select('*')
      .eq('id', message.switch_request_id)
      .eq('company_id', companyId)
      .maybeSingle()

    if (error) throw error
    return (data as SupplierSwitchRequestRow | null) ?? null
  }

  const meteringPointId =
    message.metering_point_id ?? (await matchMeteringPointForEdielMessage(message))

  const references = uniqueStrings([
    stringOrNull(message.external_reference),
    stringOrNull(message.transaction_reference),
    ...parsedText(message, 'externalReference', 'transactionReference'),
  ])

  if (references.length > 0) {
    const byReference = await supabaseService
      .from('supplier_switch_requests')
      .select('*')
      .eq('company_id', companyId)
      .in('external_reference', references)
      .order('created_at', { ascending: false })
      .limit(1)

    if (byReference.error) throw byReference.error
    let hit = (byReference.data?.[0] as SupplierSwitchRequestRow | undefined) ?? null
    if (hit) return hit

    const byRffLi = await supabaseService
      .from('supplier_switch_requests')
      .select('*')
      .eq('company_id', companyId)
      .in('rff_li_reference', references)
      .order('created_at', { ascending: false })
      .limit(1)

    if (byRffLi.error) throw byRffLi.error
    hit = (byRffLi.data?.[0] as SupplierSwitchRequestRow | undefined) ?? null
    if (hit) return hit
  }

  if (!meteringPointId) return null

  const { data, error } = await supabaseService
    .from('supplier_switch_requests')
    .select('*')
    .eq('company_id', companyId)
    .eq('metering_point_id', meteringPointId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return (data?.[0] as SupplierSwitchRequestRow | undefined) ?? null
}

export async function findMatchingGridOwnerDataRequest(
  message: EdielMessageRow
): Promise<GridOwnerDataRequestRow | null> {
  const companyId = messageCompanyId(message)
  if (!companyId) return null

  if (message.grid_owner_data_request_id) {
    const { data, error } = await supabaseService
      .from('grid_owner_data_requests')
      .select('*')
      .eq('id', message.grid_owner_data_request_id)
      .eq('company_id', companyId)
      .maybeSingle()

    if (error) throw error
    return (data as GridOwnerDataRequestRow | null) ?? null
  }

  const meteringPointId =
    message.metering_point_id ?? (await matchMeteringPointForEdielMessage(message))

  const references = uniqueStrings([
    stringOrNull(message.external_reference),
    stringOrNull(message.transaction_reference),
    ...parsedText(message, 'externalReference', 'transactionReference'),
  ])

  if (references.length > 0) {
    const byReference = await supabaseService
      .from('grid_owner_data_requests')
      .select('*')
      .eq('company_id', companyId)
      .in('external_reference', references)
      .order('created_at', { ascending: false })
      .limit(1)

    if (byReference.error) throw byReference.error
    const hit = (byReference.data?.[0] as GridOwnerDataRequestRow | undefined) ?? null
    if (hit) return hit
  }

  if (!meteringPointId) return null

  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .eq('company_id', companyId)
    .eq('metering_point_id', meteringPointId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return (data?.[0] as GridOwnerDataRequestRow | undefined) ?? null
}