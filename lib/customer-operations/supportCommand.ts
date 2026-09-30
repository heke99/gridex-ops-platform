import 'server-only'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'

const sessionActor = z.object({ kind: z.enum(['ops', 'portal']), userId: z.string().uuid(), sessionId: z.string().uuid() }).strict()
const apiActor = z.object({ kind: z.literal('api'), clientId: z.string().uuid(), subject: z.string().min(1).max(255) }).strict()
export type SupportActor = z.infer<typeof sessionActor> | z.infer<typeof apiActor>

const payloadSchemas = {
  create: z.object({ title: z.string().trim().min(1).max(180), body: z.string().trim().min(1).max(8000), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), category: z.string().trim().min(1).max(120).optional() }).strict(),
  customer_message: z.object({ body: z.string().trim().min(1).max(8000) }).strict(),
  internal_note: z.object({ body: z.string().trim().min(1).max(8000) }).strict(),
  status: z.object({ status: z.enum(['open', 'action_required', 'awaiting_external_response', 'manual_follow_up', 'resolved', 'closed']) }).strict(),
}
const commandSchema = z.object({
  companyId: z.string().uuid(), customerId: z.string().uuid(),
  siteId: z.string().uuid().optional(), meteringPointId: z.string().uuid().optional(),
  interactionChannel: z.enum(['ops', 'phone']).optional(),
  actor: z.union([sessionActor, apiActor]), operation: z.enum(['create', 'customer_message', 'internal_note', 'status']),
  caseId: z.string().uuid().optional(), caseReference: z.string().regex(/^case_[A-Za-z0-9_-]{32}$/).optional(), expectedRevision: z.number().int().nonnegative().safe(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:+~-]{8,200}$/), payload: z.record(z.unknown()),
}).strict()

export class SupportCommandError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'SupportCommandError' }
}
export type SupportCommandResult = {
  companyId: string; customerId: string; caseId: string; revision: number;
  messageId?: string; status: string; replayed: boolean
  customerStatus?: 'open' | 'waiting_for_customer' | 'resolved' | 'closed'
}
export type SupportCommandInput = z.infer<typeof commandSchema>

function commandError(message: string): SupportCommandError | null {
  if (['support_revision_conflict', 'support_idempotency_conflict', 'support_legacy_idempotency_requires_review', 'support_status_transition_forbidden', 'support_case_closed'].includes(message)) return new SupportCommandError(message, 409)
  if (['support_actor_forbidden', 'support_delegation_forbidden', 'support_session_revoked'].includes(message)) return new SupportCommandError(message, 403)
  if (message === 'support_resource_unavailable') return new SupportCommandError('resource_not_found', 404)
  if (['invalid_support_command', 'support_publication_required'].includes(message)) return new SupportCommandError(message, 422)
  return null
}

export async function executeSupportCommand(input: SupportCommandInput): Promise<SupportCommandResult> {
  const parsed = commandSchema.safeParse(input)
  if (!parsed.success) throw new SupportCommandError('invalid_support_command', 422)
  const candidate = parsed.data
  const payload = payloadSchemas[candidate.operation].safeParse(candidate.payload)
  if (!payload.success || (candidate.operation === 'create'
      ? candidate.caseId !== undefined || candidate.caseReference !== undefined || candidate.expectedRevision !== 0
      : Boolean(candidate.caseId) === Boolean(candidate.caseReference)) ||
      (candidate.actor.kind !== 'ops' && (['internal_note', 'status'].includes(candidate.operation) || 'priority' in candidate.payload || 'category' in candidate.payload))) {
    throw new SupportCommandError('invalid_support_command', 422)
  }
  if ((candidate.siteId || candidate.meteringPointId) && (candidate.actor.kind !== 'ops' || candidate.operation !== 'create')) throw new SupportCommandError('invalid_support_command', 422)
  if (candidate.interactionChannel !== undefined && (candidate.actor.kind !== 'ops' ||
      (candidate.interactionChannel === 'phone' && !['create', 'internal_note'].includes(candidate.operation)))) throw new SupportCommandError('invalid_support_command', 422)
  const actor = candidate.actor
  const p_command = {
    companyId: candidate.companyId, customerId: candidate.customerId, caseId: candidate.caseId ?? null, caseReference: candidate.caseReference ?? null,
    siteId: candidate.siteId ?? null, meteringPointId: candidate.meteringPointId ?? null,
    operation: candidate.operation, expectedRevision: candidate.expectedRevision, idempotencyKey: candidate.idempotencyKey,
    mode: actor.kind, channel: candidate.interactionChannel ?? actor.kind,
    actorUserId: actor.kind === 'api' ? null : actor.userId,
    sessionId: actor.kind === 'api' ? null : actor.sessionId,
    clientId: actor.kind === 'api' ? actor.clientId : null,
    subject: actor.kind === 'api' ? actor.subject : null,
    payload: payload.data,
  }
  const { data, error } = await supabaseService.rpc('gridex_support_case_command_v1', { p_command })
  if (error) {
    if (['42883', '42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code)) throw new SupportCommandError('support_schema_unavailable', 503)
    throw commandError(String(error.message)) ?? error
  }
  const result = data as Record<string, unknown> | null
  if (!result || result.companyId !== candidate.companyId || result.customerId !== candidate.customerId ||
      typeof result.caseId !== 'string' || !z.string().uuid().safeParse(result.caseId).success ||
      (candidate.caseId !== undefined && result.caseId !== candidate.caseId) ||
      !Number.isSafeInteger(result.revision) || (result.revision as number) < 1 ||
      typeof result.status !== 'string' || !['open', 'action_required', 'awaiting_external_response', 'billing_blocked', 'manual_follow_up', 'resolved', 'cancelled', 'closed'].includes(result.status) ||
      typeof result.replayed !== 'boolean' || result.revision !== candidate.expectedRevision + 1 ||
      ((candidate.actor.kind !== 'ops' || candidate.operation === 'customer_message') &&
        !['open', 'waiting_for_customer', 'resolved', 'closed'].includes(String(result.customerStatus))) ||
      (candidate.operation === 'customer_message' && !z.string().uuid().safeParse(result.messageId).success)) {
    throw new SupportCommandError('support_result_invalid', 503)
  }
  return result as SupportCommandResult
}
