'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import { requeueUncertainTenantEmail } from '@/lib/email/emailOutbox'
import { requeueUncertainManualEmail } from '@/lib/email/manualEmailOutbox'
import { createSupabaseServerClient } from '@/lib/supabase/server'

async function actorUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  return user.id
}

// Platform-operator recovery for delivery_uncertain e-mails: after reviewing
// the transport log, the row is requeued for the ordinary outbox worker. The
// provider idempotency key on the row deduplicates a send that actually went
// out during the interrupted attempt.
export async function requeueUncertainEmailAction(formData: FormData): Promise<void> {
  await requirePlatformAdminActionAccess()
  const userId = await actorUserId()

  const outboxId = String(formData.get('outbox_id') ?? '').trim()
  const outboxKind = String(formData.get('outbox_kind') ?? '').trim()
  const companyId = String(formData.get('company_id') ?? '').trim()
  if (!outboxId) throw new Error('outbox_id saknas')
  if (!companyId) throw new Error('company_id saknas')
  if (outboxKind !== 'tenant' && outboxKind !== 'manual') throw new Error('Okänd outbox-typ.')

  const result =
    outboxKind === 'tenant'
      ? await requeueUncertainTenantEmail({ outboxId, companyId, actorUserId: userId })
      : await requeueUncertainManualEmail({ outboxId, companyId, actorUserId: userId })

  if (!result.ok) throw new Error(result.error)

  await logAdminActionAndUsage({
    actorUserId: userId,
    entityType: outboxKind === 'tenant' ? 'tenant_email_outbox' : 'manual_email_outbox',
    entityId: outboxId,
    action: 'email_delivery_uncertain_requeued',
    label: 'Osäker leverans köades om efter granskning',
    source: 'system_health',
  }).catch(() => undefined)

  revalidatePath('/admin/system-health')
}
