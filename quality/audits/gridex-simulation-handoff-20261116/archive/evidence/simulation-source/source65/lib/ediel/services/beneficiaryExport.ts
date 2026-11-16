import { supabaseService } from '@/lib/supabase/service'
import type { EdielProjectionPage, EdielProjectionRequest } from './types'

type Actor = { beneficiaryCompanyId: string; actorUserId: string }
type JobStatus = 'queued' | 'leased' | 'completed' | 'blocked'
export type BeneficiaryExportStatus = { jobId: string; status: JobStatus }
export type BeneficiaryExportResult = BeneficiaryExportStatus & { page: EdielProjectionPage | null }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function actorArgs(input: Actor) {
  return { p_beneficiary_company_id: input.beneficiaryCompanyId, p_actor_user_id: input.actorUserId }
}
function status(data: unknown): BeneficiaryExportStatus {
  if (!data || typeof data !== 'object') throw new Error('ediel_export_response_invalid')
  const value = data as BeneficiaryExportStatus
  if (!uuid.test(value.jobId) || !['queued', 'leased', 'completed', 'blocked'].includes(value.status)) throw new Error('ediel_export_response_invalid')
  return { jobId: value.jobId, status: value.status }
}

/** The queue stores references and a captured version, never cached values. */
export async function queueBeneficiaryExport(request: EdielProjectionRequest, idempotencyKey: string): Promise<BeneficiaryExportStatus> {
  const { data, error } = await supabaseService.rpc('ediel_queue_beneficiary_export_v1', {
    ...actorArgs(request), p_idempotency_key: idempotencyKey, p_grant_id: request.grantId,
    p_expected_grant_version: request.expectedGrantVersion, p_series_id: request.seriesId,
    p_purpose: request.purpose, p_fields: [...request.fields], p_start: request.startInclusive,
    p_end: request.endExclusive, p_limit: request.limit ?? 100,
    p_after_at: request.after?.readingAt ?? null, p_after_id: request.after?.valueId ?? null,
  })
  if (error) throw error
  return status(data)
}

/** SQL executes projection and internal delivery under one current fence.
 * The worker receives no source payload, authority flag or replacement version. */
export async function runBeneficiaryExports(input: Actor): Promise<{ claimed: number; completed: number; blocked: number }> {
  const { data, error } = await supabaseService.rpc('ediel_claim_beneficiary_exports_v1', { ...actorArgs(input), p_limit: 10 })
  if (error) throw error
  if (!Array.isArray(data) || data.length > 10) throw new Error('ediel_export_claim_invalid')
  const claims = data as { jobId: string; leaseToken: string }[]
  if (claims.some(value => !value || !uuid.test(value.jobId) || !uuid.test(value.leaseToken)) || new Set(claims.map(value => value.jobId)).size !== claims.length) throw new Error('ediel_export_claim_invalid')
  const counts = { claimed: claims.length, completed: 0, blocked: 0 }
  for (const claim of claims) {
    const result = await supabaseService.rpc('ediel_execute_beneficiary_export_v1', {
      ...actorArgs(input), p_job_id: claim.jobId, p_lease_token: claim.leaseToken,
    })
    if (result.error) throw result.error
    const executed = status(result.data)
    if (executed.jobId !== claim.jobId || !['completed', 'blocked'].includes(executed.status)) throw new Error('ediel_export_execution_invalid')
    if (executed.status === 'completed') counts.completed++
    else counts.blocked++
  }
  return counts
}

export async function readBeneficiaryExport(input: Actor & { jobId: string }): Promise<BeneficiaryExportResult> {
  const { data, error } = await supabaseService.rpc('ediel_read_beneficiary_export_v1', { ...actorArgs(input), p_job_id: input.jobId })
  if (error) throw error
  const current = status(data)
  if (current.jobId !== input.jobId) throw new Error('ediel_export_scope_mismatch')
  return { ...current, page: current.status === 'completed' ? data.page : null }
}
