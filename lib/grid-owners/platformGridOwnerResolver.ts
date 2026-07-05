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
