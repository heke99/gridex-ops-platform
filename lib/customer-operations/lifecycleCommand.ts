import 'server-only'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { PlatformSchemaNotReadyError } from '@/lib/platform/schemaReadiness'

const inputSchema = z.object({
  companyId: z.string().uuid(), customerId: z.string().uuid(),
  actor: z.object({ kind: z.literal('ops'), userId: z.string().uuid(), sessionId: z.string().uuid() }).strict(),
  expectedRevision: z.number().int().nonnegative().safe(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:+~-]{8,200}$/),
  mode: z.enum(['move_out', 'terminate']),
  moveOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }),
  reason: z.string().trim().min(1).max(200),
  createFollowUpTask: z.boolean(),
}).strict()

export type CustomerLifecycleCommandInput = z.infer<typeof inputSchema>
export type CustomerLifecycleCommandResult = { revision: number; changed: boolean; replayed: boolean }
export class CustomerLifecycleCommandError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
    this.name = 'CustomerLifecycleCommandError'
  }
}

/** All local effects, the canonical audit and pending confirmation intent are
 * committed by one service-only command. Session and authority are rechecked
 * under database locks before either a new mutation or a historical replay. */
export async function closeCustomerLifecycle(input: CustomerLifecycleCommandInput): Promise<CustomerLifecycleCommandResult> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new CustomerLifecycleCommandError('invalid_lifecycle_command', 422)
  const candidate = parsed.data
  const { data, error } = await supabaseService.rpc('gridex_close_customer_lifecycle_v1', { p_command: {
    companyId: candidate.companyId, customerId: candidate.customerId,
    actorUserId: candidate.actor.userId, sessionId: candidate.actor.sessionId,
    expectedRevision: candidate.expectedRevision, idempotencyKey: candidate.idempotencyKey,
    mode: candidate.mode, moveOutDate: candidate.moveOutDate, reason: candidate.reason,
    createFollowUpTask: candidate.createFollowUpTask,
  } })
  if (error) {
    const code = String(error.message ?? '')
    if ((['42883', 'PGRST202'].includes(String(error.code)) && code.includes('gridex_close_customer_lifecycle_v1')) ||
        (['42703', 'PGRST204'].includes(String(error.code)) && code.includes('lifecycle_revision'))) {
      throw new PlatformSchemaNotReadyError('Kundens livscykelkommando är ännu inte tillgängligt i databasen.')
    }
    if (['lifecycle_revision_conflict', 'lifecycle_idempotency_conflict', 'lifecycle_state_conflict', 'lifecycle_resource_conflict'].includes(code)) {
      throw new CustomerLifecycleCommandError(code, 409)
    }
    if (['lifecycle_service_required', 'lifecycle_actor_forbidden', 'lifecycle_customer_unavailable', 'lifecycle_tenant_unavailable'].includes(code)) {
      throw new CustomerLifecycleCommandError(code, 403)
    }
    if (['invalid_lifecycle_command', 'lifecycle_date_invalid', 'lifecycle_reason_required'].includes(code)) {
      throw new CustomerLifecycleCommandError(code, 422)
    }
    throw error
  }
  const result = data as Record<string, unknown> | null
  if (!result || result.companyId !== candidate.companyId || result.customerId !== candidate.customerId ||
      !Number.isSafeInteger(result.revision) || Number(result.revision) < 0 ||
      typeof result.changed !== 'boolean' || typeof result.replayed !== 'boolean') {
    throw new CustomerLifecycleCommandError('lifecycle_result_invalid', 503)
  }
  return { revision: result.revision as number, changed: result.changed, replayed: result.replayed }
}
