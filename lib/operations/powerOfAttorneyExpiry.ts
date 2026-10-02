import { supabaseService } from '@/lib/supabase/service'

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
  // Status change and 'expired' event are written in one transaction.
  const { data, error } = await supabaseService.rpc('gridex_expire_overdue_powers_of_attorney_v1', { p_limit: limit })
  if (error) {
    if (missingSchema(error)) return { expired: 0 }
    throw error
  }
  return { expired: Number((data as { expired?: number } | null)?.expired ?? 0) }
}
