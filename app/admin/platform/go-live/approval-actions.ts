'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { getCompanyProductionReadiness, runProductionDryRun } from '@/lib/ediel/productionReadiness'
import { supabaseService } from '@/lib/supabase/service'

function required(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? '').trim()
  if (!value) throw new Error(`${key} saknas.`)
  return value
}

function returnPath(formData: FormData, companyId: string): string {
  const value = String(formData.get('redirect_to') ?? '').trim()
  return value.startsWith('/admin/') ? value : `/admin/platform/go-live/${companyId}`
}

function revalidate(companyId: string) {
  revalidatePath(`/admin/platform/go-live/${companyId}`)
  revalidatePath(`/admin/companies/${companyId}`)
  revalidatePath('/admin/platform/go-live')
  revalidatePath('/admin/platform/work-queue')
}

export async function approveCompanyProductionAction(formData: FormData) {
  const companyId = required(formData, 'company_id')
  const target = returnPath(formData, companyId)
  const admin = await requirePlatformAdminActionAccess()

  try {
    const preflight = await getCompanyProductionReadiness(companyId, {
      checkedBy: admin.userId,
      persist: true,
    })

    if (preflight.blockingIssues.length > 0) {
      throw new Error(
        `Bolaget kan inte godkännas: ${preflight.blockingIssues.map((issue) => issue.message).join(' · ')}`,
      )
    }

    const dryRun = await runProductionDryRun(companyId, admin.userId)
    if (!dryRun.success) {
      throw new Error(
        `Production dry run blockerades: ${dryRun.blockingIssues.map((issue) => issue.message).join(' · ')}`,
      )
    }

    // Read once more after dry-run so transition uses the newest persisted
    // readiness row and the current, non-stale dry-run for the same snapshot.
    const readiness = await getCompanyProductionReadiness(companyId, {
      checkedBy: admin.userId,
      persist: true,
    })

    if (readiness.blockingIssues.length > 0) {
      throw new Error(
        `Bolaget kan inte aktiveras: ${readiness.blockingIssues.map((issue) => issue.message).join(' · ')}`,
      )
    }
    if (!['allowed', 'warning'].includes(readiness.latestDryRun.status ?? '')) {
      throw new Error('Aktuell production dry run saknas eller är inte godkänd.')
    }
    if (!readiness.latestCheck.id || !readiness.latestDryRun.id || !readiness.configurationSnapshot.id) {
      throw new Error('Aktuell canonical readiness-evidens är ofullständig.')
    }

    const stateResult = await supabaseService
      .from('ediel_production_state')
      .select('state_version,first_live_send_approved_at')
      .eq('company_id', companyId)
      .single()
    if (stateResult.error) throw stateResult.error

    const state = stateResult.data as {
      state_version: number
      first_live_send_approved_at: string | null
    }

    const transition = await supabaseService.rpc('canonical_transition_ediel_production', {
      p_company_id: companyId,
      p_target_state: 'live',
      p_expected_state_version: state.state_version,
      p_configuration_snapshot_id: readiness.configurationSnapshot.id,
      p_readiness_check_id: readiness.latestCheck.id,
      p_dry_run_id: readiness.latestDryRun.id,
      p_reason: 'Bolaget godkändes via one-click production approval efter aktuell readiness och dry run.',
      p_actor_user_id: admin.userId,
      p_idempotency_key: `one-click-production-approval:${companyId}:${readiness.latestCheck.id}`,
    })
    if (transition.error) throw transition.error

    // The one-click button is itself the explicit superadmin approval. For a
    // brand-new tenant we therefore approve the first live-send in the same
    // audited flow instead of forcing a second confirmation screen.
    if (!state.first_live_send_approved_at) {
      const firstSend = await supabaseService.rpc('canonical_approve_first_live_send', {
        p_company_id: companyId,
        p_readiness_check_id: readiness.latestCheck.id,
        p_actor_user_id: admin.userId,
        p_idempotency_key: `one-click-first-live-send:${companyId}:${readiness.latestCheck.id}`,
      })
      if (firstSend.error) throw firstSend.error
    }
  } catch (error) {
    revalidate(companyId)
    const message = error instanceof Error ? error.message : 'Bolaget kunde inte godkännas för production.'
    redirect(`${target}?status=blocked&message=${encodeURIComponent(message)}`)
  }

  revalidate(companyId)
  redirect(`${target}?status=live&message=${encodeURIComponent('Bolaget är godkänt och live. Readiness, dry run och production-aktivering är klara.')}`)
}
