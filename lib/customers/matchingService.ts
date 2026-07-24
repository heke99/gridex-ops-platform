import { supabaseService } from '@/lib/supabase/service'

/**
 * Shared tenant-scoped customer matching service.
 *
 * This is the single source of truth for "does this identity already exist in
 * this tenant?" used by:
 *  - website customer applications (lib/website/customerApplications.ts)
 *  - external contract intake / teckna-avtal (lib/external-contracts/intake.ts)
 *  - admin manual intake duplicate detection (app/admin/customers/actions.ts)
 *  - EDIEL inbound automation candidate lookup (lib/ediel/matching/customerMatcher.ts)
 *
 * Matching rules:
 *  - Private customer: normalized personal number → email/phone as candidate signals only
 *  - Company customer: normalized org number → email/phone as candidate signals only
 *  - Matching never crosses tenants (company_id is always required).
 *  - Multiple distinct customers on a strong signal → `ambiguous` (needs review),
 *    never silently merged.
 */

export type CustomerMatchSignal =
  | 'personal_number'
  | 'org_number'
  | 'email'
  | 'phone'

export type CustomerMatchStrength = 'strong' | 'medium' | 'weak'

export type CustomerMatchOutcome = 'matched' | 'no_match' | 'ambiguous'

export type MatchedCustomerRow = {
  id: string
  customer_number?: string | null
  email?: string | null
  full_name?: string | null
  company_name?: string | null
  [key: string]: unknown
}

export type CustomerMatchCandidate = {
  customer: MatchedCustomerRow
  matchedBy: CustomerMatchSignal
  strength: CustomerMatchStrength
}

export type CustomerMatchDecision = {
  outcome: CustomerMatchOutcome
  customer: MatchedCustomerRow | null
  matchedBy: CustomerMatchSignal | null
  candidates: CustomerMatchCandidate[]
  needsReview: boolean
  /** Structured metadata callers should persist on audit/timeline records. */
  auditMetadata: {
    matcher: 'customer_matching_service_v1'
    company_id: string
    outcome: CustomerMatchOutcome
    matched_by: CustomerMatchSignal | null
    matched_customer_id: string | null
    candidate_customer_ids: string[]
    evaluated_signals: CustomerMatchSignal[]
    evaluated_at: string
  }
}

export type CustomerMatchInput = {
  companyId: string
  personalNumber?: string | null
  orgNumber?: string | null
  email?: string | null
  phone?: string | null
  /**
   * Columns to select on matched customer rows. Defaults to the common set
   * required by intake flows.
   */
  select?: string
}

const DEFAULT_SELECT =
  'id,customer_number,email,full_name,company_name,first_name,last_name,phone,personal_number,org_number,customer_type,status,metadata'

export function normalizeIdentityDigits(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const output = value.replace(/\D/g, '')
  return output || null
}

export function normalizeMatchEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const output = value.trim().toLowerCase()
  return output || null
}

export function normalizeMatchPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let output = value.replace(/[^\d+]/g, '')
  if (output.startsWith('00')) output = `+${output.slice(2)}`
  if (output.startsWith('0')) output = `+46${output.slice(1)}`
  return output.length >= 7 ? output : null
}

function schemaMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  return ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(code)
}

async function findCustomersByColumn(input: {
  companyId: string
  column: string
  value: string
  select: string
  limit: number
}): Promise<MatchedCustomerRow[]> {
  const { data, error } = await supabaseService
    .from('customers')
    .select(input.select)
    .eq('company_id', input.companyId)
    .eq(input.column, input.value)
    .order('created_at', { ascending: false })
    .limit(input.limit)

  if (error) {
    if (schemaMissing(error)) return []
    throw error
  }
  return (data ?? []) as unknown as MatchedCustomerRow[]
}

async function findCustomersBySignal(input: {
  companyId: string
  signal: CustomerMatchSignal
  normalizedValue: string
  rawValue: string | null
  select: string
}): Promise<MatchedCustomerRow[]> {
  const limit = 5
  const columnsBySignal: Record<CustomerMatchSignal, string[]> = {
    personal_number: ['normalized_personal_number', 'personal_number'],
    org_number: ['normalized_org_number', 'org_number'],
    email: ['normalized_email', 'email'],
    phone: ['phone'],
  }

  const seen = new Map<string, MatchedCustomerRow>()
  for (const column of columnsBySignal[input.signal]) {
    const isNormalizedColumn = column.startsWith('normalized_')
    const value = isNormalizedColumn ? input.normalizedValue : (input.rawValue ?? input.normalizedValue)
    if (!value) continue
    const rows = await findCustomersByColumn({
      companyId: input.companyId,
      column,
      value,
      select: input.select,
      limit,
    })
    for (const row of rows) {
      if (typeof row.id === 'string' && !seen.has(row.id)) seen.set(row.id, row)
    }
    // Normalized column resolved matches; raw column is only a fallback when
    // normalized columns yielded nothing (legacy rows / missing schema).
    if (isNormalizedColumn && seen.size > 0) break
  }
  return Array.from(seen.values())
}

/**
 * Match an incoming customer identity against existing customers in the same
 * tenant. Only strong identity (person/org number) may produce an automatic
 * match. Email and phone are weak candidate signals and never merge customers
 * on their own.
 */
export async function matchCustomerIdentity(input: CustomerMatchInput): Promise<CustomerMatchDecision> {
  if (!input.companyId) {
    throw new Error('matchCustomerIdentity requires companyId (tenant scope)')
  }

  const select = input.select ?? DEFAULT_SELECT
  const evaluatedSignals: CustomerMatchSignal[] = []
  const candidates: CustomerMatchCandidate[] = []

  const signals: Array<{
    signal: CustomerMatchSignal
    normalizedValue: string | null
    rawValue: string | null
    strength: CustomerMatchStrength
  }> = [
    {
      signal: 'personal_number',
      normalizedValue: normalizeIdentityDigits(input.personalNumber),
      rawValue: typeof input.personalNumber === 'string' ? input.personalNumber.trim() || null : null,
      strength: 'strong',
    },
    {
      signal: 'org_number',
      normalizedValue: normalizeIdentityDigits(input.orgNumber),
      rawValue: typeof input.orgNumber === 'string' ? input.orgNumber.trim() || null : null,
      strength: 'strong',
    },
    {
      signal: 'email',
      normalizedValue: normalizeMatchEmail(input.email),
      rawValue: typeof input.email === 'string' ? input.email.trim() || null : null,
      strength: 'weak',
    },
    {
      signal: 'phone',
      normalizedValue: normalizeMatchPhone(input.phone),
      rawValue: typeof input.phone === 'string' ? input.phone.trim() || null : null,
      strength: 'weak',
    },
  ]

  let decidedOutcome: CustomerMatchOutcome | null = null
  let matchedCustomer: MatchedCustomerRow | null = null
  let matchedBy: CustomerMatchSignal | null = null

  for (const { signal, normalizedValue, rawValue, strength } of signals) {
    if (!normalizedValue) continue
    evaluatedSignals.push(signal)

    const rows = await findCustomersBySignal({
      companyId: input.companyId,
      signal,
      normalizedValue,
      rawValue,
      select,
    })
    for (const row of rows) {
      if (!candidates.some((candidate) => candidate.customer.id === row.id)) {
        candidates.push({ customer: row, matchedBy: signal, strength })
      }
    }

    if (decidedOutcome) continue
    if (strength === 'weak') continue

    if (rows.length === 1) {
      decidedOutcome = 'matched'
      matchedCustomer = rows[0]
      matchedBy = signal
    } else if (rows.length > 1) {
      decidedOutcome = 'ambiguous'
      matchedBy = signal
    }
  }

  const outcome: CustomerMatchOutcome = decidedOutcome ?? 'no_match'

  return {
    outcome,
    customer: outcome === 'matched' ? matchedCustomer : null,
    matchedBy: outcome === 'no_match' ? null : matchedBy,
    candidates,
    needsReview: outcome === 'ambiguous',
    auditMetadata: {
      matcher: 'customer_matching_service_v1',
      company_id: input.companyId,
      outcome,
      matched_by: outcome === 'no_match' ? null : matchedBy,
      matched_customer_id: outcome === 'matched' && matchedCustomer ? matchedCustomer.id : null,
      candidate_customer_ids: candidates.map((candidate) => candidate.customer.id),
      evaluated_signals: evaluatedSignals,
      evaluated_at: new Date().toISOString(),
    },
  }
}

/**
 * Candidate lookup used by flows that only need raw customer rows for a set of
 * loose identifiers (EDIEL automation and similar), still tenant-scoped.
 */
export async function findCustomersByIdentifierValues(input: {
  companyId?: string | null
  values: string[]
  columns: string[]
  select?: string
  limit?: number
}): Promise<MatchedCustomerRow[]> {
  const values = input.values.map((value) => value.trim()).filter(Boolean)
  if (values.length === 0) return []

  const orParts: string[] = []
  for (const value of values) {
    const escaped = value.replace(/"/g, '\\"')
    for (const column of input.columns) orParts.push(`${column}.eq.${escaped}`)
  }

  let query = supabaseService
    .from('customers')
    .select(input.select ?? DEFAULT_SELECT)
    .limit(input.limit ?? 20)

  if (input.companyId) query = query.eq('company_id', input.companyId)
  if (orParts.length > 0) query = query.or(orParts.join(','))

  const { data, error } = await query
  if (error) {
    if (schemaMissing(error)) return []
    throw error
  }
  return (data ?? []) as unknown as MatchedCustomerRow[]
}
