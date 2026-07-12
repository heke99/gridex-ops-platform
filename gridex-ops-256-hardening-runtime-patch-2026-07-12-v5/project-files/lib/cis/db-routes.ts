import { supabaseService } from '@/lib/supabase/service'
import type { CommunicationRouteRow, CommunicationRouteScope, OutboundRequestType } from '@/lib/cis/types'
import { matchesQuery, normalizeQuery } from './db-shared'

export async function listCommunicationRoutes(options: {
  companyId?: string | null
  scope?: string | null
  routeScope?: string | null
  routeType?: string | null
  query?: string | null
} = {}): Promise<CommunicationRouteRow[]> {
  let queryBuilder = supabaseService
    .from('communication_routes')
    .select('*')
    .order('created_at', { ascending: false })

  const resolvedScope = options.routeScope ?? options.scope ?? null

  if (options.companyId) {
    queryBuilder = queryBuilder.or(`company_id.is.null,company_id.eq.${options.companyId}`)
  }

  if (resolvedScope && resolvedScope !== 'all') {
    queryBuilder = queryBuilder.eq('route_scope', resolvedScope)
  }

  if (options.routeType && options.routeType !== 'all') {
    queryBuilder = queryBuilder.eq('route_type', options.routeType)
  }

  const { data, error } = await queryBuilder
  if (error) throw error

  const rows = (data ?? []) as CommunicationRouteRow[]
  const query = normalizeQuery(options.query)

  return rows.filter((row) =>
    matchesQuery(
      [
        row.id,
        row.route_name,
        row.route_scope,
        row.route_type,
        row.target_system,
        row.endpoint,
        row.target_email,
        row.grid_owner_id,
        row.notes,
      ],
      query
    )
  )
}

export async function saveCommunicationRoute(input: {
  actorUserId: string
  companyId?: string | null
  id?: string
  routeName: string
  isActive: boolean
  routeScope: CommunicationRouteScope
  routeType: 'partner_api' | 'ediel_partner' | 'file_export' | 'email_manual'
  gridOwnerId?: string | null
  targetSystem: string
  endpoint?: string | null
  targetEmail?: string | null
  supportedPayloadVersion?: string | null
  notes?: string | null
}): Promise<CommunicationRouteRow> {
  const payload = {
    company_id: input.companyId ?? null,
    route_name: input.routeName,
    is_active: input.isActive,
    route_scope: input.routeScope,
    route_type: input.routeType,
    grid_owner_id: input.gridOwnerId ?? null,
    target_system: input.targetSystem,
    endpoint: input.endpoint ?? null,
    target_email: input.targetEmail ?? null,
    supported_payload_version: input.supportedPayloadVersion ?? null,
    notes: input.notes ?? null,
    updated_by: input.actorUserId,
  }

  if (input.id) {
    let query = supabaseService
      .from('communication_routes')
      .update(payload)
      .eq('id', input.id)

    // Company-scoped admins must never update platform/global routes.
    // Platform admins may pass null companyId for global routes.
    if (input.companyId) {
      query = query.eq('company_id', input.companyId)
    }

    const { data, error } = await query.select('*').single()

    if (error) throw error
    return data as CommunicationRouteRow
  }

  const { data, error } = await supabaseService
    .from('communication_routes')
    .insert({
      ...payload,
      created_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as CommunicationRouteRow
}

export async function findBestCommunicationRoute(params: {
  companyId?: string | null
  requestType: OutboundRequestType
  gridOwnerId?: string | null
}): Promise<CommunicationRouteRow | null> {
  const selectUniqueTier = (rows: CommunicationRouteRow[], label: string): CommunicationRouteRow | null => {
    const tenantRows = params.companyId
      ? rows.filter((row) => row.company_id === params.companyId)
      : []
    const globalRows = rows.filter((row) => row.company_id === null)
    const selected = tenantRows.length > 0 ? tenantRows : globalRows
    if (selected.length > 1) {
      throw new Error(`communication_route_ambiguous:${label}:${selected.map((row) => row.id).join(',')}`)
    }
    return selected[0] ?? null
  }

  const load = async (gridOwnerId: string | null): Promise<CommunicationRouteRow[]> => {
    let query = supabaseService
      .from('communication_routes')
      .select('*')
      .eq('route_scope', params.requestType)
      .eq('is_active', true)

    query = gridOwnerId ? query.eq('grid_owner_id', gridOwnerId) : query.is('grid_owner_id', null)
    if (params.companyId) {
      query = query.or(`company_id.is.null,company_id.eq.${params.companyId}`)
    } else {
      query = query.is('company_id', null)
    }

    const { data, error } = await query.order('updated_at', { ascending: false }).limit(20)
    if (error) throw error
    return (data ?? []) as CommunicationRouteRow[]
  }

  if (params.gridOwnerId) {
    const exact = selectUniqueTier(await load(params.gridOwnerId), 'grid_owner')
    if (exact) return exact
  }

  return selectUniqueTier(await load(null), 'generic')
}
