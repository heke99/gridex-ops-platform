import { randomUUID } from 'crypto'
import { supabaseService } from '@/lib/supabase/service'

export type ClaimedEdielOutboxItem = {
  id: string
  company_id: string | null
  ediel_message_id: string | null
  status: string
  environment: string | null
  locked_by?: string | null
  current_send_attempt_id?: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function postgresErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (!error || typeof error !== 'object') return String(error ?? '')
  const candidate = error as { message?: unknown; details?: unknown; hint?: unknown }
  return [candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
}

export async function claimEdielOutboxItems(params: {
  workerId: string
  companyId?: string | null
  environment?: string | null
  limit?: number | null
}): Promise<ClaimedEdielOutboxItem[]> {
  const { data, error } = await supabaseService.rpc('claim_ediel_outbox_items', {
    p_environment: clean(params.environment),
    p_company_id: clean(params.companyId),
    p_limit: params.limit ?? 25,
    p_worker_id: params.workerId,
  })

  if (!error) return (data ?? []) as ClaimedEdielOutboxItem[]

  const message = postgresErrorMessage(error)
  if (!/claim_ediel_outbox_items|schema cache|Could not find/i.test(message)) throw error

  // Compatibility fallback for environments where the migration has not been applied yet.
  // This is best-effort and still uses a compare-and-set transition before returning rows.
  let query = supabaseService
    .from('ediel_outbox')
    .select('*')
    .in('status', ['prepared', 'queued'])
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(params.limit ?? 25)

  const companyId = clean(params.companyId)
  const environment = clean(params.environment)

  let staleUpdate = supabaseService
    .from('ediel_outbox')
    .update({
      status: 'delivery_uncertain',
      last_error: 'stale_sending_lock_requires_transport_reconciliation',
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'sending')
    .lt('locked_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
  if (companyId) staleUpdate = staleUpdate.eq('company_id', companyId)
  if (environment) staleUpdate = staleUpdate.eq('environment', environment)
  const { error: staleError } = await staleUpdate
  if (staleError && !/schema cache|column .* does not exist/i.test(postgresErrorMessage(staleError))) {
    throw staleError
  }

  if (companyId) query = query.eq('company_id', companyId)
  if (environment) query = query.eq('environment', environment)

  const { data: rows, error: listError } = await query
  if (listError) throw listError

  const claimed: ClaimedEdielOutboxItem[] = []
  for (const row of (rows ?? []) as ClaimedEdielOutboxItem[]) {
    const attemptId = randomUUID()
    const { data: updated, error: updateError } = await supabaseService
      .from('ediel_outbox')
      .update({
        status: 'sending',
        locked_at: new Date().toISOString(),
        locked_by: params.workerId,
        current_send_attempt_id: attemptId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .in('status', ['prepared', 'queued'])
      .select('*')
      .maybeSingle()

    if (updateError) throw updateError
    if (updated) claimed.push(updated as ClaimedEdielOutboxItem)
  }

  return claimed
}
