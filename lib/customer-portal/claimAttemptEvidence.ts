import 'server-only'
import { supabaseService } from '@/lib/supabase/service'

export type RejectedClaimAttempt = {
  userId: string
  userEmail: string | null
  companyId?: string | null
  customerId?: string | null
  personalNumberLast4: string | null
  inputSnapshot: Record<string, unknown>
  matchSnapshot: Record<string, unknown>
  flags: { emailMatched: boolean; nameMatched: boolean; personalNumberMatched: boolean; installationMatched: boolean }
  matchedSiteId?: string | null
  matchedMeteringPointId?: string | null
  reason: 'no_candidate' | 'ambiguous_strict_match' | 'identity_mismatch'
}

const reasons = {
  no_candidate: 'Inget kundkort matchade angivet personnummer.',
  ambiguous_strict_match: 'Flera kundkort matchade alla säkerhetsvillkor. Kopplingen kräver manuell hantering.',
  identity_mismatch: 'Ett eller flera säkerhetsvillkor matchade inte.',
} as const
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function identifier(value: string | null | undefined, required = false) {
  if (value == null && !required) return null
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('portal_claim_attempt_invalid')
  return value
}
function text(value: unknown) {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('portal_claim_attempt_invalid')
  // Match the existing reader's explicit unknown boundary. Do not truncate a
  // submitted fact or turn an oversized rejected input into a new grant.
  return value.length <= 2048 ? value : null
}
function snapshot(value: Record<string, unknown>, keys: readonly string[], flags: readonly string[] = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('portal_claim_attempt_invalid')
  const saved: Record<string, unknown> = {}
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    const item = text(value[key])
    if (key === 'personalNumberLast4' && item !== null && !/^\d{4}$/.test(item)) throw new Error('portal_claim_attempt_invalid')
    saved[key] = item
  }
  for (const key of flags) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    if (typeof value[key] !== 'boolean') throw new Error('portal_claim_attempt_invalid')
    saved[key] = value[key]
  }
  return saved
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

/** These are server-observed rejected attempts, never a verified relationship.
 * A single canonical INSERT stores all candidates for this attempt atomically.
 * Its durable row receipts must match the intended tuples and saved facts. */
export async function insertRejectedClaimAttempts(attempts: readonly RejectedClaimAttempt[]) {
  if (attempts.length === 0 || attempts.length > 10) throw new Error('portal_claim_attempt_invalid')
  const rows = attempts.map(attempt => {
    if (!Object.prototype.hasOwnProperty.call(reasons, attempt.reason)
      || attempt.flags === null || typeof attempt.flags !== 'object'
      || Object.values(attempt.flags).some(flag => typeof flag !== 'boolean')
      || ['emailMatched', 'nameMatched', 'personalNumberMatched', 'installationMatched'].some(key =>
        typeof attempt.flags[key as keyof RejectedClaimAttempt['flags']] !== 'boolean')
      || (attempt.personalNumberLast4 !== null && !/^\d{4}$/.test(attempt.personalNumberLast4))) {
      throw new Error('portal_claim_attempt_invalid')
    }
    const company = identifier(attempt.companyId), customer = identifier(attempt.customerId)
    if (customer !== null && company === null) throw new Error('portal_claim_attempt_invalid')
    return { user_id: identifier(attempt.userId, true), company_id: company, customer_id: customer,
      claim_type: 'customer_access', status: 'rejected', metadata: {
        schemaVersion: 1, source: 'native_self_claim_attempt_v1', attempt_reason: attempt.reason,
        user_email: text(attempt.userEmail), match_method: 'self_claim_strict_identity',
        personal_number_last4: attempt.personalNumberLast4,
        email_matched: attempt.flags.emailMatched, name_matched: attempt.flags.nameMatched,
        personal_number_matched: attempt.flags.personalNumberMatched, installation_matched: attempt.flags.installationMatched,
        matched_site_id: identifier(attempt.matchedSiteId), matched_metering_point_id: identifier(attempt.matchedMeteringPointId),
        failure_reason: reasons[attempt.reason],
        input_snapshot: snapshot(attempt.inputSnapshot, ['email', 'firstName', 'lastName', 'fullName', 'personalNumberLast4', 'installationId', 'companySlug']),
        match_snapshot: snapshot(attempt.matchSnapshot, ['reason', 'customerId', 'customerNumber', 'matchedSiteId', 'matchedMeteringPointId'],
          ['emailMatched', 'nameMatched', 'personalNumberMatched', 'installationMatched']),
      } }
  })
  const { data, error } = await supabaseService.from('customer_portal_claims').insert(rows)
    .select('id,user_id,company_id,customer_id,claim_type,status,metadata')
  if (error) throw error
  const remaining = rows.map(row => canonical(row)), ids = new Set<string>()
  if (!Array.isArray(data) || data.length !== rows.length) throw new Error('portal_claim_attempt_receipt_unavailable')
  for (const row of data) {
    if (typeof row.id !== 'string' || !uuid.test(row.id) || ids.has(row.id)) throw new Error('portal_claim_attempt_receipt_unavailable')
    ids.add(row.id)
    const index = remaining.indexOf(canonical({ user_id: row.user_id, company_id: row.company_id, customer_id: row.customer_id,
      claim_type: row.claim_type, status: row.status, metadata: row.metadata }))
    if (index < 0) throw new Error('portal_claim_attempt_receipt_unavailable')
    remaining.splice(index, 1)
  }
  return data.map(row => row.id)
}
