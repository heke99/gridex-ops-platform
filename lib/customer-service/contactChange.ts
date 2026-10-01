/**
 * Shared customer contact-change rules used by both OPS (customer card) and the customer API.
 *
 * Field semantics for patches:
 * - `undefined` (omitted): leave the stored value untouched.
 * - `null`: explicitly clear the stored value (only where the field may be cleared).
 * - string: set the normalized value.
 *
 * A phone change therefore never clears the rest of the profile.
 */

export type FieldPatch<T> = T | null | undefined

/** Statuses a normal profile edit may set. Archive/restore/lifecycle use separate controlled flows. */
export const PROFILE_EDITABLE_CUSTOMER_STATUSES = [
  'draft',
  'pending_verification',
  'active',
  'inactive',
  'moved',
  'terminated',
  'blocked',
] as const

export type ProfileEditableCustomerStatus = (typeof PROFILE_EDITABLE_CUSTOMER_STATUSES)[number]

export class CustomerContactChangeError extends Error {
  constructor(
    readonly code:
      | 'invalid_status'
      | 'invalid_email'
      | 'invalid_phone'
      | 'version_conflict',
    message: string,
  ) {
    super(message)
    this.name = 'CustomerContactChangeError'
  }
}

export function assertProfileEditableStatus(
  value: string | null | undefined,
  fallback: ProfileEditableCustomerStatus,
): ProfileEditableCustomerStatus {
  const status = (value ?? '').trim().toLowerCase()
  if (!status) return fallback
  if ((PROFILE_EDITABLE_CUSTOMER_STATUSES as readonly string[]).includes(status)) {
    return status as ProfileEditableCustomerStatus
  }
  throw new CustomerContactChangeError(
    'invalid_status',
    status === 'archived'
      ? 'Arkivering görs via arkivflödet, inte via profilredigering.'
      : 'Ogiltig kundstatus.',
  )
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeContactEmail(value: FieldPatch<string>): FieldPatch<string> {
  if (value === undefined || value === null) return value
  const email = value.trim().toLowerCase()
  if (!email) return null
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw new CustomerContactChangeError('invalid_email', 'Ogiltig e-postadress.')
  }
  return email
}

export function normalizeContactPhone(value: FieldPatch<string>): FieldPatch<string> {
  if (value === undefined || value === null) return value
  const phone = value.trim()
  if (!phone) return null
  // Validate the digits but keep the operator's formatting, so unrelated saves do not rewrite it.
  if (phone.length > 32 || !/^\+?[0-9]{5,20}$/.test(phone.replace(/[\s.\-/()]/g, ''))) {
    throw new CustomerContactChangeError('invalid_phone', 'Ogiltigt telefonnummer.')
  }
  return phone
}

type PrimaryContactInput = {
  customerType: 'private' | 'business' | 'association' | string
  contactName: string | null
  email: FieldPatch<string>
  phone: FieldPatch<string>
}

/**
 * Decides how the primary contact follows a customer profile change.
 *
 * Private customers: the customer is the contact, so the primary contact mirrors the profile,
 * including explicit clears.
 *
 * Business/association customers: the primary contact is a person, not the legal party or the
 * invoice recipient. Customer-level changes may fill in the contact, but an empty customer field
 * never wipes the contact person's own email/phone.
 */
export function planPrimaryContactSync(input: PrimaryContactInput): Record<string, string | null> {
  const patch: Record<string, string | null> = {}
  const mirror = input.customerType === 'private'
  if (input.contactName) patch.name = input.contactName
  for (const key of ['email', 'phone'] as const) {
    const value = input[key]
    if (value === undefined) continue
    if (value === null && !mirror) continue
    patch[key] = value
  }
  return patch
}

/** Only fields that actually change, so audit and outbox carry no unchanged personal data. */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {}
  for (const [key, value] of Object.entries(after)) {
    if (key === 'updated_at') continue
    const previous = before[key] ?? null
    if ((value ?? null) !== previous) diff[key] = { from: previous, to: value ?? null }
  }
  return diff
}
