'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import { retryReviewableInvoiceProviderEvents } from '@/lib/billing/providerEventProcessor'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'

// Operator action for the previously dead-ended needs_review provider events:
// re-runs matching/processing for events that may have become resolvable.
export async function reprocessInvoiceProviderEventsAction(): Promise<void> {
  const context = await requireAdminActionAccess({ anyOf: ['billing_underlay.export', 'pricing.write'] })

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const scope = await getOperationalCompanyScope(user.id)
  const companyId = scope?.companyId ?? null

  const result = await retryReviewableInvoiceProviderEvents({ companyId, limit: 100 })

  await logAdminActionAndUsage({
    companyId,
    actorUserId: context.userId,
    entityType: 'invoice_provider_events',
    entityId: companyId ?? 'platform',
    action: 'invoice_provider_events_reprocessed',
    label: 'Providerhändelser ombearbetade',
    newValues: { processed: result.processed, stillNeedsReview: result.stillNeedsReview, failed: result.failed },
    source: 'billing_integrations',
  }).catch(() => undefined)

  revalidatePath('/admin/billing/integrations')
}
