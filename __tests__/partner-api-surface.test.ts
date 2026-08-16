import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(path, 'utf8')

describe('Partner API v1 public surface', () => {
  const core = read('lib/partner-api/core.ts')
  const canonical = read('lib/partner-api/canonical.ts')
  const openApi = read('lib/partner-api/openApi.ts')
  const docs = read('app/developers/partner-api/page.tsx')
  const customerPortalDocs = read('app/developers/customer-portal-api/page.tsx')
  const scopes = read('lib/integrations/apiClientScopes.ts')
  const contractMigration = read('supabase/migrations/20260816135746_partner_api_v1_transactional_contract_create.sql')
  const eventMigration = read('supabase/migrations/20260816170000_partner_api_v1_canonical_surface_events.sql')
  const dispatch = read('app/api/internal/webhooks/dispatch/route.ts')
  const webhooks = read('lib/integrations/webhooks.ts')
  const webhookTransport = read('lib/integrations/publicWebhookTransport.ts')
  const vault = read('lib/integrations/webhookVaultSecrets.ts')

  it('exposes the simplified business-resource surface from the integration example', () => {
    for (const path of [
      "'/contract'",
      "'/contract/{contract_reference}/state'",
      "'/customer'",
      "'/customer/{customer_reference}/site'",
      "'/customer/{customer_reference}/site/{site_reference}'",
      "'/customer/{customer_reference}/site/{site_reference}/powerofattorney'",
      "'/customer/{customer_reference}/site/{site_reference}/invoice'",
      "'/customer/{customer_reference}/site/{site_reference}/measurement'",
      "'/invoice/{invoice_reference}'",
      "'/invoice/{invoice_reference}/pdf'",
      "'/webhook/subscription'",
    ]) {
      expect(openApi).toContain(path)
    }
    expect(openApi).not.toContain("'/companies'")
    expect(openApi).not.toContain("'/tenants'")
    expect(openApi).not.toContain("'/config")
    expect(openApi).not.toContain("'/website")
  })

  it('keeps old plural Partner paths as runtime compatibility aliases, not the canonical OpenAPI', () => {
    expect(core).toContain("segments[0] === 'contracts'")
    expect(core).toContain("segments[0] === 'customers'")
    expect(core).toContain("segments[0] === 'sites'")
    expect(core).toContain("segments[0] === 'webhooks'")
    expect(canonical).toContain("segments[0] === 'contract'")
    expect(canonical).toContain("segments[0] === 'customer'")
    expect(canonical).toContain("segments[0] === 'webhook'")
    expect(openApi).not.toContain("'/contracts'")
    expect(openApi).not.toContain("'/customers'")
    expect(openApi).not.toContain("'/sites'")
    expect(openApi).not.toContain("'/webhooks/subscriptions'")
  })

  it('keeps tenant selection credential-bound and strips internal identifiers', () => {
    expect(core).toContain('Tenant selection is not accepted in request payloads.')
    expect(core).toContain('assertPublicResponsePayload(envelope)')
    expect(core).toContain(".eq('company_id',")
    expect(canonical).toContain(".eq('company_id', access.client.company_id)")
    expect(openApi).not.toMatch(/(^|[,{\s])company_id\s*:/m)
    expect(openApi).not.toMatch(/(^|[,{\s])customer_id\s*:/m)
    expect(openApi).not.toMatch(/(^|[,{\s])contract_id\s*:/m)
  })

  it('enforces nested customer/site ownership in canonical routes', () => {
    expect(canonical).toContain(".eq('customer_reference', customerReference)")
    expect(canonical).toContain(".eq('facility_reference', siteReference)")
    expect(canonical).toContain('String(siteResult.data.customer_id) !== String(customerResult.data.id)')
    expect(canonical).toContain('path_body_reference_mismatch')
    expect(canonical).toContain("operation: 'invoice.list_by_site'")
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

  it('keeps privileged contract creation service-role only', () => {
    expect(contractMigration).toContain('gridex_create_partner_contract_v1')
    expect(contractMigration).toMatch(/revoke all on function public\.gridex_create_partner_contract_v1[\s\S]*from public, anon, authenticated/)
    expect(contractMigration).toMatch(/grant execute on function public\.gridex_create_partner_contract_v1[\s\S]*to service_role/)
  })

  it('implements every documented core webhook event before publishing it', () => {
    for (const event of [
      'customer.created',
      'customer.updated',
      'site.created',
      'site.updated',
      'power_of_attorney.created',
      'contract.created',
      'contract.status_changed',
      'invoice.created',
      'invoice.updated',
    ]) {
      expect(openApi).toContain(`'${event}'`)
      expect(eventMigration).toContain(`'${event}'`)
      expect(webhooks).toContain(`'${event}'`)
    }
    expect(eventMigration).toContain('insert into public.webhook_deliveries')
    expect(eventMigration).toContain("'event_' || substr")
    expect(eventMigration).toContain("'contract_schema_version', '2026-08-16.2'")
  })

  it('hydrates Vault webhook secrets only inside internal dispatch', () => {
    expect(vault).toContain('gridex_read_webhook_signing_secret_v1')
    expect(vault).toContain('delete process.env[item.envKey]')
    expect(dispatch).toContain('hydrateVaultWebhookSecretsForDispatch')
    expect(dispatch).toContain('cleanupVaultSecrets?.()')
  })

  it('blocks webhook SSRF targets at creation and delivery', () => {
    expect(dispatch).toContain('assertPublicWebhookTarget')
    expect(dispatch).toContain('webhook_target_not_public')
    expect(webhookTransport).toContain("url.protocol !== 'https:'")
    expect(webhookTransport).toContain("hostname === 'localhost'")
    expect(webhookTransport).toContain('isDisallowedWebhookAddress')
    expect(webhookTransport).toContain('lookup(hostname, { all: true, verbatim: true })')
    expect(webhookTransport).toContain('callback(null, pinned.address, pinned.family)')
    expect(webhooks).toContain('postPublicWebhook')
    expect(webhooks).not.toContain('const response = await fetch(targetUrl')
  })

  it('serves the simplified Partner API guide on both developer URLs', () => {
    expect(docs).toContain('backend-to-backend')
    expect(docs).toContain('Company setup is intentionally outside this API')
    expect(docs).toContain('/api/partner/v1')
    expect(docs).toContain('Existing plural Partner API paths')
    expect(docs).not.toContain('tenant_reference')
    expect(docs).toContain('"resource"')
    expect(customerPortalDocs).toContain("import PartnerApiDocumentationPage from '../partner-api/page'")
    expect(customerPortalDocs).toContain('<PartnerApiDocumentationPage />')
  })
})