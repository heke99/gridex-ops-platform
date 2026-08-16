import { supabaseService } from '@/lib/supabase/service'

type HydratedSecret = { envKey: string; previous: string | undefined }

/**
 * Legacy webhook delivery reads signing secrets from process.env. Partner API
 * subscriptions keep secrets in Supabase Vault. Hydrate only for the duration
 * of one internal dispatch run and restore process.env afterwards.
 */
export async function hydrateVaultWebhookSecretsForDispatch(): Promise<() => void> {
  const result = await supabaseService
    .from('webhook_subscriptions')
    .select('id,company_id,signing_secret_ref')
    .eq('status', 'active')
    .not('signing_secret_ref', 'is', null)

  if (result.error) throw result.error

  const hydrated: HydratedSecret[] = []
  for (const row of result.data ?? []) {
    const ref = typeof row.signing_secret_ref === 'string' ? row.signing_secret_ref.trim() : ''
    if (!ref) continue
    const envKey = `WEBHOOK_SIGNING_SECRET_${ref}`
    if (process.env[envKey]) continue

    const secretResult = await supabaseService.rpc('gridex_read_webhook_signing_secret_v1', {
      p_company_id: row.company_id,
      p_subscription_id: row.id,
    })
    if (secretResult.error) throw secretResult.error
    if (typeof secretResult.data !== 'string' || !secretResult.data) continue

    hydrated.push({ envKey, previous: process.env[envKey] })
    process.env[envKey] = secretResult.data
  }

  return () => {
    for (const item of hydrated) {
      if (item.previous === undefined) delete process.env[item.envKey]
      else process.env[item.envKey] = item.previous
    }
  }
}
