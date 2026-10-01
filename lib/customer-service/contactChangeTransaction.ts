import { supabaseService } from '@/lib/supabase/service'
import type { Database, Json } from '@/supabase/database.types'

// Generated Args mark every parameter non-null; the SQL function accepts null for the optional ones.
type ContactChangeArgs = Database['public']['Functions']['gridex_customer_contact_change_v1']['Args']

/**
 * Tenantservice P2b: the single write path for a customer contact/profile change.
 *
 * OPS and the customer API both call `gridex_customer_contact_change_v1`, which in one database
 * transaction locks the customer, checks the expected version, applies the allow-listed fields and
 * the primary-contact patch, and writes audit + domain event + outbox. A failure leaves nothing
 * half-written. Callers keep their own input validation (contactChange.ts) and error mapping.
 */

export type ContactChangeActor =
  | { kind: 'staff'; userId: string }
  | { kind: 'customer_portal'; apiClientId: string; portalIdentityId: string | null }

export type ContactChangeErrorCode =
  | 'version_conflict'
  | 'not_found'
  | 'not_authorized'
  | 'customer_archived'
  | 'invalid_request'

export class ContactChangeTransactionError extends Error {
  constructor(readonly code: ContactChangeErrorCode, message: string) {
    super(message)
    this.name = 'ContactChangeTransactionError'
  }
}

export type ContactChangeResult = {
  replayed: boolean
  changed: boolean
  domainEventId: string | null
  customerUpdatedAt: string | null
  changes: Record<string, { from: unknown; to: unknown }>
  primaryContactChanges: Record<string, unknown>
}

function mapError(error: { code?: string; message?: string }): Error {
  const message = error.message ?? ''
  if (error.code === '40001' || message.includes('contact_change_version_conflict')) {
    return new ContactChangeTransactionError('version_conflict', 'Kunden ändrades samtidigt. Hämta profilen och försök igen.')
  }
  if (error.code === 'P0002') return new ContactChangeTransactionError('not_found', 'Kunden hittades inte för aktuell tenant.')
  if (message.includes('contact_change_customer_archived')) {
    return new ContactChangeTransactionError('customer_archived', 'Arkiverad kund kan inte ändras via vanlig profil.')
  }
  if (error.code === '42501') return new ContactChangeTransactionError('not_authorized', 'Behörighet saknas för att ändra kunduppgifter.')
  if (error.code === '22023') return new ContactChangeTransactionError('invalid_request', 'Ogiltig ändring av kunduppgifter.')
  return Object.assign(new Error(message || 'contact_change_failed'), { code: error.code })
}

export async function applyCustomerContactChange(input: {
  companyId: string
  customerId: string
  actor: ContactChangeActor
  channel: 'ops' | 'customer_api' | 'phone'
  expectedUpdatedAt: string | null
  customerPatch: Record<string, unknown>
  contactPatch: Record<string, string | null>
  idempotencyKey?: string | null
}): Promise<ContactChangeResult> {
  const staff = input.actor.kind === 'staff' ? input.actor : null
  const portal = input.actor.kind === 'customer_portal' ? input.actor : null
  const { data, error } = await supabaseService.rpc('gridex_customer_contact_change_v1', {
    p_company_id: input.companyId,
    p_customer_id: input.customerId,
    p_actor_kind: input.actor.kind,
    p_actor_user_id: staff?.userId ?? null,
    p_api_client_id: portal?.apiClientId ?? null,
    p_portal_identity_id: portal?.portalIdentityId ?? null,
    p_channel: input.channel,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_customer_patch: input.customerPatch as Json,
    p_contact_patch: input.contactPatch as Json,
    p_idempotency_key: input.idempotencyKey ?? null,
  } as unknown as ContactChangeArgs)
  if (error) throw mapError(error)
  const result = (data ?? {}) as Record<string, unknown>
  return {
    replayed: result.replayed === true,
    changed: result.changed === true || result.replayed === true,
    domainEventId: typeof result.domain_event_id === 'string' ? result.domain_event_id : null,
    customerUpdatedAt: typeof result.customer_updated_at === 'string' ? result.customer_updated_at : null,
    changes: (result.changes ?? {}) as ContactChangeResult['changes'],
    primaryContactChanges: (result.primary_contact_changes ?? {}) as Record<string, unknown>,
  }
}
