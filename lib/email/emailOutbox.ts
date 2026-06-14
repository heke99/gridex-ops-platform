import { supabaseService } from '@/lib/supabase/service'

/**
 * Email outbox entries represent emails that need to be sent asynchronously.
 * Each entry is processed by a background worker that attempts delivery
 * according to the retry/backoff configuration stored on the row. Emails
 * should be enqueued via this helper rather than being sent directly from
 * website intakes or admin actions. This ensures that failures do not
 * interrupt user flows.
 */
export async function enqueueTenantEmail(input: {
  companyId: string
  to: string
  subject: string
  templateKey: string
  payload: Record<string, unknown>
  requestId?: string | null
  traceId?: string | null
  maxAttempts?: number
}): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('tenant_email_outbox')
    .insert({
      company_id: input.companyId,
      to: input.to,
      subject: input.subject,
      template_key: input.templateKey,
      payload: input.payload,
      attempts: 0,
      max_attempts: input.maxAttempts ?? 5,
      next_attempt_at: now,
      dead_letter_at: null,
      last_error: null,
      request_id: input.requestId ?? null,
      trace_id: input.traceId ?? null,
      created_at: now,
      updated_at: now,
    })
  if (error) throw error
}

/**
 * Helper to mark an outbox entry as failed and schedule a retry. The retry
 * logic is intentionally simple: it increments the attempt counter and
 * schedules the next attempt one hour later. If the maximum number of
 * attempts is exceeded the entry is dead‑lettered.
 */
export async function markEmailAttempt(input: {
  outboxId: string
  companyId: string
  errorMessage: string
  maxAttempts?: number
}): Promise<void> {
  const { data, error: fetchError } = await supabaseService
    .from('tenant_email_outbox')
    .select('attempts,max_attempts')
    .eq('company_id', input.companyId)
    .eq('id', input.outboxId)
    .maybeSingle()
  if (fetchError) throw fetchError
  if (!data) throw new Error('Outbox entry not found')
  const attempts = (data as any).attempts ?? 0
  const maxAttempts = (data as any).max_attempts ?? (input.maxAttempts ?? 5)
  const nextAttempt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const deadLetterAt = attempts + 1 >= maxAttempts ? new Date().toISOString() : null
  const { error: updateError } = await supabaseService
    .from('tenant_email_outbox')
    .update({
      attempts: attempts + 1,
      last_error: input.errorMessage,
      next_attempt_at: deadLetterAt ? null : nextAttempt,
      dead_letter_at: deadLetterAt,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', input.companyId)
    .eq('id', input.outboxId)
  if (updateError) throw updateError
}