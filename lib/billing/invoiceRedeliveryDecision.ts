import 'server-only'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
export const invoiceRedeliveryDecisionInputSchema = z.object({
  companyId: uuid, customerId: uuid, invoiceId: uuid, accountId: uuid,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expectedOverrideRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:+~-]{8,200}$/), reason: z.string().trim().min(1).max(200),
}).strict()
export type InvoiceRedeliveryDecisionInput = z.infer<typeof invoiceRedeliveryDecisionInputSchema>
const actorSchema = z.object({ kind: z.literal('ops'), userId: uuid, sessionId: uuid }).strict()
const resultSchema = z.object({
  companyId: z.string().uuid(), customerId: z.string().uuid(), invoiceId: z.string().uuid(), invoiceExportItemId: z.string().uuid(), decisionId: z.string().uuid(),
  destinationEmail: z.string().email(), revision: z.number().int().nonnegative(), contractOverrideRevision: z.number().int().nonnegative(),
  status: z.literal('verified_delivery_decision'), deliveryStatus: z.literal('blocked_provider_adapter'),
  financialSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/), documentReferencesSha256: z.string().regex(/^[a-f0-9]{64}$/),
  replayed: z.boolean(),
}).strict()
export class InvoiceRedeliveryDecisionError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'InvoiceRedeliveryDecisionError' }
}

/** Records a separately verified decision. The database derives the destination
 * from current canonical billing + owner/Auth rows and preserves issued data.
 * No transport, provider profile write, invoice create or purchase occurs. */
export async function recordInvoiceRedeliveryDecision(input: InvoiceRedeliveryDecisionInput & {
  actor: z.infer<typeof actorSchema>
}) {
  const { actor, ...request } = input
  const parsed = invoiceRedeliveryDecisionInputSchema.safeParse(request)
  const currentActor = actorSchema.safeParse(actor)
  if (!parsed.success || !currentActor.success) throw new InvoiceRedeliveryDecisionError('invalid_redelivery_command', 422)
  const p_command = { ...parsed.data, actorUserId: currentActor.data.userId, sessionId: currentActor.data.sessionId }
  const { data, error } = await supabaseService.rpc('gridex_record_invoice_redelivery_decision_v1', { p_command })
  if (error) {
    const code = String(error.message ?? '')
    if (['redelivery_service_required', 'redelivery_resource_unavailable', 'redelivery_actor_forbidden',
      'redelivery_destination_owner_required', 'redelivery_destination_unverified', 'redelivery_destination_mismatch'].includes(code)) {
      throw new InvoiceRedeliveryDecisionError(code, 403)
    }
    if (['redelivery_revision_conflict', 'redelivery_idempotency_conflict', 'redelivery_original_unavailable',
      'redelivery_document_references_unavailable'].includes(code)) throw new InvoiceRedeliveryDecisionError(code, 409)
    if (['invalid_redelivery_command', 'redelivery_email_destination_required'].includes(code)) throw new InvoiceRedeliveryDecisionError(code, 422)
    throw new InvoiceRedeliveryDecisionError('redelivery_unavailable', 503)
  }
  const result = resultSchema.safeParse(data)
  if (!result.success || result.data.companyId !== parsed.data.companyId || result.data.customerId !== parsed.data.customerId
    || result.data.invoiceId !== parsed.data.invoiceId || result.data.revision !== parsed.data.expectedRevision
    || result.data.contractOverrideRevision !== parsed.data.expectedOverrideRevision) {
    throw new InvoiceRedeliveryDecisionError('redelivery_result_invalid', 503)
  }
  return result.data
}
