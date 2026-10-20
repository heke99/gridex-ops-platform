'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { saveTenantProductionBrp } from '@/lib/ediel/tenantBrp'

function field(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

/** Onboarding step: Gridex staff choose the tenant's BRP from the Ediel registry. */
export async function saveTenantBrpAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = field(formData, 'company_id')
  const target = `/admin/platform/go-live/${encodeURIComponent(companyId)}`
  let status = 'brp_saved'
  let message: string
  try {
    const result = await saveTenantProductionBrp({
      companyId,
      actorId: field(formData, 'brp_actor_id'),
      validFrom: field(formData, 'valid_from'),
      actorUserId: admin.userId,
    })
    message = result.status === 'unchanged'
      ? `BRP ${result.brpEdielId} gäller redan från ${result.validFrom}.`
      : `BRP ${result.brpEdielId} gäller från ${result.validFrom}. Nya leverantörsbyten anger den i Ediel.`
  } catch (error) {
    status = 'brp_failed'
    message = error instanceof Error ? error.message : 'BRP kunde inte sparas.'
  }
  revalidatePath(target)
  revalidatePath(`/admin/companies/${companyId}`)
  redirect(`${target}?status=${status}&message=${encodeURIComponent(message)}#brp`)
}
