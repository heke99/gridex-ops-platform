import { supabaseService } from '@/lib/supabase/service'

export type GridOwnerVerificationStatus =
  | 'verified'
  | 'needs_route'
  | 'needs_certificate'
  | 'needs_ediel_id'
  | 'needs_subaddress'
  | 'needs_contact'
  | 'unresolved_duplicate'
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
    verifiedForCustomerFlow: row.verified_for_customer_flow === true || status === 'verified',
    routeCount: numberValue(row.route_count),
    prodatRouteCount: numberValue(row.prodat_route_count),
    utiltsRouteCount: numberValue(row.utilts_route_count),
    duplicateCount: numberValue(row.duplicate_count),
    reasons: stringArray(row.verification_reasons),
    nextAction: typeof row.next_action === 'string' ? row.next_action : null,
  }
}

export async function getGridOwnerVerification(gridOwnerId: string | null | undefined): Promise<GridOwnerVerification | null> {
  if (!gridOwnerId) return null

  const view = await supabaseService
    .from('gridex_verified_grid_owners_v')
    .select('grid_owner_id,name,ediel_id,org_number,verification_status,certificate_status,verified_for_customer_flow,route_count,prodat_route_count,utilts_route_count,duplicate_count,verification_reasons,next_action')
    .eq('grid_owner_id', gridOwnerId)
    .maybeSingle()

  if (!view.error) return mapVerification(view.data as Record<string, unknown> | null)
  if (!missingSchema(view.error)) throw view.error

  const fallback = await supabaseService
    .from('grid_owners')
    .select('id,name,ediel_id,org_number,verification_status,certificate_status,verified_for_customer_flow,route_count,prodat_route_count,utilts_route_count,duplicate_count,verification_reasons')
    .eq('id', gridOwnerId)
    .maybeSingle()

  if (fallback.error) {
    if (missingSchema(fallback.error)) return null
    throw fallback.error
  }

  return mapVerification(fallback.data as Record<string, unknown> | null)
}

export async function assertGridOwnerVerifiedForSwitch(gridOwnerId: string | null | undefined): Promise<GridOwnerVerification> {
  const verification = await getGridOwnerVerification(gridOwnerId)
  if (!verification) throw new Error('grid_owner_verification_missing')
  if (!verification.verifiedForCustomerFlow || verification.verificationStatus !== 'verified') {
    throw new Error(`grid_owner_not_verified:${verification.verificationStatus}`)
  }
  return verification
}

export async function runGridOwnerVerificationBackfill(source = 'server_action') {
  const { data, error } = await supabaseService.rpc('gridex_backfill_grid_owner_verification', { p_source: source })
  if (error) throw error
  return data as Record<string, unknown> | null
}
