import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import {
  acquireBusinessActionIdempotencyKey,
  buildBusinessActionIdempotencyKey,
} from '@/lib/operations/businessActions/idempotency'
import { supabaseService } from '@/lib/supabase/service'

export async function sendCustomerConfirmation(input: {
  actorUserId: string
  customerId: string
  event: string
  templateId?: string | null
  idempotencyKey?: string | null
}) {
  const preflight = await actionPreflight(input)
  const decision = decideBusinessAction('send_customer_confirmation')
  if (!preflight.ok) return { ok: false, preflight, decision, message: 'Kan inte skicka bekräftelsemail' }

  const idempotency = await acquireBusinessActionIdempotencyKey({
    companyId: preflight.companyId,
    actorUserId: input.actorUserId,
    action: decision.operation,
    key: buildBusinessActionIdempotencyKey({
      companyId: preflight.companyId,
      action: decision.operation,
      customerId: input.customerId,
      siteId: preflight.siteId,
      meteringPointId: preflight.meteringPointId,
      explicitKey: input.idempotencyKey ?? `${input.event}:${input.templateId ?? 'default'}`,
    }),
    metadata: { event: input.event, templateId: input.templateId ?? null },
  })

  if (!idempotency.acquired) {
    return { ok: true, preflight, decision, duplicate: true, message: 'Bekräftelsemail är redan köat.' }
  }

  const { data, error } = await supabaseService
    .from('customer_communications')
    .insert({
      company_id: preflight.companyId,
      customer_id: input.customerId,
      template_id: input.templateId ?? null,
      event_type: input.event,
      status: 'queued',
      channel: 'email',
      created_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return { ok: true, preflight, decision, communication: data }
}
