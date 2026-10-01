export type AdminCustomerPortalAccountRow = {
  id: string
  user_id: string | null
  user_email: string | null
  customer_id: string | null
  role: string
  is_active: boolean
  invited_at: string | null
  activated_at: string | null
  verified_at: string | null
  last_seen_at: string | null
  match_method: string | null
  verified_identity_snapshot: Record<string, unknown>
  notes: string | null
  created_at: string
  updated_at: string
}

export type AdminCustomerPortalClaimRow = {
  id: string
  user_id: string | null
  user_email: string | null
  customer_id: string | null
  status: string
  match_method: string | null
  personal_number_last4: string | null
  email_matched: boolean | null
  name_matched: boolean | null
  personal_number_matched: boolean | null
  installation_matched: boolean | null
  matched_site_id: string | null
  matched_metering_point_id: string | null
  failure_reason: string | null
  input_snapshot: Record<string, unknown>
  match_snapshot: Record<string, unknown>
  created_at: string
  updated_at: string
}

type AccountReadRow = Omit<AdminCustomerPortalAccountRow, 'notes' | 'verified_identity_snapshot'> & {
  status: string
  verified_identity_snapshot: unknown
}
type ClaimReadRow = Pick<AdminCustomerPortalClaimRow, 'id' | 'user_id' | 'customer_id' | 'status' | 'created_at' | 'updated_at'> & {
  metadata: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function own(value: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 ? value : null
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function storedSnapshot(value: unknown, stringKeys: readonly string[], flagKeys: readonly string[] = []): Record<string, unknown> {
  const input = record(value)
  const output: Record<string, unknown> = {}
  for (const key of stringKeys) {
    const saved = text(own(input, key))
    if (saved !== null) output[key] = saved
  }
  for (const key of flagKeys) {
    const saved = flag(own(input, key))
    if (saved !== null) output[key] = saved
  }
  return output
}

export function projectAdminPortalAccount(row: AccountReadRow): AdminCustomerPortalAccountRow {
  return {
    id: row.id,
    user_id: row.user_id,
    user_email: row.user_email,
    customer_id: row.customer_id,
    role: row.role,
    is_active: row.is_active && row.status === 'active',
    invited_at: row.invited_at,
    activated_at: row.activated_at,
    verified_at: row.verified_at,
    last_seen_at: row.last_seen_at,
    match_method: row.match_method,
    verified_identity_snapshot: record(row.verified_identity_snapshot),
    // There is no canonical account notes column or established portal-note writer.
    notes: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function projectAdminPortalClaim(row: ClaimReadRow): AdminCustomerPortalClaimRow {
  const saved = record(row.metadata)
  // A status, current customer record or unversioned historical JSON is not match evidence.
  const source = own(saved, 'source')
  const metadata = own(saved, 'schemaVersion') === 1
    && (source === 'native_account_completion_reconstructed_v1'
      || (source === 'native_self_claim_attempt_v1' && row.status === 'rejected')) ? saved : {}
  const last4 = text(own(metadata, 'personal_number_last4'))
  return {
    id: row.id,
    user_id: row.user_id,
    customer_id: row.customer_id,
    status: row.status,
    user_email: text(own(metadata, 'user_email')),
    match_method: text(own(metadata, 'match_method')),
    personal_number_last4: last4 !== null && /^\d{4}$/.test(last4) ? last4 : null,
    email_matched: flag(own(metadata, 'email_matched')),
    name_matched: flag(own(metadata, 'name_matched')),
    personal_number_matched: flag(own(metadata, 'personal_number_matched')),
    installation_matched: flag(own(metadata, 'installation_matched')),
    matched_site_id: text(own(metadata, 'matched_site_id')),
    matched_metering_point_id: text(own(metadata, 'matched_metering_point_id')),
    failure_reason: text(own(metadata, 'failure_reason')),
    input_snapshot: storedSnapshot(own(metadata, 'input_snapshot'), [
      'email', 'firstName', 'lastName', 'fullName', 'personalNumberLast4', 'installationId', 'companySlug',
    ]),
    match_snapshot: storedSnapshot(own(metadata, 'match_snapshot'), [
      'customerId', 'customerNumber', 'matchedSiteId', 'matchedMeteringPointId',
    ], ['emailMatched', 'nameMatched', 'personalNumberMatched', 'installationMatched']),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
