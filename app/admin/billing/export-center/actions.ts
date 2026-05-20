'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { createBillingExportRun, queueReadyBillingExportRunItems, sendBillingExportRunToPartnerApi } from '@/lib/billing/exportCenter'

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

export async function createBillingExportRunAction(formData: FormData) {
  await requireAdminActionAccess(['billing_underlay.export'])
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Du måste vara inloggad.')
  const companyId = await requireOperationalCompanyId(user.id)
  const periodMonth = text(formData, 'period_month') || new Date().toISOString().slice(0, 7)

  await createBillingExportRun({
    companyId,
    actorUserId: user.id,
    periodMonth,
    targetSystem: text(formData, 'target_system') || 'billing_partner',
    exportFormat: text(formData, 'export_format') || 'json',
  })

  revalidatePath('/admin/billing/export-center')
  revalidatePath('/admin/billing')
}


export async function queueReadyBillingExportRunItemsAction(formData: FormData) {
  await requireAdminActionAccess(['billing_underlay.export'])
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Du måste vara inloggad.')

  const companyId = await requireOperationalCompanyId(user.id)
  const exportRunId = text(formData, 'export_run_id')
  if (!exportRunId) throw new Error('export_run_id saknas.')

  await queueReadyBillingExportRunItems({
    companyId,
    actorUserId: user.id,
    exportRunId,
  })

  revalidatePath('/admin/billing/export-center')
  revalidatePath('/admin/partner-exports')
}


export async function sendBillingExportRunToPartnerApiAction(formData: FormData) {
  await requireAdminActionAccess(['billing_underlay.export'])
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Du måste vara inloggad.')

  const companyId = await requireOperationalCompanyId(user.id)
  const exportRunId = text(formData, 'export_run_id')
  if (!exportRunId) throw new Error('export_run_id saknas.')

  await sendBillingExportRunToPartnerApi({
    companyId,
    actorUserId: user.id,
    exportRunId,
  })

  revalidatePath('/admin/billing/export-center')
  revalidatePath('/admin/partner-exports')
}
