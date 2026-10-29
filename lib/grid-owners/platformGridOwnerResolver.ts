import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'

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

/**
 * Grid owner rows a tenant may use for an exact key such as an Ediel id or a
 * grid area code (FINDINGS F101 variants; same rule as F58 below): the
 * tenant's own rows first and, only when it has none, the shared registry rows
 * (company_id null). Another tenant's row is never returned. The result is the
 * first non-empty tier (at most `limit` rows), so every caller keeps its own
 * "exactly one, never guess" rule and an ambiguous own tier never falls
 * through to a shared row.
 */
export async function selectTenantUsableGridOwners<T>(input: {
  companyId: string
  select: string
  match: Record<string, string | boolean>
  limit?: number
}): Promise<T[]> {
  const limit = input.limit ?? 2
  const db = tenantDb(input.companyId)
  const scoped = (shared: boolean) => {
    // The shared registry tier is deliberate; it must not inherit an own-company predicate.
    let query = (shared
      ? db.unscoped().from('grid_owners').select(input.select).is('company_id', null)
      : db.from('grid_owners').select(input.select)) as ReturnType<ReturnType<typeof supabaseService.from>['select']>
    for (const [column, value] of Object.entries(input.match)) query = query.eq(column, value)
    return query.limit(limit)
  }
  const own = await scoped(false)
  if (own.error) throw own.error
  if (own.data?.length) return own.data as unknown as T[]
  const shared = await scoped(true)
  if (shared.error) throw shared.error
  return (shared.data ?? []) as unknown as T[]
}

/** Current admission date for Swedish registry lifecycle checks. This clock is
 * not a claimed message receipt date or source/tenant authorization. */
export function currentGridRegistryDate(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/**
 * The grid owner a tenant may use for a wire grid area code (FINDINGS F114). In the registry model (F41) grid owner
 * rows carry `owner_code` = the Ediel id, so an area code no longer names a grid owner row; the area is mapped by
 * platform_grid_areas (active, inside its validity window) -> platform_grid_owners (active) -> ops_grid_owner_id.
 *   1. The tenant's own grid_owners row whose owner_code is the area code (the legacy convention), when one exists.
 *      Two own rows are ambiguous and never fall through.
 *   2. Otherwise every shared candidate: a shared row (company_id null) whose owner_code is the area code, and, with
 *      `registryArea`, the area's mapped grid owner when that row is the tenant's own or a shared row.
 * Exactly one distinct candidate is returned; none or several give null. Another tenant's row is never returned.
 */
export async function selectTenantGridOwnerIdForGridArea(input: {
  companyId: string
  gridAreaCode: string | null | undefined
  registryArea: boolean
  today?: string
}): Promise<string | null> {
  const code = typeof input.gridAreaCode === 'string' ? input.gridAreaCode.trim() : ''
  if (!code) return null
  const today = input.today ?? currentGridRegistryDate()
  const byCode = await selectTenantUsableGridOwners<{ id: string; company_id: string | null }>({
    companyId: input.companyId, select: 'id,company_id', match: { owner_code: code, is_active: true },
  })
  if (byCode.some(row => row.company_id === input.companyId)) return byCode.length === 1 ? byCode[0].id : null
  const candidates = new Set(byCode.map(row => row.id))
  if (candidates.size > 1) return null
  if (input.registryArea) {
    const mapped = await selectRegistryAreaGridOwnerId(input.companyId, code.replace(/\s+/g, '').toUpperCase(), today)
    if (mapped === 'ambiguous') return null
    if (mapped) {
      const usable = await selectTenantUsableGridOwners<{ id: string }>({
        companyId: input.companyId, select: 'id', match: { id: mapped, is_active: true },
      })
      for (const row of usable) candidates.add(row.id)
    }
  }
  return candidates.size === 1 ? [...candidates][0] : null
}

/** OPS grid owner id the platform registry maps an area code to, unscoped; tenant usability is checked by the caller. */
async function selectRegistryAreaGridOwnerId(companyId: string, code: string, today: string): Promise<string | 'ambiguous' | null> {
  // These platform catalogs have no company_id; the caller checks the mapped OPS row's tenant usability.
  const areas = await tenantDb(companyId).unscoped()
    .from('platform_grid_areas')
    .select('grid_owner_id,valid_from,valid_to')
    .eq('grid_area_code', code)
    .eq('is_active', true)
    .limit(2)
  if (areas.error) throw areas.error
  const current = ((areas.data ?? []) as Array<{ grid_owner_id: string | null; valid_from: string | null; valid_to: string | null }>)
    .filter(area => (!area.valid_from || area.valid_from <= today) && (!area.valid_to || area.valid_to >= today))
  if (current.length > 1) return 'ambiguous'
  const platformId = current[0]?.grid_owner_id
  if (!platformId) return null
  const owner = await tenantDb(companyId).unscoped()
    .from('platform_grid_owners')
    .select('ops_grid_owner_id')
    .eq('id', platformId)
    .eq('is_active', true)
    .maybeSingle()
  if (owner.error) throw owner.error
  const opsId = (owner.data as { ops_grid_owner_id?: string | null } | null)?.ops_grid_owner_id
  return typeof opsId === 'string' && opsId.trim() ? opsId.trim() : null
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
  // A shared registry grid owner (company_id null) or the tenant's own; never another tenant's (FINDINGS F58).
  if (input.companyId) opsQuery = opsQuery.or(`company_id.is.null,company_id.eq.${input.companyId}`)
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
