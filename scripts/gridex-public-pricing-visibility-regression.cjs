const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const must = (condition, message) => {
  if (!condition) throw new Error(message)
  console.log(`✓ ${message}`)
}

const pricing = read('lib/pricing/contractPricingVersioning.ts')
const api = read('lib/website/publicContracts.ts')
const ui =
  read('app/admin/contracts/page.tsx') +
  read('components/admin/contracts/ContractOfferAdminForm.tsx') +
  read('components/admin/contracts/CommercialPricingEditor.tsx')
const actions = read('app/admin/contracts/actions.ts')
const originalMigration = read('supabase/migrations/20260718001000_public_pricing_component_website_visibility.sql')
const boundaryMigration = read('supabase/migrations/20260722233000_external_tenant_pricing_boundary.sql')
const docs = read('docs/external-website-api-integration-guide.md')
const openapi = JSON.parse(read('docs/openapi/website-integration-v1.json'))

must(/schema_version:\s*5/.test(pricing), 'pricing snapshot schema is v5')
must(/website_card_visible/.test(pricing), 'price components carry legacy website visibility')
must(/calculation_inclusion:\s*"included"/.test(pricing), 'price components explicitly carry calculation inclusion')
must(/website:/.test(pricing), 'price components carry explicit website visibility mode')
must(/quote_breakdown:\s*true/.test(pricing), 'fees remain available to internal breakdowns')
must(/contract_document:\s*true/.test(pricing), 'fees remain in contract documents')
must(
  /commercial_components_json/.test(ui) &&
    /component\.website_published/.test(ui),
  'admin can toggle presentation per canonical price component',
)
must(
  /component\.informational_only/.test(ui),
  'admin separates informational rows from calculated components',
)
must(/websiteCardVisibility/.test(actions), 'admin presentation is persisted in immutable version')
must(/customer_types:\s*customerTypes/.test(api), 'API expands customer_type both')
must(/calculationComponents/.test(api), 'API builds complete calculation components')
must(/displayComponents/.test(api), 'API builds a separate display subset')
must(!/visibleComponents/.test(api), 'API no longer filters hidden fees out of calculation data')
must(/publicComponentMetadata/.test(api), 'API allowlistar publik komponentmetadata')
const responseProjection = api.slice(api.indexOf('export function publicContractResponse'), api.indexOf('export type WebsiteLegalBundle'))
must(!/\.\.\.\(offer\.pricing_snapshot/.test(responseProjection), 'API sprider inte hela interna pricing_snapshot i publikt svar')
must(/portfolio_indications:\s*\[\]/.test(api), 'API exponerar inte interna marknadsindikationer')
must(/schemaVersion\s*<\s*3/.test(api), 'legacy snapshots retain historic visibility')
must(/offer\.contract_type === "fixed"/.test(api), 'fixed agreements force fixed-price disclosure in public API')
must(/market_price_supplied_by_gridex:\s*offer\.contract_type !== "fixed"/.test(api), 'fixed agreements do not claim a separate Gridex market price')
must(/input\.contractType === "fixed"/.test(pricing), 'new fixed-price versions force fixed-price disclosure')
must(
  /contractType === "fixed"/.test(ui) &&
    /option\.area_prices\.map/.test(ui) &&
    /name="show_fixed_price_on_website"\s+value="true"/.test(ui),
  'admin cannot hide canonical fixed SE-area price rows',
)
must(/website_card_visible boolean not null default true/.test(originalMigration), 'database retains legacy card visibility')
must(/calculation_inclusion text not null default 'included'/.test(boundaryMigration), 'database stores calculation inclusion')
must(/website_summary_visible boolean not null default true/.test(boundaryMigration), 'database stores summary visibility')
must(/Dolda komponenter filtreras inte bort/.test(docs) && /website_visibility=hidden/.test(docs), 'integration guide documents hidden versus calculated semantics')
must(Boolean(openapi.components.schemas.PricingComponent?.properties?.website_visibility), 'OpenAPI documents pricing visibility')
must(Boolean(openapi.components.schemas.CalculationInclusion), 'OpenAPI documents calculation inclusion')
must(Boolean(openapi.components.schemas.WebsiteVisibilityMode), 'OpenAPI documents visibility modes')

console.log('Public pricing visibility regression passed.')