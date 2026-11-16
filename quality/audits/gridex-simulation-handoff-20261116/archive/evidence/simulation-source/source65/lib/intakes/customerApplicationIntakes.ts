import crypto from 'crypto'
import { supabaseService } from '@/lib/supabase/service'

/**
 * Stages for customer application intakes. These mirror the desired
 * progression for website signups. Future implementations should update
 * these values based on downstream processing events.
 */
export const CUSTOMER_APPLICATION_STAGES = [
  'received',
  'customer_resolved',
  'site_resolved',
  'facility_pending',
  'facility_verified',
  'contract_created',
  'legal_recorded',
  'snapshot_frozen',
  'events_queued',
  'mail_queued',
  'webhooks_queued',
  'completed',
  'needs_review',
  'failed',
] as const

export type CustomerApplicationStage = typeof CUSTOMER_APPLICATION_STAGES[number]

export type CustomerApplicationIntake = {
  id: string
  company_id: string
  api_client_id: string | null
  route: string | null
  method: string | null
  idempotency_key: string | null
  payload_hash: string | null
  stage: CustomerApplicationStage
  status: string | null
  customer_id?: string | null
  result?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

function schemaMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  return ['42703', '42P01', 'PGRST116', 'PGRST204', 'PGRST205'].includes(code)
}

/**
 * Compute a deterministic SHA256 hash of the request payload. The hash is
 * encoded as a hex string. This is used for idempotency comparisons. If the
 * payload cannot be stringified the function returns an empty string.
 */
export function computePayloadHash(payload: unknown): string {
  try {
    const json = JSON.stringify(payload ?? null)
    return crypto.createHash('sha256').update(json).digest('hex')
  } catch {
    return ''
  }
}

function matchNullable(
  query: ReturnType<ReturnType<typeof supabaseService.from>['select']>,
  column: string,
  value: string | null
) {
  // supabase-js `.eq(column, null)` renders `eq.null` which never matches NULL
  // rows; nullable idempotency dimensions must use `is.null`.
  return value === null ? query.is(column, null) : query.eq(column, value)
}

async function findExistingIntake(input: {
  companyId: string
  apiClientId: string | null
  route: string | null
  method: string | null
  idempotencyKey: string | null
}): Promise<CustomerApplicationIntake | null> {
  let query = supabaseService
    .from('customer_application_intakes')
    .select('*')
    .eq('company_id', input.companyId)
  query = matchNullable(query, 'api_client_id', input.apiClientId)
  query = matchNullable(query, 'route', input.route)
  query = matchNullable(query, 'method', input.method)
  query = matchNullable(query, 'idempotency_key', input.idempotencyKey)

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (schemaMissing(error)) return null
    throw error
  }
  return (data as CustomerApplicationIntake | null) ?? null
}

/**
 * Create or retrieve an existing customer application intake using an
 * idempotency key and payload hash. If an intake exists for the given
 * combination of companyId, apiClientId, route, method and idempotencyKey
 * the function returns it. If a conflicting payload hash is found the
 * function throws an error with code `idempotent_failed`. Otherwise a new
 * record is inserted and returned. This helper is safe to call multiple
 * times, including concurrently (unique-violation races re-resolve to the
 * winning row).
 *
 * If the backing table does not exist yet in the target database the helper
 * degrades to "no idempotency" and returns `{ intake: null, created: true }`
 * so callers keep working while the migration is rolled out.
 */
export async function getOrCreateCustomerApplicationIntake(input: {
  companyId: string
  apiClientId: string | null
  route: string | null
  method: string | null
  idempotencyKey: string | null
  payload: unknown
}): Promise<{ intake: CustomerApplicationIntake | null; created: boolean }> {
  const payloadHash = computePayloadHash(input.payload)

  const existing = await findExistingIntake(input)
  if (existing) {
    if (existing.payload_hash && existing.payload_hash !== payloadHash) {
      const err = new Error('Idempotent key used with different payload') as Error & { code?: string }
      err.code = 'idempotent_failed'
      throw err
    }
    return { intake: existing, created: false }
  }

  const { data, error } = await supabaseService
    .from('customer_application_intakes')
    .insert({
      company_id: input.companyId,
      api_client_id: input.apiClientId,
      route: input.route,
      method: input.method,
      idempotency_key: input.idempotencyKey,
      payload_hash: payloadHash,
      stage: 'received',
      status: 'received',
    })
    .select('*')
    .maybeSingle()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      // Lost an insert race; the winning row is the idempotent result.
      const winner = await findExistingIntake(input)
      if (winner) {
        if (winner.payload_hash && winner.payload_hash !== payloadHash) {
          const err = new Error('Idempotent key used with different payload') as Error & { code?: string }
          err.code = 'idempotent_failed'
          throw err
        }
        return { intake: winner, created: false }
      }
    }
    if (schemaMissing(error)) return { intake: null, created: true }
    throw error
  }
  return { intake: data as CustomerApplicationIntake, created: true }
}

/**
 * Mark an intake as completed and persist the created customer id plus a
 * caller-defined result payload so idempotent replays can return the original
 * outcome. Tolerates databases where the result columns are not migrated yet.
 */
export async function completeCustomerApplicationIntake(input: {
  intakeId: string
  companyId: string
  customerId: string | null
  stage?: CustomerApplicationStage
  result?: Record<string, unknown> | null
}): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('customer_application_intakes')
    .update({
      stage: input.stage ?? 'completed',
      status: 'completed',
      customer_id: input.customerId,
      result: input.result ?? null,
      updated_at: now,
    })
    .eq('id', input.intakeId)
    .eq('company_id', input.companyId)

  if (error) {
    if (schemaMissing(error)) {
      const fallback = await supabaseService
        .from('customer_application_intakes')
        .update({ stage: input.stage ?? 'completed', status: 'completed', updated_at: now })
        .eq('id', input.intakeId)
        .eq('company_id', input.companyId)
      if (fallback.error && !schemaMissing(fallback.error)) throw fallback.error
      return
    }
    throw error
  }
}

/**
 * Mark an intake as failed so an identical retry is allowed to run again.
 */
export async function failCustomerApplicationIntake(input: {
  intakeId: string
  companyId: string
  errorMessage: string
}): Promise<void> {
  const { error } = await supabaseService
    .from('customer_application_intakes')
    .update({
      stage: 'failed',
      status: 'failed',
      result: { error: input.errorMessage.slice(0, 2000) },
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.intakeId)
    .eq('company_id', input.companyId)

  if (error) {
    if (schemaMissing(error)) {
      const fallback = await supabaseService
        .from('customer_application_intakes')
        .update({ stage: 'failed', status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', input.intakeId)
        .eq('company_id', input.companyId)
      if (fallback.error && !schemaMissing(fallback.error)) throw fallback.error
      return
    }
    throw error
  }
}
