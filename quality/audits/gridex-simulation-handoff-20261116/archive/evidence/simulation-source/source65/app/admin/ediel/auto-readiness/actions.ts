'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { applyActorAutoSendReadiness, confirmSafeBlankRouteSubaddresses, refreshActorCertificateStatuses, runActorReadinessBackfill } from '@/lib/ediel/operations/actorAutoReadiness'
import { supabaseService } from '@/lib/supabase/service'

async function auditAutoReadinessAction(input: {
  userId: string
  action: string
  metadata?: Record<string, unknown>
}) {
  await supabaseService
    .from('audit_logs')
    .insert({
      actor_user_id: input.userId,
      action: input.action,
      entity_type: 'platform_actor_auto_readiness',
      entity_id: 'system',
      metadata: input.metadata ?? {},
      created_at: new Date().toISOString(),
    })
    .then((result) => {
      if (result.error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(result.error.code ?? '')) throw result.error
    })
}

function revalidateAutoReadiness() {
  revalidatePath('/admin/ediel/auto-readiness')
  revalidatePath('/admin/ediel/route-readiness')
  revalidatePath('/admin/ediel/routes')
  revalidatePath('/admin/ediel/actors')
}

async function recordFailedAutoReadinessAction(input: {
  userId: string
  action: string
  error: unknown
}) {
  await auditAutoReadinessAction({
    userId: input.userId,
    action: `${input.action}.failed`,
    metadata: {
      error: input.error instanceof Error ? input.error.message : String(input.error),
    },
  }).catch(() => undefined)
}


export async function confirmSafeBlankSubaddressesAction() {
  const context = await requirePlatformAdminActionAccess()
  try {
    const result = await confirmSafeBlankRouteSubaddresses('manual_actor_check', null, true)
    await auditAutoReadinessAction({
      userId: context.userId,
      action: 'actor_auto_readiness.confirm_safe_blank_subaddresses_manual',
      metadata: { result },
    })
  } catch (error) {
    await recordFailedAutoReadinessAction({ userId: context.userId, action: 'actor_auto_readiness.confirm_safe_blank_subaddresses_manual', error })
  }
  revalidateAutoReadiness()
}

export async function runActorReadinessBackfillAction() {
  const context = await requirePlatformAdminActionAccess()
  try {
    const result = await runActorReadinessBackfill('manual_actor_check')
    await auditAutoReadinessAction({
      userId: context.userId,
      action: 'actor_auto_readiness.backfill_manual',
      metadata: { result },
    })
  } catch (error) {
    await recordFailedAutoReadinessAction({ userId: context.userId, action: 'actor_auto_readiness.backfill_manual', error })
  }
  revalidateAutoReadiness()
}

export async function refreshActorCertificatesAction() {
  const context = await requirePlatformAdminActionAccess()
  try {
    const result = await refreshActorCertificateStatuses('manual_actor_check')
    await auditAutoReadinessAction({
      userId: context.userId,
      action: 'actor_auto_readiness.certificate_refresh_manual',
      metadata: { result },
    })
  } catch (error) {
    await recordFailedAutoReadinessAction({ userId: context.userId, action: 'actor_auto_readiness.certificate_refresh_manual', error })
  }
  revalidateAutoReadiness()
}

export async function applyActorAutoSendReadinessAction() {
  const context = await requirePlatformAdminActionAccess()
  try {
    const result = await applyActorAutoSendReadiness()
    await auditAutoReadinessAction({
      userId: context.userId,
      action: 'actor_auto_readiness.apply_auto_send_manual',
      metadata: { result },
    })
  } catch (error) {
    await recordFailedAutoReadinessAction({ userId: context.userId, action: 'actor_auto_readiness.apply_auto_send_manual', error })
  }
  revalidateAutoReadiness()
}
