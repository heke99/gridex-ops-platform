/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
let failed = false
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8') }
function check(condition, message) {
  if (condition) console.log(`PASS ${message}`)
  else { failed = true; console.error(`FAIL ${message}`) }
}

const migration = read('supabase/migrations/20260727040000_contract_security_energy_direction_api_completion.sql')
const deleteRuntimeMigration = read('supabase/migrations/20260727143000_contract_delete_runtime_completion.sql')
for (const signature of [
  'gridex_upsert_internal_contract_offer(uuid,uuid,jsonb,jsonb,uuid)',
  'gridex_upsert_internal_contract_offer_v2(uuid,uuid,jsonb,jsonb,uuid)',
  'gridex_publish_contract_version(uuid,uuid,text,jsonb,jsonb,uuid)',
  'gridex_publish_internal_contract_version(uuid,uuid,uuid)',
  'gridex_publish_contract_channel(uuid,uuid,text,uuid)',
  'gridex_unpublish_contract_channel(uuid,uuid,text,uuid)',
  'gridex_pause_contract_channels(uuid,uuid,uuid)',
  'gridex_close_contract_product(uuid,uuid,uuid,text)',
  'gridex_archive_contract_product(uuid,uuid,uuid)',
  'gridex_preview_delete_unused_contract(uuid,uuid)',
  'gridex_delete_unused_contract(uuid,uuid,uuid)',
  'gridex_remove_internal_contract_offer(uuid,uuid,text,uuid)',
]) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  check(new RegExp(`revoke all on function public\\.${escaped}\\s+from public,anon,authenticated;[\\s\\S]*?grant execute on function public\\.${escaped}\\s+to service_role;`, 'i').test(migration), `${signature} är service-only`)
}
check(/security definer[\s\S]*set search_path=public,pg_temp/.test(migration), 'Ny SECURITY DEFINER-funktion har explicit search_path')
for (const signature of [
  'gridex_contract_delete_dependency_graph_v2(uuid,uuid)',
  'gridex_preview_delete_unused_contract_v2(uuid,uuid,uuid)',
  'gridex_delete_unused_contract_v2(uuid,uuid,uuid,text)',
  'gridex_remove_internal_contract_offer_v2(uuid,uuid,text,uuid,text)',
]) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  check(new RegExp(`revoke all on function public\\.${escaped}\\s+from public,anon,authenticated;[\\s\\S]*?grant execute on function public\\.${escaped}\\s+to service_role;`, 'i').test(deleteRuntimeMigration), `${signature} är service-only`)
}
check(/security definer[\s\S]*set search_path=public,auth,pg_temp/.test(deleteRuntimeMigration), 'Delete v2 SECURITY DEFINER-funktioner har explicit search_path')
check(/pg_advisory_xact_lock/.test(deleteRuntimeMigration) && /for update/i.test(deleteRuntimeMigration) && /contract_delete_preview_stale/.test(deleteRuntimeMigration), 'Delete v2 upprepar dependency graph under advisory- och radlås')
check(/contract_already_deleted/.test(deleteRuntimeMigration), 'Delete v2 har canonical idempotent resultat')
check(/contract_products[\s\S]*contract_product_versions[\s\S]*contract_publication_versions[\s\S]*public_contract_offers[\s\S]*energy_direction/.test(migration) && /website_contract_quotes[\s\S]*contract_product_id[\s\S]*price_plan_id[\s\S]*price_book_id[\s\S]*energy_direction/.test(migration), 'Produkt, immutable version, publicering och quote får explicit canonical energiriktning och prisidentiteter')
check(/website_customer_applications[\s\S]*contract_publication_version_id[\s\S]*price_book_id[\s\S]*energy_direction/.test(migration), 'Kundansökan binds till publiceringsversion, prisbok och energiriktning')
check(/gridex_enforce_quote_binding_v2/.test(migration) && /quote_binding_energy_direction_mismatch/.test(migration), 'Databasen stoppar quote/application/contract mismatch')
check(/gridex_contract_energy_direction_guard_v1/.test(migration) && /canonical_energy_direction_mismatch/.test(migration), 'Databasen håller energiriktningen identisk genom hela immutable publiceringsgrafen')
check(!/public_offer\.commercial_snapshot|pco\.commercial_snapshot|new\.commercial_snapshot/.test(migration), 'public_contract_offers använder endast kolumner som finns i canonical schemat')
check(/before insert or update of\s+contract_product_id,contract_product_version_id,contract_publication_version_id,\s+source_contract_offer_id,energy_direction,metadata\s+on public\.public_contract_offers/.test(migration), 'Public-offer-triggern följer canonical version/source/metadata utan saknad commercial_snapshot-kolumn')
check(/gridex_enforce_quote_canonical_identity_v1/.test(migration) && /quote_canonical_identity_incomplete/.test(migration) && /quote_canonical_identity_mismatch/.test(migration), 'Nya quotes kräver fullständig canonical produkt-, pris-, juridik- och publiceringsidentitet')
check(/quote_binding_target_identity_incomplete/.test(migration), 'Ansökan och kundavtal kan inte utelämna quote-bindningens canonical identiteter')
check(/v_lifecycle_status='archived'[\s\S]*create_successor_product/.test(migration), 'Arkiverad produkt är terminal och hänvisar till efterföljare')
check(/gridex_normalize_audit_context_v1/.test(migration) && /actor_type/.test(migration) && /request_id/.test(migration) && /correlation_id/.test(migration), 'Audit normaliserar actor och request/correlation context')
check(/createSupabaseServiceRequestClient/.test(read('lib/supabase/service.ts')) && /x-request-id/.test(read('lib/supabase/service.ts')), 'Kontrakts-RPC skickar request context till databasen')

const lifecycle = read('lib/contracts/lifecycle.ts')
check(/archived:\s*new Set\(\[\]\)/.test(lifecycle) && /archived:\s*\[\]/.test(lifecycle), 'UI-statusmaskinen har inga actions eller övergångar från archived')
const adminActions = read('app/admin/contracts/actions.ts')
check(/previousLifecycle === "archived"[\s\S]*efterföljande produkt/.test(adminActions), 'Server action stoppar versionering av arkiverat avtal')
check(/assertUserCanOperateCompany/.test(adminActions) && /contractMutationServiceClient\(\)\.rpc/.test(adminActions), 'Adminmutation verifierar sessionens tenant före service-role-RPC')

const quote = read('lib/pricing/websiteQuotes.ts')
for (const field of ['contract_product_id','contract_product_version_id','contract_publication_version_id','price_plan_id','price_plan_version_id','price_book_id','legal_bundle_version_id','energy_direction']) {
  check(quote.includes(field), `Quote binder ${field}`)
}
const application = read('lib/website/customerApplications.ts')
check(
  /validateWebsiteQuote\([\s\S]*onboardCanonicalWebsiteCustomerGraph/.test(application) &&
    /onboardCustomerGraph\(\{[\s\S]*quote:\s*input\.websiteQuote/.test(application) &&
    /consumed_at\s*=\s*now\(\)/.test(
      read('supabase/migrations/20260727166000_atomic_quote_application_onboarding_commit.sql'),
    ),
  'Quote valideras före atomisk konsumering och ansökningscommit',
)
check(/energy_direction:\s*selected\.energyDirection/.test(application), 'Kundavtal skapas med publicerad energiriktning')
check(!/energy_direction:\s*["']consumption["']/.test(read('lib/customer-contracts/db.ts')), 'Kundavtalsrepository saknar hårdkodad consumption')
check(!/energy_direction:\s*["']consumption["']/.test(read('lib/billing/underlayEngine.ts')), 'Billing underlay saknar hårdkodad consumption')

const companyControls = read('app/admin/companies/[id]/TenantPlatformControls.tsx')
check(/const pageSize = Math\.min\(100, Math\.max\(1, Math\.trunc\(options\.pageSize/.test(companyControls) && /count:\s*"exact"/.test(companyControls), 'Företagssidan använder riktig server-side pagination med total count')
check(!/limit\(5000\)/.test(companyControls), 'Globalt 5000-tak är borttaget')
check(/selectedQuery[\s\S]*\.eq\("company_id", companyId\)[\s\S]*\.eq\("id", diagnoseContractId\)/.test(companyControls), 'Diagnostik hämtar valt avtal direkt med tenant och ID')

const publicApplication = read('lib/website/publicCustomerApplication.ts')
check(publicApplication.includes("'energy_direction'"), 'Publikt ansökningssvar exponerar energiriktning')
const publicContracts = read('lib/website/publicContracts.ts')
check(/energy_direction/.test(publicContracts) && /production_pricing/.test(publicContracts) && /self_billing/.test(publicContracts), 'Public Contract DTO modellerar consumption/production och settlement')

const openapi = JSON.parse(read('docs/openapi/website-integration-v1.json'))
check(openapi.info.version === '2026-08-03.1' && openapi['x-contract-schema-version'] === '2026-08-03.1', 'Website OpenAPI har höjd kontraktsversion')
check(Boolean(openapi.components.schemas.EnergyDirection && openapi.components.schemas.ProductionPricing), 'Website OpenAPI modellerar energiriktning och production pricing')
check(Boolean(openapi.components.schemas.ApiError && openapi.components.schemas.ApiBlocker), 'Website OpenAPI har canonical strukturerad felmodell')
check(Boolean(openapi.paths['/api/v1/website/legal-bundle']?.get) && !openapi.paths['/api/v1/website/legal/bundle'], 'GET /website/legal-bundle är enda canonical legal route')
check(!/2026-07-25\.1/.test(read('docs/openapi/website-integration-v1.json')), 'Gammal externa kontraktsversionen är borttagen från website OpenAPI')

if (failed) process.exit(1)
console.log('Gridex contract security/energy-direction regression passed.')
