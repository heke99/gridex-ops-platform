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
const commercialModel = read('lib/pricing/commercialModel.ts')
const customerContractAction = read('components/admin/customers/contracts/actions.ts')
const customerContractForm = read('components/admin/customers/contracts/ContractForms.tsx')
const customerIntake =
  read('app/admin/customers/intake/page.tsx') +
  read('app/admin/customers/actions.ts') +
  read('app/admin/customers/actionState.ts') +
  read('components/admin/customers/CustomerIntakeForm.tsx') +
  read('components/admin/customers/CustomerIntakeEnhancer.tsx')
const customerAgreementViews =
  read('lib/customer-portal/db.ts') +
  read('lib/customer-portal/types.ts') +
  read('app/portal/avtal/page.tsx') +
  read('components/admin/customers/CustomerContractOfferEligibilityCard.tsx') +
  read('components/admin/customers/contracts/CustomerContractsCard.tsx')
const publicContracts = read('lib/website/publicContracts.ts')
const priceSourceResolver = read('lib/pricing/priceSourceResolver.ts')
const cisContractPayload = read('lib/cis/db-shared.ts')
const migration = read('supabase/migrations/20260720183000_invoice_fee_canonical_contract_completion.sql')
const customerContractFeeMigration = read('supabase/migrations/20260804003000_customer_contract_fee_consistency.sql')
const boundaryMigration = read('supabase/migrations/20260722233000_external_tenant_pricing_boundary.sql')
const adminUi =
  read('app/admin/contracts/page.tsx') +
  read('components/admin/contracts/ContractOfferAdminForm.tsx') +
  read('components/admin/contracts/CommercialPricingEditor.tsx')
const tenantUi = read('app/admin/companies/[id]/TenantPlatformControls.tsx')
const developerPage = read('app/developers/customer-portal-api/page.tsx')
const openapi = JSON.parse(read('docs/openapi/website-integration-v1.json'))

must(/invoice_fee_sek:\s*canonicalPricingCommand\.invoice_fee_sek/.test(internalAction), 'internal contract command persists invoice_fee_sek')
must(
  /name="invoice_fee_sek"/.test(adminUi) &&
    /name="monthly_fee_sek"/.test(adminUi) &&
    /name="green_fee_mode"/.test(adminUi) &&
    /name="green_fee_value"/.test(adminUi) &&
    /name="start_fee_sek"/.test(adminUi) &&
    /name="admin_fee_sek"/.test(adminUi) &&
    /name="break_fee_sek"/.test(adminUi),
  'canonical admin exposes every contract-wide fee for fixed and variable agreements',
)
must(
  /isReservedStandardComponentCode/.test(adminUi) &&
    /pappersfakturaavgift/.test(adminUi),
  'standard fees cannot be duplicated as advanced conditional components',
)
must(/buildCanonicalContractPricingCommand/.test(internalAction) && /invoiceFeeSek/.test(internalSchema) && /Fakturaavgift måste anges/.test(internalSchema) && /gridex_publish_contract_channel/.test(tenantAction) && !/parseCanonicalInvoiceFee/.test(tenantAction), 'canonical admin preserves zero and company page cannot create parallel invoice fee')
must(/gridex_invoice_fee_readiness/.test(migration) && /invoice_fee_missing/.test(migration) && /invoice_fee_conflict/.test(migration) && /invoice_fee_ambiguous/.test(migration), 'publication readiness has all invoice fee blocker codes')
must(/gridex_backfill_invoice_fees/.test(migration) && /contract_invoice_fee_remediation_tasks/.test(migration), 'migration contains idempotent invoice fee remediation')
must(
  /gridex_apply_contract_offer_standard_fees/.test(customerContractFeeMigration) &&
    /new\.invoice_fee_sek := v_offer\.invoice_fee_sek/.test(customerContractFeeMigration) &&
    /new\.start_fee_sek := v_offer\.start_fee_sek/.test(customerContractFeeMigration) &&
    /new\.admin_fee_sek := v_offer\.admin_fee_sek/.test(customerContractFeeMigration) &&
    /new\.break_fee_sek := v_offer\.break_fee_sek/.test(customerContractFeeMigration) &&
    /manual_override/.test(customerContractFeeMigration) &&
    /before insert or update of contract_offer_id, source_type/.test(customerContractFeeMigration),
  'database freezes catalog agreement fees without overwriting manual overrides or later edits',
)
must(/assessCanonicalInvoiceFee/.test(publicContracts) && /pricing_readiness/.test(publicContracts), 'public listing diagnostics validate canonical invoice fee')
must(/assessCanonicalInvoiceFee/.test(quote) && /component_code/.test(quote) && /amount_inc_vat/.test(quote), 'internal OPS quote engine still calculates canonical invoice fee')
must(
  /const invoiceFee = numberValue\(input\.contract\?\.invoice_fee_sek\)/.test(priceSourceResolver) &&
    /componentType: "invoice_fee"/.test(priceSourceResolver) &&
    /lifecycle: "per_invoice"/.test(priceSourceResolver) &&
    /event: "early_termination"/.test(priceSourceResolver),
  'billing fallback includes invoice fee every invoice and keeps break fee event-only',
)
must(
  /invoice_fee_sek: contract\.invoice_fee_sek/.test(cisContractPayload) &&
    /start_fee_sek: contract\.start_fee_sek/.test(cisContractPayload) &&
    /admin_fee_sek: contract\.admin_fee_sek/.test(cisContractPayload) &&
    /break_fee_sek: contract\.break_fee_sek/.test(cisContractPayload),
  'CIS contract payload carries every standard agreement fee',
)
must(
  /mergeFrozenPriceComponentsWithCommercialSelection/.test(commercialModel) &&
    /mergeFrozenPriceComponentsWithCommercialSelection/.test(quote) &&
    /mergeFrozenPriceComponentsWithCommercialSelection/.test(customerContractAction),
  'commercial selections preserve frozen contract-wide fees in quotes and customer contracts',
)
must(
  /invoiceFeeSek:\s*offer\.invoice_fee_sek/.test(customerContractAction) &&
    /Fakturaavgift:/.test(customerContractForm),
  'internal customer contract flow carries and displays the agreement invoice fee',
)
must(
  /invoice_fee_sek: offer\.invoice_fee_sek/.test(customerIntake) &&
    /invoiceFeeSek/.test(customerIntake) &&
    /startFeeSek/.test(customerIntake) &&
    /adminFeeSek/.test(customerIntake) &&
    /breakFeeSek/.test(customerIntake),
  'admin customer intake copies every standard agreement fee from the selected contract',
)
must(
  /invoice_fee_sek/.test(customerAgreementViews) &&
    /Fakturaavgift/.test(customerAgreementViews) &&
    /Startavgift/.test(customerAgreementViews) &&
    /Administrationsavgift/.test(customerAgreementViews) &&
    /Brytavgift/.test(customerAgreementViews),
  'customer and admin agreement views expose all standard fees consistently',
)
must(
  /commercial_components_json/.test(adminUi) &&
    /Villkorade avgifter, tillval och särskilda komponenter/.test(adminUi) &&
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
must(openapi.info.version === '2026-08-03.1', 'OpenAPI contract version is 2026-08-03.1')
must(Boolean(openapi.paths['/api/v1/website/quote'].post.responses['201']) && openapi.paths['/api/v1/website/quote'].post['x-required-scopes'].includes('website_quotes.write'), 'canonical quote endpoint is documented as active')
must(Boolean(openapi.components.schemas.PricingComponent.properties.calculation_inclusion), 'OpenAPI documents calculation inclusion')
must(Boolean(openapi.components.schemas.PricingComponent.properties.website_visibility), 'OpenAPI documents website visibility')
must(/calculation_components/.test(developerPage) && /display_components/.test(developerPage), 'developer guide documents complete calculation data and separate display data')

console.log('Canonical invoice fee regression passed.')
