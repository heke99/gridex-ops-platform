import { ApiInputError } from '@/lib/api/strictRequest'
import { supabaseService } from '@/lib/supabase/service'
import { tenantInsert, tenantSelect, tenantUpdate } from '@/lib/supabase/tenantQuery'
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
  | { kind: 'staff'; userId: string; apiClientId?: string }
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
  if (message === 'customer_merged_write_conflict') {
    return new ContactChangeTransactionError('version_conflict', 'Kundkopplingen har ändrats. Hämta profilen och försök igen.')
  }
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

type ContactChangeInput = {
  companyId: string
  customerId: string
  actor: ContactChangeActor
  channel: 'ops' | 'customer_api' | 'phone' | 'staff_api'
  expectedUpdatedAt: string | null
  customerPatch: Record<string, unknown>
  contactPatch: Record<string, string | null>
  idempotencyKey?: string | null
}

/** The RPC is not deployed in this database yet (migration 20261001210000 not applied). */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883' ||
    (error.message ?? '').includes('gridex_customer_contact_change_v1') && /could not find|does not exist/i.test(error.message ?? '')
}

/**
 * Deploy-safety fallback until the migration is applied in a given database: the previous
 * sequential behaviour (version-locked customer update, primary contact, fail-closed audit).
 * Remove once every environment has migration 20261001210000.
 */
async function applySequentialContactChange(input: ContactChangeInput): Promise<ContactChangeResult> {
  const existing = await tenantSelect(input.companyId, 'customers', '*').eq('id', input.customerId).maybeSingle()
  if (existing.error) throw existing.error
  const before = existing.data as Record<string, unknown> | null
  if (!before) throw new ContactChangeTransactionError('not_found', 'Kunden hittades inte för aktuell tenant.')
  if (before.merged_into_customer_id) {
    throw new ContactChangeTransactionError('version_conflict', 'Kundkopplingen har ändrats. Hämta profilen och försök igen.')
  }
  if (String(before.status ?? '').toLowerCase() === 'archived') {
    throw new ContactChangeTransactionError('customer_archived', 'Arkiverad kund kan inte ändras via vanlig profil.')
  }
  if (input.expectedUpdatedAt && String(before.updated_at ?? '') !== input.expectedUpdatedAt) {
    throw new ContactChangeTransactionError('version_conflict', 'Kunden ändrades samtidigt. Hämta profilen och försök igen.')
  }
  const changes: ContactChangeResult['changes'] = {}
  for (const [key, value] of Object.entries(input.customerPatch)) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(value ?? null)) changes[key] = { from: before[key] ?? null, to: value ?? null }
  }
  let updatedAt = typeof before.updated_at === 'string' ? before.updated_at : null
  if (Object.keys(changes).length > 0) {
    let update = tenantUpdate(input.companyId, 'customers', { ...input.customerPatch, updated_at: new Date().toISOString() })
      .eq('id', input.customerId)
    if (updatedAt) update = update.eq('updated_at', updatedAt)
    const result = await update.select('id,updated_at').maybeSingle()
    if (result.error) throw result.error
    if (!result.data) throw new ContactChangeTransactionError('version_conflict', 'Kunden ändrades samtidigt. Hämta profilen och försök igen.')
    updatedAt = String((result.data as Record<string, unknown>).updated_at ?? updatedAt)
  }
  const contactChanges: Record<string, unknown> = {}
  if (Object.keys(input.contactPatch).length > 0) {
    const contact = await tenantSelect(input.companyId, 'customer_contacts', 'id,name,email,phone')
      .eq('customer_id', input.customerId).eq('is_primary', true)
      .order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (contact.error) throw contact.error
    const primary = contact.data as Record<string, unknown> | null
    if (primary?.id) {
      for (const [key, value] of Object.entries(input.contactPatch)) {
        if ((primary[key] ?? null) !== (value ?? null)) contactChanges[key] = { from: primary[key] ?? null, to: value ?? null }
      }
      if (Object.keys(contactChanges).length > 0) {
        const updated = await tenantUpdate(input.companyId, 'customer_contacts', input.contactPatch)
          .eq('id', String(primary.id)).eq('customer_id', input.customerId)
        if (updated.error) throw updated.error
      }
    } else {
      const inserted = await tenantInsert(input.companyId, 'customer_contacts', {
        customer_id: input.customerId, type: 'primary', title: null, is_primary: true,
        name: input.contactPatch.name ?? null, email: input.contactPatch.email ?? null, phone: input.contactPatch.phone ?? null,
      })
      if (inserted.error) throw inserted.error
      contactChanges.created = true
    }
  }
  if (Object.keys(changes).length === 0 && Object.keys(contactChanges).length === 0) {
    return { replayed: false, changed: false, domainEventId: null, customerUpdatedAt: updatedAt, changes, primaryContactChanges: contactChanges }
  }
  const staff = input.actor.kind === 'staff' ? input.actor : null
  const portal = input.actor.kind === 'customer_portal' ? input.actor : null
  const audit = await tenantInsert(input.companyId, 'audit_logs', {
    actor_user_id: staff?.userId ?? null,
    entity_type: 'customer',
    entity_id: input.customerId,
    action: 'customer_profile_updated',
    old_values: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.from])),
    new_values: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])),
    metadata: {
      channel: input.channel,
      actor_type: staff ? 'staff' : 'customer_portal_account',
      api_client_id: staff?.apiClientId ?? portal?.apiClientId ?? null,
      portal_identity_id: portal?.portalIdentityId ?? null,
      primary_contact_changes: contactChanges,
      transaction: 'sequential_fallback',
    },
  })
  if (audit.error) throw audit.error
  return { replayed: false, changed: true, domainEventId: null, customerUpdatedAt: updatedAt, changes, primaryContactChanges: contactChanges }
}

export async function applyCustomerContactChange(input: {
  companyId: string
  customerId: string
  actor: ContactChangeActor
  channel: 'ops' | 'customer_api' | 'phone' | 'staff_api'
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
    p_api_client_id: staff?.apiClientId ?? portal?.apiClientId ?? null,
    p_portal_identity_id: portal?.portalIdentityId ?? null,
    p_channel: input.channel,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_customer_patch: input.customerPatch as Json,
    p_contact_patch: input.contactPatch as Json,
    p_idempotency_key: input.idempotencyKey ?? null,
  } as unknown as ContactChangeArgs)
  if (error) {
    if (isMissingFunction(error)) {
      if (input.channel === 'staff_api') {
        throw new ApiInputError('Kontaktändringen är inte tillgänglig ännu.', 'contact_change_unavailable', 503)
      }
      console.warn('[customer-service] contact_change_rpc_missing_fallback', { companyId: input.companyId })
      return applySequentialContactChange(input)
    }
    throw mapError(error)
  }
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
