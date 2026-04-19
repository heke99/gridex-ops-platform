import { supabaseService } from '@/lib/supabase/service'
import type { CommunicationRouteRow, OutboundRequestType } from '@/lib/cis/types'
import { matchesQuery, normalizeQuery } from './db-shared'

export async function listCommunicationRoutes(options: {
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
  id?: string
  routeName: string
  isActive: boolean
  routeScope: 'supplier_switch' | 'meter_values' | 'billing_underlay'
  routeType: 'partner_api' | 'ediel_partner' | 'file_export' | 'email_manual'
  gridOwnerId?: string | null
  targetSystem: string
  endpoint?: string | null
  targetEmail?: string | null
  supportedPayloadVersion?: string | null
  notes?: string | null
}): Promise<CommunicationRouteRow> {
  const payload = {
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
    const { data, error } = await supabaseService
      .from('communication_routes')
      .update(payload)
      .eq('id', input.id)
      .select('*')
      .single()

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
  requestType: OutboundRequestType
  gridOwnerId?: string | null
}): Promise<CommunicationRouteRow | null> {
  const scope = params.requestType

  if (params.gridOwnerId) {
    const { data, error } = await supabaseService
      .from('communication_routes')
      .select('*')
      .eq('route_scope', scope)
      .eq('is_active', true)
      .eq('grid_owner_id', params.gridOwnerId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) throw error
    const scoped = (data ?? []) as CommunicationRouteRow[]
    if (scoped[0]) return scoped[0]
  }

  const { data, error } = await supabaseService
    .from('communication_routes')
    .select('*')
    .eq('route_scope', scope)
    .eq('is_active', true)
    .is('grid_owner_id', null)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return ((data ?? []) as CommunicationRouteRow[])[0] ?? null
}