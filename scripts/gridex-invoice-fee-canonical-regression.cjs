const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const must = (condition, message) => {
  if (!condition) throw new Error(message)
  console.log(`✓ ${message}`)
}

const internalAction = read('app/admin/contracts/actions.ts')
const internalSchema = read('lib/contracts/adminContractSchema.ts')
const tenantAction = read('app/admin/companies/[id]/tenant-platform-actions.ts')
const quote = read('lib/pricing/offerQuote.ts')
const publicContracts = read('lib/website/publicContracts.ts')
const migration = read('supabase/migrations/20260720183000_invoice_fee_canonical_contract_completion.sql')
const boundaryMigration = read('supabase/migrations/20260722233000_external_tenant_pricing_boundary.sql')
const adminUi =
  read('app/admin/contracts/page.tsx') +
  read('components/admin/contracts/ContractOfferAdminForm.tsx') +
  read('components/admin/contracts/CommercialPricingEditor.tsx')
const tenantUi = read('app/admin/companies/[id]/TenantPlatformControls.tsx')
const developerPage = read('app/developers/customer-portal-api/page.tsx')
const openapi = JSON.parse(read('docs/openapi/website-integration-v1.json'))

must(/invoice_fee_sek:\s*canonicalPricingCommand\.invoice_fee_sek/.test(internalAction), 'internal contract command persists invoice_fee_sek')
must(/buildCanonicalContractPricingCommand/.test(internalAction) && /invoiceFeeSek/.test(internalSchema) && /Publicering kräver fakturaavgift/.test(internalSchema) && /gridex_publish_contract_channel/.test(tenantAction) && !/parseCanonicalInvoiceFee/.test(tenantAction), 'canonical admin preserves zero and company page cannot create parallel invoice fee')
must(/gridex_invoice_fee_readiness/.test(migration) && /invoice_fee_missing/.test(migration) && /invoice_fee_conflict/.test(migration) && /invoice_fee_ambiguous/.test(migration), 'publication readiness has all invoice fee blocker codes')
must(/gridex_backfill_invoice_fees/.test(migration) && /contract_invoice_fee_remediation_tasks/.test(migration), 'migration contains idempotent invoice fee remediation')
must(/assessCanonicalInvoiceFee/.test(publicContracts) && /pricing_readiness/.test(publicContracts), 'public listing diagnostics validate canonical invoice fee')
must(/assessCanonicalInvoiceFee/.test(quote) && /component_code/.test(quote) && /amount_inc_vat/.test(quote), 'internal OPS quote engine still calculates canonical invoice fee')
must(
  /commercial_components_json/.test(adminUi) &&
    /Avgifter, tillval och villkor/.test(adminUi) &&
    /Publicera canonical avtal på hemsidan/.test(tenantUi),
  'pricing is edited only in canonical admin and tenant page is channel-only',
)
must(
  /website_published/.test(adminUi) &&
    /informational_only/.test(adminUi) &&
    !/name="invoice_fee_sek"/.test(tenantUi),
  'calculation is separated from visibility without duplicate tenant fields',
)
must(/invoice_fee: invoiceFee/.test(publicContracts) && /invoice_fee_sek: offer\.invoice_fee_sek/.test(publicContracts), 'invoice fee is always returned to tenant calculation API')
must(/calculation_inclusion/.test(publicContracts) && /website_visibility/.test(publicContracts), 'invoice fee calculation and presentation are separate')
must(/website_summary_visible/.test(boundaryMigration), 'database supports summary visibility independently')
must(openapi.info.version === '2026-07-30.3', 'OpenAPI contract version is 2026-07-30.3')
must(Boolean(openapi.paths['/api/v1/website/quote'].post.responses['201']) && openapi.paths['/api/v1/website/quote'].post['x-required-scopes'].includes('website_quotes.write'), 'canonical quote endpoint is documented as active')
must(Boolean(openapi.components.schemas.PricingComponent.properties.calculation_inclusion), 'OpenAPI documents calculation inclusion')
must(Boolean(openapi.components.schemas.PricingComponent.properties.website_visibility), 'OpenAPI documents website visibility')
must(/calculation_components/.test(developerPage) && /display_components/.test(developerPage), 'developer guide documents complete calculation data and separate display data')

console.log('Canonical invoice fee regression passed.')
