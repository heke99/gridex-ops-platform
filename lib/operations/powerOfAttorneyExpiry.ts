import { supabaseService } from '@/lib/supabase/service'

type JsonRecord = Record<string, unknown>

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

/**
 * Persists power-of-attorney expiry: rows whose valid_to has passed are moved
 * to status='expired'. Readiness checks already treated them as invalid at
 * read time, but the stored status stayed 'signed' forever, which confused the
 * admin UI and the audit trail.
 *
 * Idempotent: expired rows are only touched once. Runs bounded per sweep.
 */
export async function expireOverduePowersOfAttorney(input: { limit?: number } = {}) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
  const today = new Date().toISOString().slice(0, 10)

  const { data, error } = await supabaseService
    .from('powers_of_attorney')
    .select('id,company_id,customer_id,valid_to,status')
    .in('status', ['signed', 'active', 'accepted', 'sent', 'draft'])
    .not('valid_to', 'is', null)
    .lt('valid_to', today)
    .limit(limit)

  if (error) {
    if (missingSchema(error)) return { expired: 0 }
    throw error
  }

  const rows = (data ?? []) as JsonRecord[]
  let expired = 0

  for (const row of rows) {
    const { error: updateError } = await supabaseService
      .from('powers_of_attorney')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', String(row.id))
      .eq('company_id', String(row.company_id ?? ''))
      // Guard against concurrent transitions (e.g. revoked meanwhile).
      .in('status', ['signed', 'active', 'accepted', 'sent', 'draft'])

    if (updateError) {
      if (missingSchema(updateError)) continue
      throw updateError
    }
    expired += 1

    await supabaseService
      .from('power_of_attorney_events')
      .insert({
        company_id: row.company_id ?? null,
        power_of_attorney_id: String(row.id),
        event_type: 'expired',
        payload: { valid_to: row.valid_to ?? null, source: 'customer_operations_cron' },
      })
      .then(() => undefined, () => undefined)
  }

  return { expired }
}
