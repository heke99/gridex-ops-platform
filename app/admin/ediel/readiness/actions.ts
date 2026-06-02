'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { recordSystemClockHealth } from '@/lib/ediel/operations/runtimeHealth'

function stringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function boolValue(formData: FormData, key: string): boolean {
  const value = formData.get(key)
  return typeof value === 'string' && ['true', 'on', '1'].includes(value.toLowerCase())
}

export async function saveAgtReadinessAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const companyId = stringValue(formData, 'companyId')
  const actorRole = stringValue(formData, 'actorRole') ?? 'supplier'
  const messageFamily = stringValue(formData, 'messageFamily') ?? 'PRODAT'

  if (!companyId) throw new Error('Bolag saknas.')

  const readinessStatus = [
    boolValue(formData, 'testResourceConfirmed'),
    boolValue(formData, 'edielPortalLoginConfirmed'),
    boolValue(formData, 'applicationSystemSelected'),
    boolValue(formData, 'ediSystemSelected'),
  ].every(Boolean) ? 'portal_ready' : 'not_ready'

  const { error } = await supabaseService
    .from('ediel_agt_readiness')
    .upsert({
      company_id: companyId,
      actor_role: actorRole,
      message_family: messageFamily,
      test_resource_name: stringValue(formData, 'testResourceName'),
      test_resource_email: stringValue(formData, 'testResourceEmail'),
      test_resource_confirmed: boolValue(formData, 'testResourceConfirmed'),
      ediel_portal_login_confirmed: boolValue(formData, 'edielPortalLoginConfirmed'),
      application_system_selected: boolValue(formData, 'applicationSystemSelected'),
      edi_system_selected: boolValue(formData, 'ediSystemSelected'),
      current_approval_version: stringValue(formData, 'currentApprovalVersion'),
      readiness_status: readinessStatus,
      needs_retest: false,
      retest_reason: null,
      invalidated_at: null,
      invalidation_source: null,
      last_checked_at: new Date().toISOString(),
      last_checked_by: context.userId,
      updated_by: context.userId,
      readiness_snapshot: {
        source: 'admin_ediel_readiness',
        savedBy: context.userId,
        savedAt: new Date().toISOString(),
      },
    }, {
      onConflict: 'company_id,actor_role,message_family',
    })

  if (error) throw error
  revalidatePath('/admin/ediel/readiness')
  revalidatePath('/admin/ediel/test-center')
}

export async function runEdielClockHealthCheckAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  await recordSystemClockHealth({
    companyId: stringValue(formData, 'companyId'),
    environmentType: stringValue(formData, 'environmentType') ?? 'production',
    referenceTimestamp: stringValue(formData, 'referenceTimestamp'),
    actorUserId: context.userId,
  })
  revalidatePath('/admin/ediel/readiness')
  revalidatePath('/admin/ediel/control-tower')
}
