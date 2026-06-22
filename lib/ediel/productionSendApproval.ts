import { supabaseService } from '@/lib/supabase/service'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

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

  let query = supabaseService
    .from('ediel_actor_settings')
    .select('id,production_send_lock_enabled,first_production_send_approved,ediel_id,actor_ediel_id,role,actor_role,market_roles,is_active')
    .eq('company_id', params.companyId)
    .eq('environment', 'production')
    .eq('is_active', true)

  const sender = clean(params.senderEdielId)
  if (sender) query = query.or(`ediel_id.eq.${sender},actor_ediel_id.eq.${sender}`)

  const { data, error } = await query.limit(10)
  if (error) {
    if (schemaCompatibilityError(error)) return null
    throw error
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const relevant = rows.find((row) => {
    const role = String(row.role ?? row.actor_role ?? '').toLowerCase()
    const roles = Array.isArray(row.market_roles) ? row.market_roles.map((item) => String(item).toLowerCase()) : []
    return !role || role === 'supplier' || role === 'electricity_supplier' || roles.includes('supplier') || roles.includes('electricity_supplier')
  }) ?? rows[0]

  if (!relevant) return 'production_sender_settings_missing'
  if (relevant.production_send_lock_enabled === true && relevant.first_production_send_approved !== true) {
    return 'production_send_locked'
  }
  return null
}

// Merge existing metadata into the approval stamp so prior keys are preserved.
async function mergeApprovalMetadataUpdate(params: {
  actorUserId: string
  companyId: string
  actorSettingId?: string | null
  reason?: string | null
  now: string
}): Promise<void> {
  const approvalStamp = {
    production_send_approved_by: params.actorUserId,
    production_send_approved_at: params.now,
    production_send_approval_reason: params.reason ?? 'Första produktionssändningen godkänd av platform admin.',
  }

  let selectQuery = supabaseService
    .from('ediel_actor_settings')
    .select('id,metadata')
    .eq('company_id', params.companyId)
    .eq('environment', 'production')
    .eq('is_active', true)
  if (params.actorSettingId) selectQuery = selectQuery.eq('id', params.actorSettingId)

  const existing = await selectQuery.limit(50)
  if (existing.error) {
    if (schemaCompatibilityError(existing.error)) {
      const fallback = await supabaseService
        .from('ediel_actor_settings')
        .update({ first_production_send_approved: true, production_send_lock_enabled: false, updated_at: params.now })
        .eq('company_id', params.companyId)
        .eq('environment', 'production')
      if (fallback.error && !schemaCompatibilityError(fallback.error)) throw fallback.error
      return
    }
    throw existing.error
  }

  for (const row of (existing.data ?? []) as Array<{ id: string; metadata?: unknown }>) {
    const currentMetadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {}
    const update = await supabaseService
      .from('ediel_actor_settings')
      .update({
        first_production_send_approved: true,
        production_send_lock_enabled: false,
        updated_at: params.now,
        metadata: { ...currentMetadata, ...approvalStamp },
      })
      .eq('id', row.id)
    if (update.error && !schemaCompatibilityError(update.error)) throw update.error
  }
}

export async function approveFirstProductionSend(params: {
  actorUserId: string
  companyId: string
  actorSettingId?: string | null
  reason?: string | null
}): Promise<void> {
  const now = new Date().toISOString()

  // Prefer the SECURITY DEFINER RPC which merges metadata (|| jsonb) and records
  // an immutable approval row scoped to company/environment.
  const rpc = await supabaseService.rpc('gridex_approve_first_production_send', {
    p_company_id: params.companyId,
    p_actor_setting_id: params.actorSettingId ?? null,
    p_actor_user_id: params.actorUserId,
    p_reason: params.reason ?? null,
  })

  if (rpc.error) {
    // Compatibility fallback for environments where the RPC is not deployed yet:
    // still merge (never overwrite) existing metadata.
    if (!schemaCompatibilityError(rpc.error) && !/function .* does not exist|Could not find the function/i.test(String(rpc.error.message ?? ''))) {
      throw rpc.error
    }
    await mergeApprovalMetadataUpdate({ ...params, now })
  }

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
