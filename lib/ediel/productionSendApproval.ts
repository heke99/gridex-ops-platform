import { supabaseService } from '@/lib/supabase/service'

function schemaCompatibilityError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

export async function getProductionSendApprovalBlocker(params: {
  companyId?: string | null
  environment?: string | null
  senderEdielId?: string | null
  messageFamily?: string | null
}): Promise<string | null> {
  if (params.environment !== 'production') return null
  if (!params.companyId) return 'missing_company_scope_for_production_send'

  const { data, error } = await supabaseService
    .from('ediel_production_state')
    .select('state,first_live_send_approved_at')
    .eq('company_id', params.companyId)
    .maybeSingle()
  if (error) {
    throw error
  }
  if (!data) return 'canonical_production_state_missing'
  if (data.state !== 'live') return `canonical_production_not_live:${data.state ?? 'unknown'}`
  if (!data.first_live_send_approved_at) return 'first_live_send_approval_required'
  return null
}

export async function approveFirstProductionSend(params: {
  actorUserId: string
  companyId: string
  actorSettingId?: string | null
  reason?: string | null
}): Promise<void> {
  const now = new Date().toISOString()
  const state = await supabaseService
    .from('ediel_production_state')
    .select('state,readiness_check_id')
    .eq('company_id', params.companyId)
    .maybeSingle()
  if (state.error) throw state.error
  if (state.data?.state !== 'live' || !state.data.readiness_check_id) {
    throw new Error('canonical_live_state_and_readiness_required_for_first_send_approval')
  }
  const rpc = await supabaseService.rpc('canonical_approve_first_live_send', {
    p_company_id: params.companyId,
    p_readiness_check_id: state.data.readiness_check_id,
    p_actor_user_id: params.actorUserId,
    p_idempotency_key: `first-live-send:${params.companyId}:${crypto.randomUUID()}`,
  })
  if (rpc.error) throw rpc.error

  await supabaseService
    .from('audit_logs')
    .insert({
      action: 'ediel.production_send_approved',
      actor_user_id: params.actorUserId,
      entity_type: 'companies',
      entity_id: params.companyId,
      metadata: {
        company_id: params.companyId,
        environment: 'production',
        actor_setting_id: params.actorSettingId ?? null,
        reason: params.reason ?? null,
      },
      created_at: now,
    })
    .then((result) => {
      if (result.error && !schemaCompatibilityError(result.error)) throw result.error
    })
}
