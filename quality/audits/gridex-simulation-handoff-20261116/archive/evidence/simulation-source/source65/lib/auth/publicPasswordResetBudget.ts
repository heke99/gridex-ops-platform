import { createHmac } from 'node:crypto'
import { getSupabaseServiceEnv } from '@/lib/env/supabaseServer'
import { trustedClientIp } from '@/lib/integrations/ipPolicy'
import { supabaseService } from '@/lib/supabase/service'

type BudgetResult = { data: unknown; error: unknown }
type BudgetRpc = (
  name: 'gridex_consume_public_password_reset_budget_v1',
  args: { p_email_key: string; p_client_key: string },
) => { abortSignal(signal: AbortSignal): PromiseLike<BudgetResult> }

/**
 * The service-only RPC owns policy, time and atomic admission across instances.
 * Domain-separated HMACs keep addresses and client IPs out of persistent rows;
 * the existing service credential is server-only and is never sent as a key.
 */
export async function consumePublicPasswordResetBudget(
  normalizedEmail: string,
  requestHeaders: Pick<Headers, 'get'>,
): Promise<boolean> {
  try {
    const { serviceRoleKey } = getSupabaseServiceEnv()
    const digest = (scope: string, value: string) => createHmac('sha256', serviceRoleKey)
      .update(`gridex-public-password-reset:v1:${scope}:${value}`)
      .digest('hex')
    // Forwarded IP is a supplemental tier only. Untrusted/missing metadata uses
    // one shared bucket; address and global caps apply even if IPs are rotated.
    const client = trustedClientIp(requestHeaders) ?? 'unknown'
    // This new RPC is intentionally scoped here until the qualified generated
    // database-types producer incorporates the migration.
    const rpc = supabaseService.rpc.bind(supabaseService) as unknown as BudgetRpc
    const { data, error } = await rpc('gridex_consume_public_password_reset_budget_v1', {
      p_email_key: digest('email', normalizedEmail),
      p_client_key: digest('client', client),
    }).abortSignal(AbortSignal.timeout(3_000))
    return error == null && data === true
  } catch {
    return false
  }
}
