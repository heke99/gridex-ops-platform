import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import {
  acquireBusinessActionIdempotencyKey,
  buildBusinessActionIdempotencyKey,
} from '@/lib/operations/businessActions/idempotency'
import { triggerEmailEvent } from '@/lib/email/emailEvents'
import { supabaseService } from '@/lib/supabase/service'

// Customer confirmation mail goes through the ONE communication pipeline
// (triggerEmailEvent -> sendCompanyEmail -> communication_logs +
// tenant_email_outbox -> Resend). The legacy customer_communications table was
// an orphan write path: rows were inserted as 'queued' but no worker ever sent
// or read them, so the action claimed a mail was queued while nothing existed
// in the real source of truth.
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

  const { data: customer, error: customerError } = await supabaseService
    .from('customers')
    .select('id,email')
    .eq('company_id', preflight.companyId)
    .eq('id', input.customerId)
    .maybeSingle()
  if (customerError) throw customerError
  const recipient = typeof customer?.email === 'string' && customer.email.trim() ? customer.email.trim() : null
  if (!recipient) {
    return { ok: false, preflight, decision, message: 'Kunden saknar e-postadress. Bekräftelsemail kan inte skickas.' }
  }

  const results = await triggerEmailEvent({
    companyId: preflight.companyId,
    customerId: input.customerId,
    siteId: preflight.siteId ?? null,
    meteringPointId: preflight.meteringPointId ?? null,
    eventKey: input.event,
    to: recipient,
    createdBy: input.actorUserId,
    idempotencyKey: input.idempotencyKey ?? `business-action:${decision.operation}:${input.customerId}:${input.event}`,
    metadata: { source: 'send_customer_confirmation_business_action', template_id: input.templateId ?? null },
  })

  if (results.length === 0) {
    return {
      ok: false,
      preflight,
      decision,
      message: `Ingen e-postmall är kopplad till händelsen ${input.event}.`,
    }
  }

  const failed = results.filter((result) => result.ok === false)
  const logs = results
    .map((result) => (result as { log?: unknown }).log ?? null)
    .filter(Boolean)

  return {
    ok: failed.length === 0,
    preflight,
    decision,
    communication: logs[0] ?? null,
    communication_logs: logs,
    dispatch_status: failed.length === results.length ? 'failed' : 'queued',
    message: failed.length === 0
      ? 'Bekräftelsemail är köat för utskick (communication_logs).'
      : 'Bekräftelsemail kunde inte köas. Kontrollera avsändarkonfiguration och mallar.',
  }
}
