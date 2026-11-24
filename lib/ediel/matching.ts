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

// U-19: an RFF+TN PRODAT case reference (field 226) is an optional
// correlation hint only, never a mandatory authorization key.
function parsedProdatCaseReferences(message: EdielMessageRow): string[] {
  const references = (message.parsed_payload ?? {}).references
  // edielEmailParser persists references keyed by qualifier: { TN: [...] }.
  if (references && typeof references === 'object' && !Array.isArray(references)) {
    const tn = (references as Record<string, unknown>).TN
    return uniqueStrings(Array.isArray(tn) ? tn.map((value) => stringOrNull(value)) : [])
  }
  if (!Array.isArray(references)) return []
  return uniqueStrings(references.map((reference) => {
    const entry = reference as { qualifier?: unknown; value?: unknown } | null
    return String(entry?.qualifier ?? '').trim().toUpperCase() === 'TN' ? stringOrNull(entry?.value) : null
  }))
}

function parsedText(message: EdielMessageRow, ...keys: string[]): string[] {
  const payload = message.parsed_payload ?? {}
  return uniqueStrings(keys.map((key) => stringOrNull(payload[key])))
}

export async function matchMeteringPointIdByIdentifier(params: {
  companyId: string
  identifiers: string[]
  requireUnique?: boolean
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
  if (params.requireUnique && data?.length !== 1) return null
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

export type E66RequestReferenceIssue = 'missing_reference' | 'ambiguous_reference' |
  'unknown_reference' | 'point_mismatch' | 'inactive_request' | 'disjoint_period' | 'unverified_period'

export async function findE66GridOwnerDataRequest(params: {
  companyId: string
  environment: 'test' | 'production'
  actorUserId: string
  reference: string | null
  hasAmbiguousReferences: boolean
  meteringPointId: string | null
}) {
  const pending = supabaseService.from('grid_owner_data_requests').select('*')
    .eq('company_id', params.companyId)
    .in('request_scope', ['meter_values', 'billing_underlay'])
  if (params.hasAmbiguousReferences) return {request: null, issue: 'ambiguous_reference' as const}
  if (!params.reference) {
    if (!params.meteringPointId) return {request: null, issue: null}
    const {data, error} = await pending.eq('metering_point_id', params.meteringPointId).in('status',['pending','sent']).limit(1)
    if (error) throw error
    return {request: null, issue: data?.length ? 'missing_reference' as const : null}
  }

  const match = await supabaseService.rpc('gridex_match_e66_to_sent_e73_reference_v1',{
    p_company_id:params.companyId, p_environment:params.environment,
    p_actor_user_id:params.actorUserId, p_reference:params.reference,
  })
  if (match.error) throw match.error
  const ids: unknown = match.data
  if (!Array.isArray(ids) || ids.some(id=>typeof id!=='string')) throw new Error('e66_sent_e73_reference_invalid')
  if (!ids.length) return {request: null, issue: 'unknown_reference' as const}
  if (ids.length!==1) return {request: null, issue: 'ambiguous_reference' as const}
  const {data,error} = await pending.eq('id',ids[0]).maybeSingle()
  if (error) throw error
  if (!data) return {request:null,issue:'unknown_reference' as const}
  const request = data as GridOwnerDataRequestRow
  if (!params.meteringPointId || request.metering_point_id !== params.meteringPointId) {
    return {request: null, issue: 'point_mismatch' as const}
  }
  if (request.status !== 'sent' && request.status !== 'received') {
    return {request: null, issue: 'inactive_request' as const}
  }
  return {request, issue: null}
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
    ...parsedProdatCaseReferences(message),
  ])

  if (references.length > 0) {
    const byReference = await supabaseService
      .from('grid_owner_data_requests')
      .select('*')
      .eq('company_id', companyId)
      .in('external_reference', references)
      .order('created_at', { ascending: false })
      .limit(2)

    if (byReference.error) throw byReference.error
    // external_reference is not unique per company: bind only an unambiguous
    // hit that does not name another metering point than the one resolved.
    const hits = (byReference.data ?? []) as GridOwnerDataRequestRow[]
    const hit = hits.length === 1 ? hits[0] : null
    const hitPoint = stringOrNull((hit as { metering_point_id?: unknown } | null)?.metering_point_id)
    if (hit && (!meteringPointId || !hitPoint || hitPoint === meteringPointId)) return hit
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