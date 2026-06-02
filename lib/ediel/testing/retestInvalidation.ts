import { supabaseService } from '@/lib/supabase/service'

function isSchemaCompatibilityError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return (
    maybe?.code === '42P01' ||
    maybe?.code === '42703' ||
    maybe?.code === 'PGRST204' ||
    maybe?.code === 'PGRST205' ||
    /does not exist|schema cache|column/i.test(maybe?.message ?? '')
  )
}

export async function invalidateEdielAgtReadiness(input: {
  companyId: string
  actorRole?: string | null
  messageFamily?: string | null
  sourceType: 'route_change' | 'certificate_change' | 'actor_change' | 'security_policy_change' | 'edi_system_change' | 'ombud_status_change' | string
  sourceId?: string | null
  reason: string
  actorUserId?: string | null
}) {
  let query = supabaseService
    .from('ediel_agt_readiness')
    .update({
      needs_retest: true,
      retest_reason: input.reason,
      invalidated_at: new Date().toISOString(),
      invalidated_by: input.actorUserId ?? null,
      invalidation_source: input.sourceType,
      updated_by: input.actorUserId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', input.companyId)

  if (input.actorRole) query = query.eq('actor_role', input.actorRole)
  if (input.messageFamily) query = query.eq('message_family', input.messageFamily)

  const { error } = await query
  if (error && !isSchemaCompatibilityError(error)) throw error

  const { error: eventError } = await supabaseService
    .from('ediel_retest_invalidations')
    .insert({
      company_id: input.companyId,
      actor_role: input.actorRole ?? null,
      message_family: input.messageFamily ?? null,
      source_type: input.sourceType,
      source_id: input.sourceId ?? null,
      reason: input.reason,
      created_by: input.actorUserId ?? null,
    })

  if (eventError && !isSchemaCompatibilityError(eventError)) throw eventError

  await supabaseService
    .from('audit_logs')
    .insert({
      company_id: input.companyId,
      entity_type: 'ediel_agt_readiness',
      entity_id: input.sourceId ?? input.companyId,
      action: 'ediel_agt_retest_required',
      metadata: {
        actorRole: input.actorRole ?? null,
        messageFamily: input.messageFamily ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        reason: input.reason,
      },
      created_by: input.actorUserId ?? null,
    })
    .then(({ error: auditError }) => {
      if (auditError && !isSchemaCompatibilityError(auditError)) throw auditError
    })
}
