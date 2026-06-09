'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { dispatchDueWebhookDeliveries } from '@/lib/integrations/webhooks'
import { supabaseService } from '@/lib/supabase/service'

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function redirectBack(path: string, message?: string) {
  redirect(message ? `${path}?success=${encodeURIComponent(message)}` : path)
}

export async function sendWebhookTestEventAction(formData: FormData) {
  const companyId = text(formData, 'company_id')
  const subscriptionId = text(formData, 'subscription_id')
  await requireCompanyScopedActionAccess(companyId, { anyOf: ['customers.write', 'integrations.write', 'billing_underlay.write'] })

  const event = await emitDomainEvent({
    companyId,
    eventType: 'webhook.test',
    aggregateType: 'webhook_subscription',
    aggregateId: subscriptionId || companyId,
    source: 'admin_webhook_test',
    payload: {
      test: true,
      webhook_subscription_id: subscriptionId || null,
      message: 'Gridex webhook test event',
    },
    idempotencyKey: `webhook-test:${companyId}:${subscriptionId || 'all'}:${Date.now()}`,
  })

  await supabaseService.from('audit_logs').insert({
    company_id: companyId,
    action: 'webhook.test_event_created',
    entity_type: 'webhook_subscription',
    entity_id: subscriptionId || null,
    new_values: { event_id: event?.id ?? null },
  }).then(() => null)

  revalidatePath('/admin/webhooks/deliveries')
  revalidatePath('/admin/platform/api-clients')
  redirectBack('/admin/webhooks/deliveries', 'Testevent skapades och köades för webhook.')
}

export async function resendWebhookDeliveryAction(formData: FormData) {
  const deliveryId = text(formData, 'delivery_id')
  const companyId = text(formData, 'company_id')
  const admin = await requireCompanyScopedActionAccess(companyId, { anyOf: ['customers.write', 'integrations.write', 'billing_underlay.write'] })

  if (!deliveryId) throw new Error('Webhook delivery saknas.')

  const { error } = await supabaseService
    .from('webhook_deliveries')
    .update({
      status: 'queued',
      next_attempt_at: new Date().toISOString(),
      manual_status: 'resend_requested',
      resent_by: admin.userId,
      resent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', deliveryId)
    .eq('company_id', companyId)

  if (error) throw error

  await supabaseService.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: admin.userId,
    action: 'webhook.delivery_resend_requested',
    entity_type: 'webhook_delivery',
    entity_id: deliveryId,
  }).then(() => null)

  await dispatchDueWebhookDeliveries(10).catch(() => null)
  revalidatePath('/admin/webhooks/deliveries')
  redirectBack('/admin/webhooks/deliveries', 'Webhook delivery köades om.')
}

export async function markWebhookDeliveryIgnoredAction(formData: FormData) {
  const deliveryId = text(formData, 'delivery_id')
  const companyId = text(formData, 'company_id')
  const note = text(formData, 'note') || 'Manuellt hanterad.'
  const admin = await requireCompanyScopedActionAccess(companyId, { anyOf: ['customers.write', 'integrations.write', 'billing_underlay.write'] })

  if (!deliveryId) throw new Error('Webhook delivery saknas.')

  const { error } = await supabaseService
    .from('webhook_deliveries')
    .update({
      status: 'skipped',
      manual_status: 'ignored',
      manual_note: note,
      updated_at: new Date().toISOString(),
    })
    .eq('id', deliveryId)
    .eq('company_id', companyId)

  if (error) throw error

  await supabaseService.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: admin.userId,
    action: 'webhook.delivery_ignored',
    entity_type: 'webhook_delivery',
    entity_id: deliveryId,
    new_values: { note },
  }).then(() => null)

  revalidatePath('/admin/webhooks/deliveries')
  redirectBack('/admin/webhooks/deliveries', 'Webhook delivery markerades som hanterad.')
}
