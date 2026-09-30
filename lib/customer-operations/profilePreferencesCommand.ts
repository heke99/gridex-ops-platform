import 'server-only'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { ApiInputError } from '@/lib/api/strictRequest'
import { PlatformSchemaNotReadyError } from '@/lib/platform/schemaReadiness'

const actorSchema = z.union([
  z.object({ kind: z.literal('api'), clientId: z.string().uuid(), subject: z.string().min(1).max(255) }).strict(),
  z.object({ kind: z.literal('ops'), userId: z.string().uuid(), sessionId: z.string().uuid(), reason: z.string().trim().min(1).max(200) }).strict(),
])
export type CustomerProfileActor = z.infer<typeof actorSchema>
export type CustomerProfileCommandInput = {
  companyId: string; customerId: string; actor: CustomerProfileActor;
  idempotencyKey: string; payload: Record<string, unknown>
}
export type CustomerProfileCommandResult = { statusCode: number; body: Record<string, unknown>; replayed: boolean }

// Exact strictRequest canonicalJson semantics, including omitted fields and
// the ECMAScript number/string representation in historical metadata.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

/** Private service input; never accept this actor/serialized request from a form. */
export function customerProfileCommand(input: CustomerProfileCommandInput): Record<string, unknown> {
  const parsed = z.object({
    companyId: z.string().uuid(), customerId: z.string().uuid(), actor: actorSchema,
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:+~-]{8,200}$/), payload: z.record(z.unknown()),
  }).strict().safeParse(input)
  if (!parsed.success) throw new ApiInputError('Profilkommandot är ogiltigt.', 'invalid_profile_command', 422)
  const actor = parsed.data.actor
  let requestJson: string
  try { requestJson = canonicalJson(parsed.data.payload) } catch {
    throw new ApiInputError('Profilkommandot är ogiltigt.', 'invalid_profile_command', 422)
  }
  if (Buffer.byteLength(requestJson, 'utf8') > 256_000) {
    throw new ApiInputError('Profilkommandot är för stort.', 'payload_too_large', 413)
  }
  return {
    companyId: input.companyId, customerId: input.customerId, mode: actor.kind,
    actorUserId: actor.kind === 'ops' ? actor.userId : null,
    sessionId: actor.kind === 'ops' ? actor.sessionId : null,
    clientId: actor.kind === 'api' ? actor.clientId : null,
    subject: actor.kind === 'api' ? actor.subject : null,
    reason: actor.kind === 'ops' ? actor.reason : null,
    idempotencyKey: input.idempotencyKey, requestJson,
  }
}

export function customerProfileSchemaError(error: { code?: string; message?: string }): void {
  if (['42883', '42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) {
    throw new PlatformSchemaNotReadyError('Profilkommandots databasgräns är ännu inte tillgänglig.')
  }
}

export async function executeCustomerProfileRpc(
  name: 'gridex_change_customer_profile_preferences_v1' | 'gridex_change_customer_facility_profile_v1',
  p_command: Record<string, unknown>,
): Promise<CustomerProfileCommandResult> {
  const { data, error } = await supabaseService.rpc(name, { p_command })
  if (error) {
    customerProfileSchemaError(error)
    const code = String(error.message ?? '')
    if (['idempotency_conflict', 'idempotency_previous_attempt_failed', 'idempotency_in_progress',
      'profile_revision_conflict', 'facility_address_revision_conflict'].includes(code)) {
      throw new ApiInputError('Ändringen kunde inte sparas med den angivna revisionen eller nyckeln.', code, 409)
    }
    if (['profile_service_required', 'profile_actor_forbidden', 'profile_delegation_forbidden',
      'profile_customer_unavailable', 'profile_tenant_unavailable'].includes(code)) {
      throw new ApiInputError('Ett giltigt och aktivt mandat krävs.', code, 403)
    }
    if (code === 'facility_resource_not_found') {
      throw new ApiInputError('Anläggningsreferensen hittades inte för kunden.', 'resource_not_found', 404, 'facility_data.facility_reference')
    }
    if (['invalid_profile_command', 'invalid_profile_preferences', 'profile_revision_required',
      'invalid_facility_command', 'facility_address_revision_required', 'facility_candidate_invalid',
      'profile_metadata_not_supported'].includes(code)) {
      throw new ApiInputError('Profil- eller anläggningskommandot är ogiltigt.', code, 422)
    }
    throw error
  }
  const result = data as Record<string, unknown> | null
  if (!result || !Number.isSafeInteger(result.statusCode) || Number(result.statusCode) < 200 || Number(result.statusCode) > 599 ||
    !result.body || typeof result.body !== 'object' || Array.isArray(result.body) || typeof result.replayed !== 'boolean') {
    throw new ApiInputError('Profilresultatet kunde inte verifieras.', 'profile_result_invalid', 503)
  }
  return { statusCode: result.statusCode as number, body: result.body as Record<string, unknown>, replayed: result.replayed }
}

export async function changeCustomerProfilePreferences(input: CustomerProfileCommandInput): Promise<CustomerProfileCommandResult> {
  return executeCustomerProfileRpc('gridex_change_customer_profile_preferences_v1', customerProfileCommand(input))
}
