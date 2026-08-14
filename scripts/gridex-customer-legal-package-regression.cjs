#!/usr/bin/env node
const fs = require('node:fs')

function read(path) {
  return fs.readFileSync(path, 'utf8')
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const packageSource = read('lib/legal/customerDocumentPackage.ts')
// Customer application processing is intentionally split across focused modules.
// Aggregate the implementation surface so this regression protects behavior,
// rather than depending on the old facade file layout.
const applications = [
  'lib/website/customerApplications.ts',
  'lib/website/customerApplicationLegal.ts',
  'lib/website/customerApplicationProcess.ts',
  'lib/website/customerApplicationRepair.ts',
  'lib/website/customerApplicationSchemas.ts',
  'lib/website/customerApplicationShared.ts',
].map(read).join('\n')
const intakeOrchestrator = read('lib/customer-operations/customerIntakeOrchestrator.ts')
const publicContracts = read('lib/website/publicContracts.ts')
const publicLegal = read('lib/legal/publicLegalDocuments.ts')
const publicLegalPage = read('app/legal/[slug]/[type]/[versionId]/page.tsx')
const poaWorkflow = read('lib/operations/powerOfAttorneyWorkflow.ts')
const authorizationChain = read('lib/legal/authorizationChain.ts')
const tenantSync = read('lib/customer-portal/tenantSync.ts')
const tenantSyncContract = read('lib/customer-portal/customerSyncContract.ts')
const publicContractModel = read('lib/external-contracts/publicContractModel.ts')
const materializer = read(
  'supabase/migrations/20260716183000_contract_canonical_finalization.sql',
)
const openapi = JSON.parse(
  read('docs/openapi/website-integration-v1.json'),
)
const customerPortalOpenapi = JSON.parse(
  read('docs/openapi/customer-portal-v1.json'),
)
const fixture = JSON.parse(
  read('docs/fixtures/public-contracts-response-2026-08-10.1.json'),
)

for (const kind of ['agreement', 'power_of_attorney', 'withdrawal']) {
  assert(packageSource.includes(`'${kind}'`), `missing customer document ${kind}`)
}
assert(
  packageSource.includes("normalized === 'power_of_attorney'") &&
    packageSource.includes('WITHDRAWAL_MODULES.has(normalized)'),
  'customer document grouping does not isolate POA and withdrawal',
)
assert(
  publicContracts.includes('requirements = customerDocuments.flatMap'),
  'legal-bundle still builds one customer requirement per canonical module',
)
assert(
  applications.includes('groupedMode') &&
    applications.includes('legacyModuleMode') &&
    applications.includes('Blandade format tillåts inte'),
  'application API does not support grouped acceptance with legacy compatibility',
)
assert(
  applications.includes(
    'isCustomerLegalDocumentKind(acceptance.requirement_code)',
  ) && applications.includes('groupedCodes.has(acceptance.requirement_code)'),
  'grouped legal acceptance codes are not type-narrowed before Set membership checks',
)
assert(
  intakeOrchestrator.includes("| 'facility_lookup_waiting_response'") &&
    applications.includes('intakeDecision.state === "facility_lookup_waiting_response"') &&
    !applications.includes('facility_information_lookup_waiting_response'),
  'website continuation uses a non-canonical customer intake state',
)
assert(
  applications.includes('power_of_attorney_offer_version_mismatch') &&
    applications.includes('offerPowerOfAttorneyVersion.id'),
  'POA is not locked to the accepted offer bundle',
)
assert(
  applications.includes('exactScopesMatch') &&
    applications.includes('exactLegalVersionMatches') &&
    applications.includes('OPS never widens an existing authorization'),
  'POA reuse can widen scope or rebind the accepted legal version',
)
assert(
  applications.includes('power_of_attorney_supplier_switch_scope_missing') &&
    applications.includes('WEBSITE_POWER_OF_ATTORNEY_SCOPES'),
  'website POA scope validation is incomplete',
)
assert(
  poaWorkflow.includes('signed_scope_snapshot') &&
    authorizationChain.includes('signedScopes'),
  'downstream POA chain is not based on the exact signed scope snapshot',
)
assert(
  applications.includes('signed_scope_snapshot: scopes') &&
    applications.includes('exactScopesMatch') &&
    applications.includes('existingScopes.every') &&
    applications.includes('.limit(25)') &&
    applications.includes('validFrom: acceptedAt.slice(0, 10)') &&
    applications.includes('powerOfAttorneyCoverageFromScopes'),
  'website POA path can create or reuse authorization without exact signed evidence',
)
assert(
  tenantSync.includes("scope: 'supplier_switch'") &&
    tenantSync.includes('signed_scope_snapshot: scopes') &&
    tenantSync.includes('ensureAuthorizationDocumentFromPowerOfAttorney') &&
    tenantSync.includes('POWER_OF_ATTORNEY_REFERENCE_CONFLICT') &&
    tenantSync.includes("referenceKind: 'customer_document'") &&
    tenantSync.includes('powerOfAttorneyCoverageFromScopes'),
  'tenant sync POA path does not preserve the same signed authorization model',
)
assert(
  tenantSyncContract.includes('legal_acceptances') &&
    tenantSyncContract.includes('power_of_attorney'),
  'tenant sync contract does not publish legal acceptances and POA',
)
assert(
  publicContractModel.includes('legal_bundle_version_id') &&
    publicContractModel.includes('legal_versions'),
  'public contract model is not pinned to an exact legal bundle',
)
assert(
  materializer.includes('legal_bundle_version_id') &&
    materializer.includes('contract_price_snapshots'),
  'canonical materializer does not persist legal bundle/pricing evidence',
)
assert(
  publicLegal.includes('legal_bundle_versions') &&
    publicLegal.includes('legal_bundle_version_documents'),
  'public legal resolver is not driven by immutable legal bundle versions',
)
assert(
  publicLegalPage.includes('getPublicLegalDocument') &&
    publicLegalPage.includes('notFound()'),
  'public legal route does not use the canonical public legal resolver',
)

const websiteLegalBundle = openapi.components?.schemas?.WebsiteLegalBundle
assert(websiteLegalBundle, 'WebsiteLegalBundle is missing from website OpenAPI')
assert(
  websiteLegalBundle.properties?.requirements?.maxItems === 3,
  'website legal bundle must expose at most three customer-facing requirements',
)
assert(
  websiteLegalBundle.properties?.bundle_version,
  'website legal bundle does not expose bundle_version',
)
assert(
  openapi.components?.schemas?.CustomerApplicationRequest?.properties?.legal_acceptances,
  'website customer application does not publish legal_acceptances',
)
assert(
  openapi.components?.schemas?.CustomerApplicationRequest?.properties?.legal_bundle_version,
  'website customer application does not publish legal_bundle_version',
)
assert(
  customerPortalOpenapi.components?.schemas?.CustomerSyncRequest?.properties?.legal_acceptances,
  'customer sync does not publish legal_acceptances',
)
assert(
  customerPortalOpenapi.components?.schemas?.CustomerSyncRequest?.properties?.power_of_attorney,
  'customer sync does not publish power_of_attorney',
)

const offers = fixture?.data?.offers ?? fixture?.data?.contracts ?? []
assert(Array.isArray(offers) && offers.length > 0, 'public contract fixture is empty')
for (const offer of offers) {
  assert(offer.legal_bundle_version_id, 'fixture offer has no legal_bundle_version_id')
  assert(Array.isArray(offer.legal_versions) && offer.legal_versions.length > 0, 'fixture offer has no legal_versions')
}

console.log('customer legal package regression: ok')
