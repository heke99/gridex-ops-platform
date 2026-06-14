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
  created_at: string
  updated_at: string
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
  } catch (err) {
    return ''
  }
}

/**
 * Create or retrieve an existing customer application intake using an
 * idempotency key and payload hash. If an intake exists for the given
 * combination of companyId, apiClientId, route, method and idempotencyKey
 * the function returns it. If a conflicting payload hash is found the
 * function throws an error with code `idempotent_failed`. Otherwise a new
 * record is inserted and returned. This helper is safe to call multiple
 * times.
 */
export async function getOrCreateCustomerApplicationIntake(input: {
  companyId: string
  apiClientId: string | null
  route: string | null
  method: string | null
  idempotencyKey: string | null
  payload: unknown
}): Promise<{ intake: CustomerApplicationIntake; created: boolean }> {
  const payloadHash = computePayloadHash(input.payload)
  // Look up an existing intake
  const { data: existing, error: selectError } = await supabaseService
    .from('customer_application_intakes')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('api_client_id', input.apiClientId)
    .eq('route', input.route)
    .eq('method', input.method)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()
  if (selectError && selectError.code !== 'PGRST116' && selectError.code !== '42P01') throw selectError
  if (existing) {
    if ((existing as any).payload_hash && (existing as any).payload_hash !== payloadHash) {
      const err = new Error('Idempotent key used with different payload') as any
      err.code = 'idempotent_failed'
      throw err
    }
    return { intake: existing as CustomerApplicationIntake, created: false }
  }
  // Insert new intake
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
  if (error) throw error
  return { intake: data as CustomerApplicationIntake, created: true }
}