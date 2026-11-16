import { supabaseService } from '@/lib/supabase/service'

export type CompanyRouteReadinessRow = {
  company_id: string
  grid_owner_id: string | null
  grid_owner_name: string | null
  grid_owner_ediel_id: string | null
  platform_market_actor_id: string | null
  platform_actor_route_id: string | null
  message_family: string | null
  message_code: string | null
  environment: string | null
  actor_registry_ready: boolean | null
  platform_route_ready: boolean | null
  operational_route_ready: boolean | null
  send_ready: boolean | null
  blocker_code: string | null
  readiness_message: string | null
  communication_route_id: string | null
  ediel_route_profile_id: string | null
  company_market_party_route_id: string | null
  sender_settings_id: string | null
  production_send_lock_status: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

export async function getCompanyGridOwnerRouteReadiness(params: {
  companyId: string
  gridOwnerId: string
  messageFamily?: string | null
  messageCode?: string | null
  environment?: 'test' | 'production' | string | null
}): Promise<CompanyRouteReadinessRow | null> {
  let query = supabaseService
    .from('gridex_company_route_readiness_v')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('grid_owner_id', params.gridOwnerId)
    .eq('message_family', params.messageFamily ?? 'PRODAT')

  const messageCode = clean(params.messageCode)
  if (messageCode) query = query.eq('message_code', messageCode)
  const environment = clean(params.environment)
  if (environment) query = query.eq('environment', environment)

  const { data, error } = await query
    .order('operational_route_ready', { ascending: false })
    .order('send_ready', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return (data as CompanyRouteReadinessRow | null) ?? null
}
