import 'server-only'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { PlatformSchemaNotReadyError } from '@/lib/platform/schemaReadiness'

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional()
const legalFields = z.object({
  customer_type: z.enum(['private', 'business', 'association']),
  first_name: optionalText(120), last_name: optionalText(120),
  company_name: optionalText(240), personal_number: optionalText(50),
  org_number: optionalText(50), apartment_number: optionalText(50),
}).strict()
const inputSchema = z.object({
  companyId: z.string().uuid(), customerId: z.string().uuid(),
  actor: z.object({ kind: z.literal('ops'), userId: z.string().uuid(), sessionId: z.string().uuid(), reason: z.string().trim().min(1).max(200) }).strict(),
  expectedRevision: z.number().int().nonnegative().safe(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:+~-]{8,200}$/), changes: legalFields,
}).strict()
export type LegalProfileCommandInput = z.infer<typeof inputSchema>
export type LegalProfileCommandResult = { revision: number; changed: boolean; replayed: boolean }
export class LegalProfileCommandError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'LegalProfileCommandError' }
}

/** Private OPS adapter. Actual session, tenant, field policy and permissions
 * are checked again under locks by the service-only database command. */
export async function changeCustomerLegalProfile(input: LegalProfileCommandInput): Promise<LegalProfileCommandResult> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new LegalProfileCommandError('invalid_legal_profile_command', 422)
  const candidate = parsed.data
  const p_command = {
    companyId: candidate.companyId, customerId: candidate.customerId,
    actorUserId: candidate.actor.userId, sessionId: candidate.actor.sessionId, reason: candidate.actor.reason,
    expectedRevision: candidate.expectedRevision, idempotencyKey: candidate.idempotencyKey, changes: candidate.changes,
  }
  const { data, error } = await supabaseService.rpc('gridex_change_customer_legal_profile_v1', { p_command })
  if (error) {
    const code = String(error.message ?? '')
    if ((['42883', 'PGRST202'].includes(String(error.code)) && code.includes('gridex_change_customer_legal_profile_v1')) ||
        (['42703', 'PGRST204'].includes(String(error.code)) && code.includes('legal_profile_revision'))) {
      throw new PlatformSchemaNotReadyError('Den juridiska kundprofilens databasgräns är ännu inte tillgänglig.')
    }
    if (['legal_profile_revision_conflict', 'legal_profile_idempotency_conflict'].includes(code)) throw new LegalProfileCommandError(code, 409)
    if (['legal_profile_service_required', 'legal_profile_actor_forbidden', 'legal_profile_customer_unavailable', 'legal_profile_tenant_unavailable'].includes(code)) throw new LegalProfileCommandError(code, 403)
    if (['invalid_legal_profile_command', 'invalid_legal_profile_field', 'legal_profile_private_name_required', 'legal_profile_business_identity_required'].includes(code)) throw new LegalProfileCommandError(code, 422)
    throw error
  }
  const result = data as Record<string, unknown> | null
  if (!result || result.companyId !== candidate.companyId || result.customerId !== candidate.customerId ||
      !Number.isSafeInteger(result.revision) || Number(result.revision) < 0 ||
      typeof result.changed !== 'boolean' || typeof result.replayed !== 'boolean') {
    throw new LegalProfileCommandError('legal_profile_result_invalid', 503)
  }
  return { revision: result.revision as number, changed: result.changed, replayed: result.replayed }
}
