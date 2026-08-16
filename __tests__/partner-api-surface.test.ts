import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(path, 'utf8')

describe('Partner API v1 public surface', () => {
  const core = read('lib/partner-api/core.ts')
  const openApi = read('lib/partner-api/openApi.ts')
  const docs = read('app/developers/partner-api/page.tsx')
  const legacyDocs = read('app/developers/customer-portal-api/page.tsx')
  const scopes = read('lib/integrations/apiClientScopes.ts')
  const migration = read('supabase/migrations/20260816135746_partner_api_v1_transactional_contract_create.sql')
  const dispatch = read('app/api/internal/webhooks/dispatch/route.ts')
  const vault = read('lib/integrations/webhookVaultSecrets.ts')

  it('exposes business resources without supplier configuration endpoints', () => {
    expect(openApi).toContain("'/contracts'")
    expect(openApi).toContain("'/customers'")
    expect(openApi).toContain("'/sites'")
    expect(openApi).toContain("'/webhooks/subscriptions'")
    expect(openApi).not.toContain("'/companies'")
    expect(openApi).not.toContain("'/tenants'")
    expect(openApi).not.toContain("'/config")
  })

  it('keeps tenant selection credential-bound and strips internal identifiers', () => {
    expect(core).toContain('Tenant selection is not accepted in request payloads.')
    expect(core).toContain('assertPublicResponsePayload(envelope)')
    expect(core).toContain(".eq('company_id',")
    expect(openApi).not.toMatch(/(^|[,{\s])company_id\s*:/m)
    expect(openApi).not.toMatch(/(^|[,{\s])customer_id\s*:/m)
    expect(openApi).not.toMatch(/(^|[,{\s])contract_id\s*:/m)
  })

  it('makes the Partner API permission group usable for writes and reads', () => {
    for (const scope of [
      'partner_contracts.write',
      'partner_customers.write',
      'partner_sites.write',
      'partner_power_of_attorney.write',
      'partner_webhooks.manage',
      'customer_contracts.read',
      'customer_profile.read',
      'customer_sites.read',
      'customer_power_of_attorney.read',
      'customer_invoices.read',
      'customer_metering.read',
    ]) {
      expect(scopes).toContain(`'${scope}'`)
    }
  })

  it('requires idempotency and bounded POA uploads', () => {
    expect(core).toContain('executeIdempotentPortalWrite')
    expect(openApi).toContain('Idempotency-Key')
    expect(core).toContain('MAX_POA_BYTES = 5 * 1024 * 1024')
    expect(core).toContain("bytes.subarray(0, 5).toString('ascii') !== '%PDF-'")
  })

  it('keeps privileged database functions service-role only', () => {
    expect(migration).toContain('gridex_create_partner_contract_v1')
    expect(migration).toMatch(/revoke all on function public\.gridex_create_partner_contract_v1[\s\S]*from public, anon, authenticated/)
    expect(migration).toMatch(/grant execute on function public\.gridex_create_partner_contract_v1[\s\S]*to service_role/)
  })

  it('delivers contract status events without exposing UUIDs', () => {
    expect(migration).toContain("'contract.status_changed'")
    expect(migration).toContain('insert into public.webhook_deliveries')
    expect(migration).toContain("'event_' || substr")
    expect(migration).toContain("'contract_reference', new.customer_contract_reference")
  })

  it('hydrates Vault webhook secrets only inside internal dispatch', () => {
    expect(vault).toContain('gridex_read_webhook_signing_secret_v1')
    expect(vault).toContain('delete process.env[item.envKey]')
    expect(dispatch).toContain('hydrateVaultWebhookSecretsForDispatch')
    expect(dispatch).toContain('cleanupVaultSecrets?.()')
  })

  it('keeps Partner and legacy Customer Portal documentation as separate contracts', () => {
    expect(docs).toContain('backend-to-backend')
    expect(docs).toContain('Company onboarding')
    expect(docs).toContain('not part of the Partner API')
    expect(docs).toContain('/api/v1/website/*')
    expect(docs).toContain('/api/partner/v1')
    expect(legacyDocs).toContain('Customer Portal API')
  })
})
