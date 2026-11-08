import { supabaseService } from '@/lib/supabase/service'

type HydratedSecret = {
  envKey: string
  previous: string | undefined
  value: string
  owners: Set<symbol>
}
const temporarySecrets = new Map<string, HydratedSecret>()

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

  const owner = Symbol('webhook-dispatch')
  const hydrated = new Set<HydratedSecret>()
  const cleanup = () => {
    for (const item of hydrated) {
      item.owners.delete(owner)
      if (item.owners.size || temporarySecrets.get(item.envKey) !== item) continue
      temporarySecrets.delete(item.envKey)
      if (process.env[item.envKey] !== item.value) continue
      if (item.previous === undefined) delete process.env[item.envKey]
      else process.env[item.envKey] = item.previous
    }
    hydrated.clear()
  }
  const borrow = (envKey: string) => {
    const item = temporarySecrets.get(envKey)
    if (!item || process.env[envKey] !== item.value) return false
    item.owners.add(owner)
    hydrated.add(item)
    return true
  }

  try {
    for (const row of result.data ?? []) {
      const ref = typeof row.signing_secret_ref === 'string' ? row.signing_secret_ref.trim() : ''
      if (!ref) continue
      const envKey = `WEBHOOK_SIGNING_SECRET_${ref}`
      if (borrow(envKey) || process.env[envKey]) continue

      const secretResult = await supabaseService.rpc('gridex_read_webhook_signing_secret_v1', {
        p_company_id: row.company_id,
        p_subscription_id: row.id,
      })
      if (secretResult.error) throw secretResult.error
      // Another dispatch or external mapping may have populated this slot while
      // the scoped RPC was pending. Join it before considering our own result.
      if (borrow(envKey) || process.env[envKey]) continue
      if (typeof secretResult.data !== 'string' || !secretResult.data) continue

      const item: HydratedSecret = {
        envKey, previous: process.env[envKey], value: secretResult.data, owners: new Set([owner]),
      }
      process.env[envKey] = item.value
      temporarySecrets.set(envKey, item)
      hydrated.add(item)
    }
    return cleanup
  } catch (error) {
    cleanup()
    throw error
  }
}
