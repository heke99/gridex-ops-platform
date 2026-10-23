import { supabaseService } from '@/lib/supabase/service'
import { isMissingSchemaError } from '@/lib/launch/readiness'

export type CompanyRouteReadinessListRow = {
  company_id: string
  grid_owner_id: string | null
  grid_owner_name: string | null
  grid_owner_ediel_id: string | null
  platform_actor_route_id: string | null
  message_family: string | null
  message_code: string | null
  environment: string | null
  operational_route_ready: boolean | null
  send_ready: boolean | null
  blocker_code: string | null
  readiness_message: string | null
  sender_settings_id: string | null
  production_send_lock_status: string | null
}

export type CompanyRouteFilters = {
  query: string | null
  environment: string | null
  messageFamily: string | null
  messageCode: string | null
  blockerCode: string | null
  /** One tenant's blocked routes (?company=<uuid>); anything that is not a UUID is ignored. */
  companyId: string | null
}

/** Rows shown per page; a list cut at this size says so instead of silently hiding tenants (FINDINGS F110). */
export const COMPANY_ROUTE_READINESS_LIMIT = 500

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function companyRouteFilterCompanyId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return UUID.test(trimmed) ? trimmed.toLowerCase() : null
}

/**
 * Tenants' routes that still need an operator action. With hundreds of tenants one grid owner alone has more blocked
 * rows than a page holds, so a newer tenant's routes fell beyond the limit and could never be materialized from here
 * (FINDINGS F110): the list can be narrowed to one company and reports when it was cut.
 */
export async function loadCompanyRouteReadiness(filters: CompanyRouteFilters): Promise<{ rows: CompanyRouteReadinessListRow[]; truncated: boolean }> {
  let query = supabaseService
    .from('gridex_company_route_readiness_v')
    .select('company_id, grid_owner_id, grid_owner_name, grid_owner_ediel_id, platform_actor_route_id, message_family, message_code, environment, operational_route_ready, send_ready, blocker_code, readiness_message, sender_settings_id, production_send_lock_status')
    .or('operational_route_ready.eq.false,send_ready.eq.false')

  if (filters.companyId) query = query.eq('company_id', filters.companyId)
  if (filters.environment) query = query.eq('environment', filters.environment)
  if (filters.messageFamily) query = query.eq('message_family', filters.messageFamily)
  if (filters.messageCode) query = query.eq('message_code', filters.messageCode)
  if (filters.blockerCode) query = query.eq('blocker_code', filters.blockerCode)
  if (filters.query) {
    const escaped = filters.query.replace(/[%,]/g, ' ').trim()
    query = query.or(`grid_owner_name.ilike.%${escaped}%,grid_owner_ediel_id.ilike.%${escaped}%`)
  }

  const result = await query
    .order('environment', { ascending: true })
    .order('grid_owner_name', { ascending: true })
    .order('company_id', { ascending: true })
    .limit(COMPANY_ROUTE_READINESS_LIMIT + 1)

  if (result.error) {
    if (isMissingSchemaError(result.error)) return { rows: [], truncated: false }
    throw result.error
  }
  const rows = (result.data ?? []) as CompanyRouteReadinessListRow[]
  return { rows: rows.slice(0, COMPANY_ROUTE_READINESS_LIMIT), truncated: rows.length > COMPANY_ROUTE_READINESS_LIMIT }
}
