#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20260721170000_contract_graph_api_revision_hardening.sql')
const publicRoute = read('app/api/v1/website/public-contracts/route.ts')
const diagnosticsRoute = read('app/api/v1/website/public-contracts/diagnostics/route.ts')
const publicContracts = read('lib/website/publicContracts.ts')
const quote = read('lib/pricing/offerQuote.ts')
const marketSources = read('lib/pricing/marketPriceSources.ts')
const sourceResolver = read('lib/pricing/priceSourceResolver.ts')
const intervalPricing = read('lib/pricing/intervalPricing.ts')
const lifecycleErrors = read('lib/contracts/lifecycleErrors.ts')
const dbTest = read('scripts/gridex-contract-db-lifecycle-test.sql')
const repairScript = read('scripts/gridex-contract-publication-graph-repair.sql')
const openapi = JSON.parse(read('docs/openapi/customer-portal-v1.json'))

const failures = []
let checks = 0
const check = (condition, label) => { checks += 1; if (!condition) failures.push(label) }
const includesAll = (source, terms, label) => terms.forEach((term) => check(source.includes(term), `${label}: ${term}`))

includesAll(migration, [
  'gridex_resolve_contract_lifecycle_graph',
  'gridex_contract_system_dependency_counts',
  'gridex_preview_delete_unused_contract',
  'gridex_repair_contract_publication_links',
  'gridex_delete_unused_contract',
  'gridex_remove_internal_contract_offer',
], 'current lifecycle RPC surface')

check(
  migration.includes('where cardinality(v_public_offer_ids)>0\n      and cpv.legacy_public_contract_offer_id=any(v_public_offer_ids)') &&
  !migration.includes('contract_publication_id=any(v_publication_ids)\n    and legacy_public_contract_offer_id=any(v_public_offer_ids)'),
  'direct reverse FK lookup is not restricted by the locally derived publication list',
)
includesAll(migration, [
  'set legacy_public_contract_offer_id=null\n  where legacy_public_contract_offer_id=any(v_public_offer_ids)',
  'set lifecycle_status=\'draft\'',
  'contract_publication_version_id=null',
  'contract_public_offer_still_referenced',
  'gridex_assert_no_public_offer_fk_references',
], 'delete detaches both directions and asserts all remaining FKs')

const resolverCalls = (migration.match(/gridex_resolve_contract_lifecycle_graph\(p_company_id,p_offer_id\)/g) || []).length
check(resolverCalls >= 5, 'dependency counts, preview, repair and delete delegate to the shared graph resolver')
includesAll(migration, [
  'PUBLICATION_COMPANY_MISMATCH',
  'PUBLICATION_CHANNEL_MISMATCH',
  'PUBLICATION_VERSION_LINK_MISMATCH',
  'HAS_SHARED_CANONICAL_VERSION',
  'HAS_SHARED_LEGAL_VERSION',
], 'structured graph and business blockers')
includesAll(migration, [
  'contract_publication_revisions',
  'gridex_bump_contract_publication_revision',
  'contracts.publication.changed',
  'event_outbox',
], 'tenant/channel revision and generic webhook outbox')
includesAll(migration, [
  'company_market_price_sources',
  'supported_resolutions',
  'allow_indicative_latest',
], 'provider-independent tenant market-price policy')
includesAll(migration, [
  'gridex_new_offer_reference',
  "'offer_'||encode(digest",
  "v_offer_reference:=public.gridex_new_offer_reference",
], 'future external references are opaque without rewriting historical references')
includesAll(migration, [
  'tenant_assignment_valid',
  'channel_valid',
  'source_offer_consistent',
  'canonical_graph_consistent',
], 'canonical graph integrity view fails closed on structural mismatch')

includesAll(publicRoute, [
  'parsePublicContractsQuery',
  'loadPublicationRevision',
  'If-None-Match'.toLowerCase().replace('if-none-match', 'ifNoneMatchMatches'),
  "ETag: input.etag",
  "publication_revision",
  "request_id",
  "deprecated_aliases",
], 'public feed response, revision and strict query handling')
check(publicRoute.includes("['website_contracts.read', 'website_contracts.diagnostics']"), 'legacy diagnostics mode requires the separate diagnostics scope')
includesAll(diagnosticsRoute, [
  "['website_contracts.diagnostics']",
  'data: []',
  'diagnostics:',
  'publication_revision',
], 'separate diagnostics endpoint has stable response shape and scope')

includesAll(publicContracts, [
  'loadPublicationGraphIntegrity',
  'canonical_graph_consistent !== true',
  'PUBLICATION_GRAPH_INCONSISTENT',
], 'normal feed and diagnostics use the same fail-closed graph integrity source')

includesAll(publicContracts, [
  'loadPublicationReadinessByVersion',
  'loadLegalVersionsByBundle',
  'loadPortfolioPricingByOffer',
  'await Promise.all([',
], 'public feed resolves readiness, legal and portfolio data in tenant-scoped bulk queries')
check(!publicContracts.includes('assessPublicOfferReadiness'), 'public feed no longer performs a readiness query per offer')
check(!publicContracts.includes('appendReadyOffer'), 'public feed no longer builds output through an awaited per-offer helper')

includesAll(publicContracts, [
  'id: offerReference',
  'offer_reference: offerReference',
  'contract_offer_id: offerReference',
  'publication_reference: offerReference',
], 'public DTO uses one opaque external identity')
includesAll(quote, [
  'id: offerReference',
  'snapshotSchema = canonicalSnapshotSchema(exactSnapshot)',
  'pricing_interval: pricingInterval',
  'estimate_method:',
  'market_data_timestamp:',
  'is_binding: false',
], 'quote does not leak internal IDs and explains estimate evidence')
check(!quote.includes('gridex_contract_pricing_v4'), 'quote does not hardcode the obsolete V4 snapshot schema')
check(!sourceResolver.includes('.eq("source", "elprisetjustnu")'), 'monthly quote resolver does not hardcode a provider')
check(!intervalPricing.includes('.eq("source", "elprisetjustnu")'), 'interval resolver does not hardcode a provider')
includesAll(marketSources, ['company_market_price_sources', 'priority', 'selectMarketPriceRow'], 'market source selection is tenant-configured')

includesAll(lifecycleErrors, [
  'contract_public_offer_still_referenced',
  "code === '23503'",
  "code === '23505'",
  "code === '23514'",
  "code === '42501'",
  "code === '55000'",
  "code === 'P0001'",
  "code === 'P0002'",
], 'lifecycle error reasons and SQLSTATEs are centralized')
includesAll(dbTest, [
  'direct_reverse_legacy_publication_version_ids',
  'preview_promised_unsafe_delete',
  'delete_did_not_return_structured_graph_blocker',
], 'DB lifecycle test reproduces the out-of-tree reverse FK reference')

includesAll(repairScript, [
  'gridex_resolve_contract_lifecycle_graph',
  'gridex_preview_delete_unused_contract',
  'gridex_repair_contract_publication_links',
  'contract_publication_graph_issues',
], 'controlled repair script delegates to canonical resolver and safe repair')
check(!repairScript.includes('bbf422ff-2f62-45ec-af24-0df86e3d11f4'), 'controlled repair script has no production-offer UUID special case')

const publicPath = openapi.paths['/api/v1/website/public-contracts']?.get
const diagnosticPath = openapi.paths['/api/v1/website/public-contracts/diagnostics']?.get
check(Boolean(publicPath?.responses?.['304']), 'OpenAPI documents ETag 304')
check(diagnosticPath?.['x-required-scopes']?.includes('website_contracts.diagnostics'), 'OpenAPI diagnostics scope matches runtime')
check(openapi.components.schemas.WebsiteQuoteData.properties.snapshot_schema.const === undefined, 'OpenAPI quote schema no longer falsely claims V4')
check(openapi.components.schemas.PublicContractOffer.properties.contract_offer_id.deprecated === true, 'OpenAPI marks contract_offer_id deprecated')
check(openapi.components.schemas.PublicContractOffer.properties.publication_reference.deprecated === true, 'OpenAPI marks publication_reference deprecated')

if (failures.length) {
  console.error(`Contract single-source regression failed (${failures.length}/${checks}):`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}
console.log(`Contract single-source regression passed (${checks} controls).`)
