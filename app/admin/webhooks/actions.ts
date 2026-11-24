'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  WEBHOOK_IGNORED, WEBHOOK_MANAGE_REQUIREMENT, WEBHOOK_RESEND_QUEUED, WEBHOOK_TEST_QUEUED,
} from './policy'

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

async function applyWebhookCommand(
  formData: FormData,
  command: 'test' | 'resend' | 'ignore',
  success: string,
) {
  const companyId = text(formData, 'company_id')
  const admin = await requireCompanyScopedActionAccess(companyId, WEBHOOK_MANAGE_REQUIREMENT)
  const targetId = text(formData, command === 'test' ? 'subscription_id' : 'delivery_id')
  const requestId = text(formData, 'request_id')
  const status = command === 'test' ? null : text(formData, 'delivery_status')
  const path = '/admin/webhooks/deliveries'
  if (!targetId || !requestId || (command !== 'test' && !status)) {
    redirect(`${path}?error=action_unavailable`)
  }

  const { data, error } = await supabaseService.rpc('gridex_admin_webhook_command_v1', {
    p_company_id: companyId,
    p_actor_id: admin.userId,
    p_target_id: targetId,
    p_request_id: requestId,
    p_command: command,
    p_original_status: status,
    p_note: command === 'ignore' ? text(formData, 'note') || 'Manuellt hanterad.' : null,
  })
  if (error?.code === 'P0002' || error?.code === '22P02') redirect(`${path}?error=action_unavailable`)
  if (error) throw error
  if (data?.applied !== true) throw new Error('Köändringen kunde inte bekräftas. Kontrollera leveransen.')

  revalidatePath(path)
  if (command === 'test') revalidatePath('/admin/platform/api-clients')
  redirect(`${path}?success=${encodeURIComponent(success)}`)
}

export async function sendWebhookTestEventAction(formData: FormData) {
  await applyWebhookCommand(formData, 'test', WEBHOOK_TEST_QUEUED)
}

export async function resendWebhookDeliveryAction(formData: FormData) {
  await applyWebhookCommand(formData, 'resend', WEBHOOK_RESEND_QUEUED)
}

export async function markWebhookDeliveryIgnoredAction(formData: FormData) {
  await applyWebhookCommand(formData, 'ignore', WEBHOOK_IGNORED)
}
