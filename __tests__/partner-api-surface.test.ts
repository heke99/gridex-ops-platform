import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(path, 'utf8')

describe('Partner API v1 simple public surface', () => {
  const simple = read('lib/partner-api/simple.ts')
  const core = read('lib/partner-api/core.ts')
  const canonical = read('lib/partner-api/canonical.ts')
  const openApi = read('lib/partner-api/openApi.ts')
  const businessOpenApi = read('lib/partner-api/businessOpenApi.ts')
  const business = read('lib/partner-api/business.ts')
  const docs = read('app/developers/partner-api/page.tsx')
  const customerPortalDocs = read('app/developers/customer-portal-api/page.tsx')
  const scopes = read('lib/integrations/apiClientScopes.ts')
  const contractMigration = read('supabase/migrations/20260816135746_partner_api_v1_transactional_contract_create.sql')
  const partnerRoute = read('app/api/partner/v1/[[...path]]/route.ts')
  const webhooks = read('lib/integrations/webhooks.ts')
  const webhookTransport = read('lib/integrations/publicWebhookTransport.ts')
  const vault = read('lib/integrations/webhookVaultSecrets.ts')

  it('publishes only the small PDF-style business API as the canonical OpenAPI', () => {
    for (const path of [
      "'/contract'",
      "'/customer'",
      "'/customer/{customer_id}/site'",
      "'/customer/{customer_id}/site/{site_id}/powerofattorney'",
      "'/contract/{contract_id}/state'",
      "'/customer/{customer_id}'",
      "'/customer/{customer_id}/site/{site_id}'",
      "'/customer/{customer_id}/site/{site_id}/invoice'",
      "'/invoice/{invoice_id}'",
      "'/invoice/{invoice_id}/pdf'",
      "'/customer/{customer_id}/site/{site_id}/measurement'",
      "'/webhook/subscription'",
    ]) {
      expect(openApi).toContain(path)
    }
    for (const path of ["'/location'", "'/price/current'", "'/price'"]) {
      expect(businessOpenApi).toContain(path)
    }
    for (const internalPath of ["'/companies'", "'/tenants'", "'/config", "'/website", "'/contracts'", "'/customers'", "'/sites'"]) {
      expect(openApi).not.toContain(internalPath)
      expect(businessOpenApi).not.toContain(internalPath)
    }
    expect(openApi).not.toContain('offer_reference:')
    expect(openApi).not.toMatch(/(^|[,{\s])company_id\s*:/m)
    expect(openApi).not.toMatch(/(^|[,{\s])tenant_id\s*:/m)
    expect(businessOpenApi).not.toMatch(/(^|[,{\s])company_id\s*:/m)
    expect(businessOpenApi).not.toMatch(/(^|[,{\s])tenant_id\s*:/m)
  })

  it('serves the business resolver first while preserving old compatibility handlers behind it', () => {
    expect(partnerRoute).toContain("import { handleBusinessPartnerApi } from '@/lib/partner-api/business'")
    expect(partnerRoute).toContain('const business = await handleBusinessPartnerApi(request, method, path)')
    expect(partnerRoute).toContain('if (business) return business')
    expect(partnerRoute).toContain("import { handleSimplePartnerApi } from '@/lib/partner-api/simple'")
    expect(partnerRoute).toContain('const simple = await handleSimplePartnerApi(request, method, path)')
    expect(partnerRoute).toContain('if (simple) return simple')
    expect(partnerRoute).toContain('handleCanonicalPartnerApi')
    expect(partnerRoute).toContain('handlePartnerApi')
    expect(core).toContain("segments[0] === 'contracts'")
    expect(canonical).toContain("segments[0] === 'contract'")
  })

  it('keeps company selection credential-bound and rejects tenant selectors recursively', () => {
    expect(simple).toContain('requireIntegrationApiAccess')
    expect(simple).toContain("key === 'company_id' || key === 'tenant_id' || key === 'tenant_reference'")
    expect(simple).toContain(".eq('company_id', companyId)")
    expect(simple).toContain(".eq('company_id', context.client.company_id)")
    expect(simple).toContain('simple_partner_api_internal_uuid_leak')
    expect(business).toContain("'company_id'")
    expect(business).toContain("'tenant_id'")
    expect(business).toContain('internal_field_forbidden')
  })

  it('keeps product/publication configuration out of the external request', () => {
    expect(simple).toContain('partner_default_offer_reference')
    expect(simple).toContain(".from('canonical_public_contract_diagnostics_v')")
    expect(simple).toContain(".eq('channel', 'api')")
    expect(simple).toContain(".eq('visible', true)")
    expect(simple).toContain('default_offer_not_configured')
    expect(simple).toContain("ensureKeys(body, ['customer', 'site', 'power_of_attorney'])")
    expect(openApi).not.toContain("offer_reference: { type: 'string'")
    expect(businessOpenApi).not.toContain("offer_reference: { type: 'string'")
  })

  it('uses canonical idempotency and the transactional contract RPC', () => {
    expect(simple).toContain('executeIdempotentPortalWrite')
    expect(simple).toContain('requireIdempotencyKey')
    expect(openApi).toContain('Idempotency-Key')
    expect(simple).toContain("supabaseService.rpc('gridex_create_partner_contract_v1'")
    expect(contractMigration).toMatch(/revoke all on function public\.gridex_create_partner_contract_v1[\s\S]*from public, anon, authenticated/)
    expect(contractMigration).toMatch(/grant execute on function public\.gridex_create_partner_contract_v1[\s\S]*to service_role/)
  })

  it('stores POA privately and exposes only bounded PDF content', () => {
    expect(simple).toContain("const POA_BUCKET = 'customer-documents'")
    expect(simple).toContain('MAX_POA_BYTES = 5 * 1024 * 1024')
    expect(simple).toContain("bytes.subarray(0, 5).toString('ascii') !== '%PDF-'")
    expect(simple).toContain("file.toString('base64')")
    expect(openApi).toContain("file_extension: { type: 'string', enum: ['pdf'] }")
  })

  it('reads invoice PDFs from allowlisted private storage instead of fetching arbitrary URLs', () => {
    expect(simple).toContain(".select('file_path,metadata')")
    expect(simple).toContain("'customer-documents', 'customer-contract-documents', 'contract-pdfs', 'billing-exports'")
    expect(simple).toContain('MAX_INVOICE_PDF_BYTES = 15 * 1024 * 1024')
    expect(simple).not.toContain(".select('public_url')")
    expect(simple).not.toContain('fetch(document')
    expect(simple).not.toContain('download_url')
  })

  it('maps the simple webhook events onto the hardened signed webhook subsystem', () => {
    for (const event of [
      'CUSTOMER_CREATED',
      'CUSTOMER_UPDATED',
      'SITE_CREATED',
      'SITE_UPDATED',
      'POWER_OF_ATTORNEY_CREATED',
      'CONTRACT_CREATED',
      'CONTRACT_STATUS_CHANGE',
      'INVOICE_CREATED',
      'INVOICE_UPDATED',
    ]) {
      expect(openApi).toContain(`'${event}'`)
      expect(simple).toContain(`${event}:`)
    }
    expect(simple).toContain('assertPublicWebhookTarget(targetUrl)')
    expect(simple).toContain("gridex_create_partner_webhook_subscription_v1")
    expect(simple).toContain('signing_secret')
    expect(webhookTransport).toContain("url.protocol !== 'https:'")
    expect(webhookTransport).toContain('pinned.address')
    expect(webhooks).toContain('postPublicWebhook')
    expect(vault).toContain('gridex_read_webhook_signing_secret_v1')
  })

  it('keeps the Partner API permission group usable for the simple write/read operations', () => {
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

  it('serves Partner API from the single canonical customer-portal developer URL', () => {
    expect(docs).toContain("redirect('/developers/customer-portal-api#partner-api')")
    expect(customerPortalDocs).toContain('Gridex API')
    expect(customerPortalDocs).toContain('Partner API')
    expect(customerPortalDocs).toContain('partnerOpenApi')
    expect(customerPortalDocs).toContain('PARTNER_API_BASE_URL')
    expect(customerPortalDocs).toContain('/api/partner/v1/openapi.json')
    expect(customerPortalDocs).toContain('server-to-server')
    expect(customerPortalDocs).toContain('Idempotency-Key')
    expect(customerPortalDocs).toContain('Webhooks')
    expect(customerPortalDocs).toContain('data.checkout')
    expect(customerPortalDocs).toContain('thank_you_ready')
    expect(customerPortalDocs).toContain('Gridex platform')
    expect(customerPortalDocs).toContain('Your integration')
    expect(customerPortalDocs).not.toContain('api_client_not_launch_ready')
    expect(customerPortalDocs).not.toContain('tenant_reference')
    expect(customerPortalDocs).not.toContain('company_id')
  })
})
