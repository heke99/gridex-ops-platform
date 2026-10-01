'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import { requeueUncertainTenantEmail } from '@/lib/email/emailOutbox'
import { requeueUncertainManualEmail } from '@/lib/email/manualEmailOutbox'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'

async function actorUserId(expectedUserId: string): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user || user.id !== expectedUserId) throw new Error('Unauthorized')
  return user.id
}

// Platform-operator recovery for delivery_uncertain e-mails: after reviewing
// the transport log, the row is requeued for the ordinary outbox worker. The
// provider idempotency key on the row deduplicates a send that actually went
// out during the interrupted attempt.
export async function requeueUncertainEmailAction(formData: FormData): Promise<void> {
  const context = await requirePlatformAdminActionAccess()
  const userId = await actorUserId(context.userId)

  const outboxId = String(formData.get('outbox_id') ?? '').trim()
  const outboxKind = String(formData.get('outbox_kind') ?? '').trim()
  const companyId = String(formData.get('company_id') ?? '').trim()
  if (!outboxId) throw new Error('outbox_id saknas')
  if (!companyId) throw new Error('company_id saknas')
  if (outboxKind !== 'tenant' && outboxKind !== 'manual') throw new Error('Okänd outbox-typ.')

  const outboxTable = outboxKind === 'tenant' ? 'tenant_email_outbox' : 'manual_email_outbox'
  const { data: current, error: currentError } = await supabaseService
    .from(outboxTable)
    .select('id,company_id,status')
    .eq('id', outboxId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (currentError) throw currentError
  if (!current || current.id !== outboxId || current.company_id !== companyId || current.status !== 'delivery_uncertain') {
    throw new Error('Utskicket är inte i osäkert leveransläge för valt bolag.')
  }

  const result =
    outboxKind === 'tenant'
      ? await requeueUncertainTenantEmail({ outboxId: current.id, companyId: current.company_id, actorUserId: userId })
      : await requeueUncertainManualEmail({ outboxId: current.id, companyId: current.company_id, actorUserId: userId })

  if (!result.ok) throw new Error(result.error)

  await logAdminActionAndUsage({
    companyId: current.company_id,
    actorUserId: userId,
    entityType: outboxKind === 'tenant' ? 'tenant_email_outbox' : 'manual_email_outbox',
    entityId: outboxId,
    action: 'email_delivery_uncertain_requeued',
    label: 'Osäker leverans köades om efter granskning',
    source: 'system_health',
  }).catch(() => undefined)

  try {
    revalidatePath('/admin/system-health')
  } catch (error) {
    unstable_rethrow(error)
    // The scoped requeue is already saved. A cache refresh cannot undo it.
    console.warn('[system-health] saved recovery view refresh failed')
  }
}
