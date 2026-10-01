import 'server-only'
import { supabaseService } from '@/lib/supabase/service'
import { readLockedEffectiveBillingProfile, type BillingProfileFields, type EffectiveBillingProfile } from '@/lib/billing/effectiveBillingProfile'
import { billingConfigurationSnapshotSha256, serializeBillingConfigurationSnapshot } from '@/lib/billing/billingConfigurationSnapshot'
import { customerProfileCommand, customerProfileSchemaError, type CustomerProfileCommandInput, type CustomerProfileCommandResult } from '@/lib/customer-operations/profilePreferencesCommand'

export type BillingProfileActor = { kind: 'ops'; userId: string; sessionId: string; reason: string } | { kind: 'api'; clientId: string; subject: string }
export type BillingProfileCommandResult = {
  revision: number; changed: boolean; replayed: boolean; affectedContractIds: string[]
  completionReference?: string; createdAt?: string
  contractOverrideRevision?: number
}
export class BillingProfileCommandError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'BillingProfileCommandError' }
}

export async function changeCustomerBillingProfile(input: {
  companyId: string; customerId: string; actor: BillingProfileActor; expectedRevision: number
  idempotencyKey: string; changes: BillingProfileFields
  contractId?: string; expectedOverrideRevision?: number; inheritFields?: Array<keyof BillingProfileFields>
}): Promise<BillingProfileCommandResult> {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
      || (Object.keys(input.changes).length === 0 && !input.inheritFields?.length)
      || Object.keys(input.changes).some(key => !['recipient', 'distributionMethod', 'email', 'reference', 'street', 'postalCode', 'city', 'country'].includes(key))) {
    throw new BillingProfileCommandError('invalid_billing_profile_command', 422)
  }
  const result = await supabaseService.rpc('gridex_change_customer_billing_profile_v1', { p_command: {
    companyId: input.companyId, customerId: input.customerId, mode: input.actor.kind,
    actorUserId: input.actor.kind === 'ops' ? input.actor.userId : null,
    sessionId: input.actor.kind === 'ops' ? input.actor.sessionId : null,
    clientId: input.actor.kind === 'api' ? input.actor.clientId : null,
    subject: input.actor.kind === 'api' ? input.actor.subject : null,
    reason: input.actor.kind === 'ops' ? input.actor.reason : null,
    expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey, changes: input.changes,
    ...(input.contractId ? { contractId: input.contractId, expectedOverrideRevision: input.expectedOverrideRevision,
      inheritFields: input.inheritFields ?? [] } : {}),
  } })
  if (result.error) {
    const code = String(result.error.message ?? '')
    if (['billing_profile_revision_conflict', 'billing_profile_idempotency_conflict'].includes(code)) throw new BillingProfileCommandError(code, 409)
    if (['billing_profile_actor_forbidden', 'billing_profile_delegation_forbidden', 'billing_profile_customer_unavailable', 'billing_profile_tenant_unavailable'].includes(code)) throw new BillingProfileCommandError(code, 403)
    if (['invalid_billing_profile_command', 'invalid_billing_profile_field'].includes(code)) throw new BillingProfileCommandError(code, 422)
    throw new BillingProfileCommandError('billing_profile_unavailable', 503)
  }
  const data = result.data as Record<string, unknown> | null
  if (!data || data.companyId !== input.companyId || data.customerId !== input.customerId
      || !Number.isSafeInteger(data.revision) || typeof data.changed !== 'boolean' || typeof data.replayed !== 'boolean'
      || !Array.isArray(data.affectedContractIds) || data.affectedContractIds.some(id => typeof id !== 'string')) {
    throw new BillingProfileCommandError('billing_profile_result_invalid', 503)
  }
  return { revision: data.revision as number, changed: data.changed, replayed: data.replayed,
    affectedContractIds: data.affectedContractIds as string[],
    ...(typeof data.completionReference === 'string' ? { completionReference: data.completionReference } : {}),
    ...(typeof data.createdAt === 'string' ? { createdAt: data.createdAt } : {}),
    ...(Number.isSafeInteger(data.contractOverrideRevision) ? { contractOverrideRevision: data.contractOverrideRevision as number } : {}),
  }
}

export async function changeContractBillingOverride(input: Parameters<typeof changeCustomerBillingProfile>[0] & {
  contractId: string; expectedOverrideRevision: number; actor: Extract<BillingProfileActor, { kind: 'ops' }>
}) {
  if (!Number.isSafeInteger(input.expectedOverrideRevision) || input.expectedOverrideRevision < 0) {
    throw new BillingProfileCommandError('invalid_billing_profile_command', 422)
  }
  return changeCustomerBillingProfile(input)
}

/** API profile updates share one durable route claim with contact, preference
 * and facility updates. The database checks today's mandate before replaying
 * an original result, and enforces new revisions only for fresh commands. */
export async function changeCustomerBillingProfileFromApi(input: CustomerProfileCommandInput): Promise<CustomerProfileCommandResult> {
  if (input.actor.kind !== 'api') throw new BillingProfileCommandError('invalid_billing_profile_command', 422)
  const { data, error } = await supabaseService.rpc('gridex_change_customer_billing_profile_api_v1', {
    p_command: customerProfileCommand(input),
  })
  if (error) {
    customerProfileSchemaError(error)
    const code = String(error.message ?? '')
    if (['idempotency_conflict', 'idempotency_previous_attempt_failed', 'idempotency_in_progress',
      'billing_profile_idempotency_conflict', 'billing_profile_revision_conflict'].includes(code)) throw new BillingProfileCommandError(code, 409)
    if (['profile_service_required', 'profile_actor_forbidden', 'profile_delegation_forbidden', 'profile_customer_unavailable',
      'profile_tenant_unavailable', 'billing_profile_delegation_forbidden', 'billing_profile_customer_unavailable',
      'billing_profile_tenant_unavailable'].includes(code)) throw new BillingProfileCommandError(code, 403)
    if (['invalid_profile_command', 'invalid_billing_profile_command', 'invalid_billing_profile_field',
      'billing_profile_revision_required'].includes(code)) throw new BillingProfileCommandError(code, 422)
    throw new BillingProfileCommandError('billing_profile_unavailable', 503)
  }
  const result = data as Record<string, unknown> | null
  if (!result || !Number.isSafeInteger(result.statusCode) || Number(result.statusCode) < 200 || Number(result.statusCode) > 599
      || !result.body || typeof result.body !== 'object' || Array.isArray(result.body) || typeof result.replayed !== 'boolean') {
    throw new BillingProfileCommandError('billing_profile_result_invalid', 503)
  }
  return { statusCode: result.statusCode as number, body: result.body as Record<string, unknown>, replayed: result.replayed }
}

/** Revision checks and the underlay write occur inside one database transaction.
 * Both profile edits and this lock acquire the customer before the underlay. */
export async function lockBillingConfiguration(input: {
  companyId: string; underlayId: string; effectiveProfile: EffectiveBillingProfile
  snapshot: Record<string, unknown>; snapshotSha256: string
}): Promise<Record<string, unknown>> {
  const expected = { companyId: input.companyId,
    customerId: input.effectiveProfile.customerId, contractId: input.effectiveProfile.contractId ?? '' }
  if (!readLockedEffectiveBillingProfile(input.snapshot, expected)
      || billingConfigurationSnapshotSha256(input.snapshot) !== input.snapshotSha256) {
    throw new BillingProfileCommandError('invalid_billing_configuration_snapshot', 422)
  }
  const result = await supabaseService.rpc('gridex_lock_billing_configuration_v2', {
    p_company_id: input.companyId, p_underlay_id: input.underlayId,
    p_expected_profile_revision: input.effectiveProfile.profileRevision,
    p_expected_override_revision: input.effectiveProfile.contractOverrideRevision,
    p_snapshot: input.snapshot, p_snapshot_sha256: input.snapshotSha256,
    p_snapshot_json: serializeBillingConfigurationSnapshot(input.snapshot),
  })
  if (result.error) throw new BillingProfileCommandError(String(result.error.message ?? 'billing_configuration_unavailable'), 409)
  const data = result.data as Record<string, unknown> | null
  if (!data || !readLockedEffectiveBillingProfile(data, expected)) {
    throw new BillingProfileCommandError('billing_configuration_result_invalid', 503)
  }
  if (billingConfigurationSnapshotSha256(data) !== input.snapshotSha256) {
    throw new BillingProfileCommandError('billing_configuration_already_locked', 409)
  }
  return data
}
