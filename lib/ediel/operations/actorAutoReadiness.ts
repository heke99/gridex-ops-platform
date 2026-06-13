import { supabaseService } from '@/lib/supabase/service'

export type ActorReadinessRunResult = {
  ok: boolean
  run_id?: string
  actors_backfilled?: number
  routes_verified?: number
  certificates_refreshed?: number
  missing_certificate_placeholders_created?: number
  auto_enabled_count?: number
  auto_disabled_count?: number
  error?: string
  [key: string]: unknown
}

type RpcResult = ActorReadinessRunResult | string | null

function parseRpcResult(data: RpcResult): ActorReadinessRunResult {
  if (!data) return { ok: true }
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as ActorReadinessRunResult
    } catch {
      return { ok: true, raw: data }
    }
  }
  return data
}

export async function runActorReadinessBackfill(runType: 'nightly_backfill' | 'manual_actor_check' | 'xml_import_followup' | 'manual' = 'manual_actor_check') {
  const result = await supabaseService.rpc('gridex_actor_readiness_backfill', { p_run_type: runType })
  if (result.error) throw result.error
  return parseRpcResult(result.data as RpcResult)
}

export async function refreshActorCertificateStatuses(runType: 'certificate_refresh' | 'manual_actor_check' | 'manual' = 'certificate_refresh') {
  const result = await supabaseService.rpc('gridex_refresh_actor_certificate_statuses', { p_run_type: runType })
  if (result.error) throw result.error
  return parseRpcResult(result.data as RpcResult)
}

export async function applyActorAutoSendReadiness() {
  const result = await supabaseService.rpc('gridex_apply_actor_auto_send_readiness')
  if (result.error) throw result.error
  return parseRpcResult(result.data as RpcResult)
}

export async function runFullActorAutoReadiness() {
  const backfill = await runActorReadinessBackfill('nightly_backfill')
  const autoSend = await applyActorAutoSendReadiness()
  return {
    ok: true,
    backfill,
    autoSend,
  }
}

export type ActorSendReadinessRow = {
  actor_id: string
  actor_name: string | null
  legal_name: string | null
  org_number: string | null
  actor_status: string | null
  match_status: string | null
  visible_to_tenants: boolean | null
  actor_roles: string[] | null
  ediel_id: string | null
  ediel_id_verified: boolean | null
  route_id: string
  message_family: string | null
  application_reference: string | null
  environment: string | null
  subaddress: string | null
  communication_type: string | null
  communication_address: string | null
  party_id: string | null
  interchange_party_id: string | null
  route_status: string | null
  route_verified: boolean | null
  auto_send_allowed: boolean | null
  requires_certificate: boolean | null
  certificate_id: string | null
  certificate_status: string | null
  certificate_fingerprint_sha256: string | null
  certificate_subject: string | null
  certificate_issuer: string | null
  certificate_valid_from: string | null
  certificate_valid_to: string | null
  certificate_last_checked_at: string | null
  certificate_next_check_at: string | null
  blocking_reasons: string[] | null
  warnings: string[] | null
  readiness_status: string | null
  last_checked_at: string | null
  next_check_at: string | null
}

export async function listActorSendReadiness(limit = 500): Promise<ActorSendReadinessRow[]> {
  const result = await supabaseService
    .from('platform_actor_send_readiness_v')
    .select('*')
    .order('readiness_status', { ascending: true })
    .order('actor_name', { ascending: true })
    .limit(limit)

  if (result.error) {
    if (['42P01', '42703', 'PGRST205'].includes(result.error.code ?? '')) return []
    throw result.error
  }

  return (result.data ?? []) as ActorSendReadinessRow[]
}
