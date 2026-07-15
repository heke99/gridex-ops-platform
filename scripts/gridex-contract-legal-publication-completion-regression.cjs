const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20260714160000_canonical_contract_runtime_completion.sql')
const integrityMigration = read('supabase/migrations/20260714223000_contract_publication_reference_integrity_hardening.sql')
const automaticPricingMigration = read('supabase/migrations/20260715120000_automatic_contract_pricing_versioning.sql')
const pricingCompletionMigration = read('supabase/migrations/20260715123000_contract_pricing_canonical_completion.sql')
const pgcryptoRuntimeHotfix = read('supabase/migrations/20260715170000_contract_pgcrypto_runtime_search_path_hotfix.sql')
const page = read('app/admin/contracts/page.tsx')
const actions = read('app/admin/contracts/actions.ts')
const canonical = read('lib/contracts/canonical.ts')
const publicContracts = read('lib/website/publicContracts.ts')
const applications = read('lib/website/customerApplications.ts')
const tenantPlatformActions = read('app/admin/companies/[id]/tenant-platform-actions.ts')
const publicOfferReadiness = read('lib/website/publicOfferReadiness.ts')
const tenantPlatformControls = read('app/admin/companies/[id]/TenantPlatformControls.tsx')
const docs = read('app/developers/customer-portal-api/page.tsx')
const required = [
  ['legal rule matrix', migration.includes('legal_requirement_rules') && migration.includes('gridex_required_legal_modules')],
  ['contract version trigger uses real columns', !migration.includes('new.commercial_terms') && migration.includes('update of customer_type,contract_type,automatic_renewal,power_of_attorney_required,required_legal_modules')],
  ['canonical catalog uses real schema columns', canonical.includes('commercial_snapshot') && canonical.includes('product_code') && canonical.includes('product_category') && !canonical.includes('commercial_terms')],
  ['legal profile fields are React-safe', page.includes('Array<[string, string, unknown]>')],
  ['all legal modules', ['general_consumer_terms','general_business_terms','withdrawal_right','portfolio_terms','complaints_and_disputes'].every(x => migration.includes(x))],
  ['tenant legal profile blocker', migration.includes('tenant_legal_profiles_completeness') && migration.includes('tenant_legal_profile_incomplete')],
  ['immutable publication', migration.includes('gridex_publish_contract_publication_version') && migration.includes('publication_not_locked')],
  ['legacy published offer immutable', migration.includes('published_offer_is_immutable_create_new_version')],
  ['canonical API source', publicContracts.includes("from('canonical_public_contract_offers_v')")],
  ['stored offer reference', publicContracts.includes('canonical_offer_reference')],
  ['tenant catalog UI', page.includes('Tilldelade avtalsversioner') && canonical.includes('tenant_contract_assignments')],
  ['tenant channel controls', page.includes('updateTenantContractChannelAction') && actions.includes('website_publication_allowed')],
  ['tenant legal profile UI', page.includes('saveTenantLegalProfileAction') && actions.includes('tenant_legal_profiles')],
  ['signed contracts separated', page.includes('Tecknade kundavtal')],
  ['atomic evidence capture', migration.includes('gridex_capture_signed_contract_evidence') && migration.includes('customer_contract_acceptances')],
  ['PDF evidence archive', applications.includes("document_type: 'signed_contract_pdf'") && applications.includes('document_sha256')],
  ['strict offer selector documented', docs.includes('offer_reference') && docs.includes('offer_selector_mismatch')],
  ['publication readiness receives selected price ids', tenantPlatformActions.includes('price_plan_id: pricePlanId') && tenantPlatformActions.includes('price_plan_version_id: pricePlanVersionId')],
  ['price book reuse is exact-version scoped', tenantPlatformActions.includes("component_key', 'price_plan_version'") && tenantPlatformActions.includes('metadata.price_plan_version_id === input.pricePlanVersionId')],
  ['price book readiness verifies exact mapping', publicOfferReadiness.includes('Prislistan är inte kopplad till vald prisplan och prisplansversion') && publicOfferReadiness.includes(".eq('component_key', 'price_plan_version')")],
  ['price plan and version status both validated', publicOfferReadiness.includes(".from('price_plans')") && publicOfferReadiness.includes('Prisplanen är inte aktiv/publicerad') && publicOfferReadiness.includes('Prisplansversionen är inte aktiv/publicerad')],
  ['same API client needs read and write scopes', publicOfferReadiness.includes("['website_contracts.read', 'website_applications.write']") && integrityMigration.includes("array['website_contracts.read','website_applications.write']")],
  ['stale price books cannot be reused', tenantPlatformActions.includes('priceBookMatchesPlanVersion') && automaticPricingMigration.includes('price_plan_version_id = v_version_id') && pricingCompletionMigration.includes('Prislistan tillhör inte bolaget eller vald prisversion')],
  ['incomplete legal bundle fails closed', tenantPlatformActions.includes('Databasschemat för juridikpaketets dokument är inte installerat') && !tenantPlatformActions.includes('if (isMissingSchemaError(itemsError)) return true')],
  ['pricing creation is transactional instead of manual cleanup', automaticPricingMigration.includes('gridex_create_or_version_contract_pricing') && automaticPricingMigration.includes('perform pg_advisory_xact_lock') && automaticPricingMigration.includes('begin;') && automaticPricingMigration.includes('commit;')],
  ['missing legal profile is blocked', integrityMigration.includes("coalesce(tlp.completeness_status,'incomplete')")],
  ['combined audience receives both legal rule sets', integrityMigration.includes("v_customer_type='both'") && integrityMigration.includes("r.customer_type in ('private','business','both')")],
  ['spot contract type is normalized', integrityMigration.includes("when 'spot' then 'variable_monthly'")],
  ['mandatory legal modules cannot be removed', integrityMigration.includes("coalesce(new.required_legal_modules,'{}') || coalesce(v_required,'{}')")],
  ['canonical SQL verifies exact price references', integrityMigration.includes('price_book_plan_version_mismatch') && integrityMigration.includes('price_plan_version_mismatch')],
  ['admin UI exposes database load errors', tenantPlatformControls.includes('Vissa avtalsuppgifter kunde inte laddas') && tenantPlatformControls.includes('databaseErrorMessage')],
  ['contract pgcrypto runtime includes extensions schema', pgcryptoRuntimeHotfix.includes('public, extensions, pg_temp') && pgcryptoRuntimeHotfix.includes('gridex_create_or_version_contract_pricing') && pgcryptoRuntimeHotfix.includes('gridex_sync_public_offer_to_canonical') && pgcryptoRuntimeHotfix.includes('gridex_publish_contract_publication_version') && pgcryptoRuntimeHotfix.includes('gridex-contract-runtime-self-test')],
]
const failed = required.filter(([, ok]) => !ok)
if (failed.length) {
  for (const [name] of failed) console.error(`FAIL: ${name}`)
  process.exit(1)
}
console.log(`Canonical contract completion regression passed (${required.length} controls).`)
