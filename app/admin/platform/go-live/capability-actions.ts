'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { reconcileTenantOperationalCapabilities } from '@/lib/integrations/tenantWebsiteReadiness'

const LABELS: Record<string, string> = {
  email_outbound: 'utgående e-post',
  customer_automation: 'kundautomation',
  facility_lookup: 'nätägarförfrågan',
}

/** Go-live step: Gridex staff reconcile the tenant's operational capabilities (FINDINGS F67). */
export async function reconcileTenantOperationalCapabilitiesAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = String(formData.get('company_id') ?? '').trim()
  const target = `/admin/platform/go-live/${encodeURIComponent(companyId)}`
  let status = 'capabilities_ready'
  let message: string
  try {
    const capabilities = (await reconcileTenantOperationalCapabilities({ companyId, actorUserId: admin.userId }))
      .filter((capability) => LABELS[capability.code])
    const blocked = capabilities.filter((capability) => !capability.ready)
    if (blocked.length > 0) status = 'capabilities_blocked'
    message = blocked.length === 0
      ? 'Utgående e-post, nätägarförfrågan och kundautomation är redo.'
      : `Inte redo: ${blocked.map((capability) => `${LABELS[capability.code]} (${capability.blockers.join(', ')})`).join(' · ')}`
  } catch (error) {
    status = 'capabilities_failed'
    message = error instanceof Error ? error.message : 'Driftkapabiliteterna kunde inte kontrolleras.'
  }
  revalidatePath(target)
  redirect(`${target}?status=${status}&message=${encodeURIComponent(message)}#capabilities`)
}
