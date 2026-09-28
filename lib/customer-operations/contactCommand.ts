import 'server-only'
import { supabaseService } from '@/lib/supabase/service'

export type ContactChanges = {
  email?: string | null
  phone?: string | null
  name?: string | null
  title?: string | null
}
export type ContactActor =
  | { kind: 'ops'; userId: string; reason: string }
  | { kind: 'api'; clientId: string; subject: string }

export class ContactCommandError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
    this.name = 'ContactCommandError'
  }
}

export async function changeCustomerContact(input: {
  companyId: string
  customerId: string
  contactId?: string | null
  contactTarget?: 'secondary'
  contactType?: 'billing' | 'operations' | 'technical' | 'other'
  actor: ContactActor
  expectedRevision: number
  idempotencyKey: string
  changes: ContactChanges
}): Promise<{ revision: number; changed: boolean; replayed: boolean; completionReference?: string; createdAt?: string }> {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
      Object.keys(input.changes).length === 0 ||
      Object.keys(input.changes).some(key => !['email', 'phone', 'name', 'title'].includes(key)) ||
      (input.actor.kind === 'api' && ('name' in input.changes || 'title' in input.changes)) ||
      (input.contactTarget === 'secondary' &&
        (input.actor.kind !== 'ops' || !['billing', 'operations', 'technical', 'other'].includes(input.contactType ?? ''))) ||
      (input.contactTarget !== 'secondary' && input.contactType !== undefined)) {
    throw new ContactCommandError('invalid_contact_command', 422)
  }
  const p_command = {
    companyId: input.companyId,
    customerId: input.customerId,
    contactId: input.contactId ?? null,
    ...(input.contactTarget === 'secondary'
      ? { contactTarget: 'secondary', contactType: input.contactType }
      : {}),
    mode: input.actor.kind,
    actorUserId: input.actor.kind === 'ops' ? input.actor.userId : null,
    clientId: input.actor.kind === 'api' ? input.actor.clientId : null,
    subject: input.actor.kind === 'api' ? input.actor.subject : null,
    reason: input.actor.kind === 'ops' ? input.actor.reason : null,
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
    changes: input.changes,
  }
  const { data, error } = await supabaseService.rpc(
    'gridex_change_customer_contact_v1',
    { p_command },
  )
  if (error) {
    const code = String(error.message ?? '')
    if (code === 'contact_revision_conflict' || code === 'contact_idempotency_conflict' ||
        code === 'contact_selection_conflict')
      throw new ContactCommandError(code, 409)
    if (code === 'contact_actor_forbidden' || code === 'contact_delegation_forbidden' ||
        code === 'contact_customer_unavailable' || code === 'contact_tenant_unavailable')
      throw new ContactCommandError(code, 403)
    if (code === 'invalid_contact_command' || code === 'invalid_contact_field' ||
        code === 'contact_method_required' || code === 'ambiguous_primary_contact' ||
        code === 'contact_name_required')
      throw new ContactCommandError(code, 422)
    throw error
  }
  const result = data as Record<string, unknown> | null
  if (!result || !Number.isSafeInteger(result.revision) || typeof result.changed !== 'boolean' ||
      typeof result.replayed !== 'boolean' || result.customerId !== input.customerId ||
      result.companyId !== input.companyId) {
    throw new ContactCommandError('contact_result_invalid', 503)
  }
  return {
    revision: result.revision as number,
    changed: result.changed,
    replayed: result.replayed,
    ...(typeof result.completionReference === 'string' ? { completionReference: result.completionReference } : {}),
    ...(typeof result.createdAt === 'string' ? { createdAt: result.createdAt } : {}),
  }
}
