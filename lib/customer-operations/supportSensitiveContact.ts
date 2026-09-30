import 'server-only'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { supportContactRequestBinding, verifySupportSensitiveContactProof } from '@/lib/customer-portal/supportSensitiveProof'
import { currentSupportSession } from './supportSession'
import { SupportCommandError } from './supportCommand'

const inputSchema = z.object({
  companyId: z.string().uuid(), customerId: z.string().uuid(), caseId: z.string().uuid(),
  expectedCaseRevision: z.number().int().nonnegative().safe(), expectedContactRevision: z.number().int().nonnegative().safe(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:+~-]{8,200}$/), reason: z.string().trim().min(1).max(200),
  changes: z.object({ email: z.string().trim().email().max(320).nullable().optional(),
    phone: z.string().trim().min(1).max(50).nullable().optional() }).strict().refine(value => Object.keys(value).length > 0),
  proofToken: z.string().min(1).max(8192),
}).strict()
export type SupportSensitiveContactInput = z.infer<typeof inputSchema>
export type SupportSensitiveContactResult = { companyId: string; customerId: string; caseId: string; caseRevision: number; contactRevision: number; changed: boolean; replayed: boolean }

/** Actual auth-derived session only. Proof consumption and the existing contact
 * command happen in one database transaction; a consumed proof cannot retry. */
export async function changeContactAfterSupportVerification(input: SupportSensitiveContactInput, expectedStaffUserId?: string): Promise<SupportSensitiveContactResult> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new SupportCommandError('invalid_support_sensitive_command', 422)
  const { proofToken, ...request } = parsed.data
  const actor = await currentSupportSession('ops', expectedStaffUserId)
  const proof = await verifySupportSensitiveContactProof({ token: proofToken,
    configuration: process.env.GRIDEX_SUPPORT_SENSITIVE_PROOF_TRUST, request, actor })
  if (!proof) throw new SupportCommandError('support_sensitive_proof_invalid', 403)
  const { data, error } = await supabaseService.rpc('gridex_support_sensitive_contact_v1', {
    p_command: { ...request, actorUserId: actor.userId, sessionId: actor.sessionId, bindingJson: supportContactRequestBinding(request, actor) },
    p_proof: proof,
  })
  if (error) {
    if (['42883','42P01','42703','PGRST202','PGRST204','PGRST205'].includes(error.code)) throw new SupportCommandError('support_schema_unavailable', 503)
    const code = String(error.message)
    if (['support_sensitive_proof_invalid','support_sensitive_proof_replayed','support_actor_forbidden','profile_actor_forbidden'].includes(code)) throw new SupportCommandError(code, 403)
    if (code === 'support_resource_unavailable') throw new SupportCommandError('resource_not_found', 404)
    if (['support_sensitive_command_already_completed','support_revision_conflict','contact_revision_conflict','contact_idempotency_conflict','idempotency_conflict','support_case_closed','contact_selection_conflict'].includes(code)) throw new SupportCommandError(code, 409)
    if (['invalid_support_sensitive_command','invalid_contact_command','invalid_contact_field','contact_method_required'].includes(code)) throw new SupportCommandError(code, 422)
    throw new SupportCommandError('support_unavailable', 503)
  }
  const result = data as SupportSensitiveContactResult | null
  if (!result || result.companyId !== request.companyId || result.customerId !== request.customerId || result.caseId !== request.caseId ||
    result.caseRevision !== request.expectedCaseRevision + 1 || !Number.isSafeInteger(result.contactRevision) ||
    typeof result.changed !== 'boolean' || typeof result.replayed !== 'boolean' ||
    result.contactRevision !== request.expectedContactRevision + (result.changed ? 1 : 0)) throw new SupportCommandError('support_result_invalid', 503)
  return result
}
