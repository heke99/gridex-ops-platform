import { supabaseService } from '@/lib/supabase/service'

type JsonRecord = Record<string, unknown>

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

/**
 * Resolves a platform grid owner row when the caller may hold either namespace:
 * customer_sites.grid_owner_id stores the OPS `grid_owners.id`, while Ediel
 * routing needs the `platform_grid_owners` row. The bridge is
 * platform_grid_owners.ops_grid_owner_id (batch O grid owner verification).
 *
 * Lookup order: platform id first, then the OPS bridge. Returns null when no
 * platform row matches either namespace.
 */
export async function resolvePlatformGridOwnerByAnyId(input: {
  gridOwnerId: string | null | undefined
  select?: string
}): Promise<JsonRecord | null> {
  const id = typeof input.gridOwnerId === 'string' && input.gridOwnerId.trim() ? input.gridOwnerId.trim() : null
  if (!id) return null

  const select = input.select ?? 'id,name,ediel_id,owner_code,platform_market_actor_id,ops_grid_owner_id'

  const byPlatformId = await supabaseService
    .from('platform_grid_owners')
    .select(select)
    .eq('id', id)
    .maybeSingle()

  if (byPlatformId.error) {
    if (!missingSchema(byPlatformId.error)) throw byPlatformId.error
    return null
  }
  if (byPlatformId.data) return byPlatformId.data as unknown as JsonRecord

  const byOpsId = await supabaseService
    .from('platform_grid_owners')
    .select(select)
    .eq('ops_grid_owner_id', id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (byOpsId.error) {
    if (missingSchema(byOpsId.error)) return null
    throw byOpsId.error
  }
  return (byOpsId.data as unknown as JsonRecord | null) ?? null
}

export type OpsGridOwnerNormalization = {
  opsGridOwnerId: string | null
  source: 'ops' | 'platform_mapped' | 'platform_unmapped' | 'unknown' | 'none'
  warnings: string[]
}

/**
 * Normalizes any submitted grid owner id to the OPS namespace.
 *
 * customer_sites.grid_owner_id must ALWAYS reference grid_owners.id (OPS).
 * Callers can receive a platform_grid_owners.id from external input; that id
 * must be bridged via platform_grid_owners.ops_grid_owner_id, never written
 * directly. Unknown or unmappable ids resolve to null with a precise warning
 * so downstream readiness surfaces the correct blocker instead of storing a
 * wrong-namespace id.
 */
export async function normalizeGridOwnerIdToOps(input: {
  gridOwnerId: string | null | undefined
  companyId?: string | null
}): Promise<OpsGridOwnerNormalization> {
  const id = typeof input.gridOwnerId === 'string' && input.gridOwnerId.trim() ? input.gridOwnerId.trim() : null
  if (!id) return { opsGridOwnerId: null, source: 'none', warnings: [] }

  let opsQuery = supabaseService.from('grid_owners').select('id').eq('id', id)
  if (input.companyId) opsQuery = opsQuery.eq('company_id', input.companyId)
  const ops = await opsQuery.maybeSingle()
  if (ops.error && !missingSchema(ops.error)) throw ops.error
  if (ops.data) return { opsGridOwnerId: id, source: 'ops', warnings: [] }

  const platform = await supabaseService
    .from('platform_grid_owners')
    .select('id,ops_grid_owner_id')
    .eq('id', id)
    .maybeSingle()
  if (platform.error && !missingSchema(platform.error)) throw platform.error
  const platformRow = platform.data as { id?: string; ops_grid_owner_id?: string | null } | null
  if (platformRow?.id) {
    const opsId = typeof platformRow.ops_grid_owner_id === 'string' && platformRow.ops_grid_owner_id.trim()
      ? platformRow.ops_grid_owner_id.trim()
      : null
    if (opsId) {
      return { opsGridOwnerId: opsId, source: 'platform_mapped', warnings: ['explicit_platform_grid_owner_id_mapped_to_ops'] }
    }
    return { opsGridOwnerId: null, source: 'platform_unmapped', warnings: ['platform_to_ops_grid_owner_mapping_missing'] }
  }

  return { opsGridOwnerId: null, source: 'unknown', warnings: ['explicit_grid_owner_id_not_in_ops_masterdata'] }
}
