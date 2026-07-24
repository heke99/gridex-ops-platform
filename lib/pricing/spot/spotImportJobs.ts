import { supabaseService } from '@/lib/supabase/service'
import type { PriceArea } from '@/lib/pricing/types'

export type SpotImportJobClaim = {
  id: string
  claimed: boolean
  status: 'queued' | 'running' | 'retry_wait' | 'completed' | 'failed'
  attemptCount: number
  correlationId: string
}

export async function claimSpotImportJob(input: {
  provider: string
  priceArea: PriceArea
  calendarDate: string
  companyId?: string | null
  force?: boolean
}): Promise<SpotImportJobClaim> {
  const { data, error } = await supabaseService.rpc('gridex_claim_spot_price_import_job', {
    p_provider: input.provider,
    p_price_area: input.priceArea,
    p_calendar_date: input.calendarDate,
    p_company_id: input.companyId ?? null,
    p_force: input.force ?? false,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Spotprisjobbet kunde inte reserveras.')
  return {
    id: String(row.id),
    claimed: row.claimed === true,
    status: String(row.status) as SpotImportJobClaim['status'],
    attemptCount: Number(row.attempt_count ?? 0),
    correlationId: String(row.correlation_id),
  }
}

export async function completeSpotImportJob(input: {
  jobId: string
  checksum: string
  resultSummary: Record<string, unknown>
}): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('spot_price_import_jobs')
    .update({
      status: 'completed',
      completed_at: now,
      next_attempt_at: null,
      last_error_code: null,
      last_error_message: null,
      source_checksum: input.checksum,
      result_summary: input.resultSummary,
      updated_at: now,
    })
    .eq('id', input.jobId)
  if (error) throw error
}

export async function failSpotImportJob(input: {
  jobId: string
  errorCode: string
  message: string
  retryable: boolean
  attemptCount: number
  retryAfterMs?: number | null
}): Promise<'retry_wait' | 'failed'> {
  const maxAttempts = 5
  const retry = input.retryable && input.attemptCount < maxAttempts
  const status = retry ? 'retry_wait' : 'failed'
  const fallbackDelay = Math.min(6 * 60 * 60_000, 15 * 60_000 * 2 ** Math.max(0, input.attemptCount - 1))
  const now = new Date()
  const nextAttemptAt = retry
    ? new Date(now.getTime() + Math.max(60_000, input.retryAfterMs ?? fallbackDelay)).toISOString()
    : null
  const { error } = await supabaseService
    .from('spot_price_import_jobs')
    .update({
      status,
      completed_at: retry ? null : now.toISOString(),
      next_attempt_at: nextAttemptAt,
      last_error_code: input.errorCode,
      last_error_message: input.message.slice(0, 2000),
      updated_at: now.toISOString(),
    })
    .eq('id', input.jobId)
  if (error) throw error
  return status
}
