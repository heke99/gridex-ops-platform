import { supabaseService } from '@/lib/supabase/service'

export type GridOwnerVerificationStatus =
  | 'verified'
  | 'needs_route'
  | 'needs_certificate'
  | 'needs_ediel_id'
  | 'needs_subaddress'
  | 'needs_contact'
  | 'unresolved_duplicate'
  | 'ambiguous_subaddress'
  | 'unknown'

export type GridOwnerCertificateStatus = 'finns' | 'saknas' | 'utgånget' | 'fel_miljö' | 'fel_mottagare' | 'unknown'

export type GridOwnerVerification = {
  gridOwnerId: string | null
  name: string | null
  edielId: string | null
  orgNumber: string | null
  verificationStatus: GridOwnerVerificationStatus
  certificateStatus: GridOwnerCertificateStatus
  verifiedForCustomerFlow: boolean
  routeCount: number
  prodatRouteCount: number
  utiltsRouteCount: number
  duplicateCount: number
  prodatSubaddressStatus: string | null
  utiltsSubaddressStatus: string | null
  prodatSubaddressSource: string | null
  utiltsSubaddressSource: string | null
  canUseForProdat: boolean
  canUseForUtilts: boolean
  canStartSupplierSwitch: boolean
  reasons: string[]
  nextAction: string | null
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function boolValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 1
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function mapVerification(row: Record<string, unknown> | null): GridOwnerVerification | null {
  if (!row) return null
  const status = typeof row.verification_status === 'string' ? row.verification_status : 'unknown'
  const certificateStatus = typeof row.certificate_status === 'string' ? row.certificate_status : 'unknown'
  return {
    gridOwnerId: typeof row.grid_owner_id === 'string' ? row.grid_owner_id : typeof row.id === 'string' ? row.id : null,
    name: typeof row.name === 'string' ? row.name : null,
    edielId: typeof row.ediel_id === 'string' ? row.ediel_id : null,
    orgNumber: typeof row.org_number === 'string' ? row.org_number : null,
    verificationStatus: status as GridOwnerVerificationStatus,
    certificateStatus: certificateStatus as GridOwnerCertificateStatus,
    verifiedForCustomerFlow: boolValue(row.verified_for_customer_flow) || boolValue(row.can_start_supplier_switch) || status === 'verified',
    routeCount: numberValue(row.route_count),
    prodatRouteCount: numberValue(row.prodat_route_count),
    utiltsRouteCount: numberValue(row.utilts_route_count),
    duplicateCount: numberValue(row.duplicate_count),
    prodatSubaddressStatus: nullableString(row.prodat_subaddress_status),
    utiltsSubaddressStatus: nullableString(row.utilts_subaddress_status),
    prodatSubaddressSource: nullableString(row.prodat_subaddress_source),
    utiltsSubaddressSource: nullableString(row.utilts_subaddress_source),
    canUseForProdat: boolValue(row.can_use_for_prodat),
    canUseForUtilts: boolValue(row.can_use_for_utilts),
    canStartSupplierSwitch: boolValue(row.can_start_supplier_switch),
    reasons: stringArray(row.verification_reasons),
    nextAction: typeof row.next_action === 'string' ? row.next_action : null,
  }
}

const verificationSelect = 'grid_owner_id,name,ediel_id,org_number,verification_status,certificate_status,verified_for_customer_flow,route_count,prodat_route_count,utilts_route_count,duplicate_count,verification_reasons,next_action,prodat_subaddress_status,utilts_subaddress_status,prodat_subaddress_source,utilts_subaddress_source,can_use_for_prodat,can_use_for_utilts,can_start_supplier_switch'

export async function getGridOwnerVerification(gridOwnerId: string | null | undefined): Promise<GridOwnerVerification | null> {
  if (!gridOwnerId) return null

  const view = await supabaseService
    .from('gridex_verified_grid_owners_v')
    .select(verificationSelect)
    .eq('grid_owner_id', gridOwnerId)
    .limit(2)

  if (!view.error) {
    const rows = (view.data ?? []) as Array<Record<string, unknown>>
    if (rows.length > 1) {
      throw new Error(`grid_owner_verification_ambiguous:${gridOwnerId}`)
    }
    return mapVerification(rows[0] ?? null)
  }
  if (!missingSchema(view.error)) throw view.error

  const fallback = await supabaseService
    .from('grid_owners')
    .select('id,name,ediel_id,org_number,verification_status,certificate_status,verified_for_customer_flow,route_count,prodat_route_count,utilts_route_count,duplicate_count,verification_reasons,prodat_subaddress_status,utilts_subaddress_status,prodat_subaddress_source,utilts_subaddress_source,prodat_ready_for_customer_flow,utilts_ready_for_metering_flow,supplier_switch_ready')
    .eq('id', gridOwnerId)
    .maybeSingle()

  if (fallback.error) {
    if (missingSchema(fallback.error)) return null
    throw fallback.error
  }

  const row = fallback.data as Record<string, unknown> | null
  if (row) {
    row.can_use_for_prodat = row.prodat_ready_for_customer_flow
    row.can_use_for_utilts = row.utilts_ready_for_metering_flow
    row.can_start_supplier_switch = row.supplier_switch_ready
  }
  return mapVerification(row)
}

export async function assertGridOwnerVerifiedForSwitch(gridOwnerId: string | null | undefined): Promise<GridOwnerVerification> {
  const verification = await getGridOwnerVerification(gridOwnerId)
  if (!verification) throw new Error('grid_owner_verification_missing')
  if (!verification.canStartSupplierSwitch && (!verification.verifiedForCustomerFlow || verification.verificationStatus !== 'verified')) {
    throw new Error(`grid_owner_not_verified:${verification.verificationStatus}`)
  }
  return verification
}

export async function runGridOwnerVerificationBackfill(source = 'server_action') {
  const { data, error } = await supabaseService.rpc('gridex_backfill_grid_owner_verification', { p_source: source })
  if (error) throw error
  return data as Record<string, unknown> | null
}

export async function runGridOwnerReadinessCompletion(source = 'server_action') {
  const { data, error } = await supabaseService.rpc('gridex_complete_grid_owner_readiness', { p_source: source })
  if (error) throw error
  return data as Record<string, unknown> | null
}

export async function confirmGridOwnerEmptySubaddress(input: {
  gridOwnerId: string
  messageFamily: 'PRODAT' | 'UTILTS'
  actorUserId?: string | null
  note?: string | null
}) {
  const { data, error } = await supabaseService.rpc('gridex_confirm_grid_owner_empty_subaddress', {
    p_grid_owner_id: input.gridOwnerId,
    p_message_family: input.messageFamily,
    p_actor_user_id: input.actorUserId ?? null,
    p_note: input.note ?? null,
  })
  if (error) throw error
  return data as Record<string, unknown> | null
}
