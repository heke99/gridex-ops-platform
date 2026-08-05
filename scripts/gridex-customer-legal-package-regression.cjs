#!/usr/bin/env node
const fs = require('node:fs')

function read(path) {
  return fs.readFileSync(path, 'utf8')
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const packageSource = read('lib/legal/customerDocumentPackage.ts')
const applications = read('lib/website/customerApplications.ts')
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
  read('docs/fixtures/public-contracts-response-2026-08-05.2.json'),
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
    tenantSync.includes('legacy_schema_fallback: true') &&
    tenantSync.includes("status: 'draft'") &&
    tenantSync.includes('POWER_OF_ATTORNEY_PERSISTENCE_FAILED') &&
    tenantSync.includes('LEGAL_ACCEPTANCE_SCHEMA_MISMATCH'),
  'customer sync POA path is not consistent with website POA and supplier-switch authorization',
)
assert(
  packageSource.includes('customerLegalAcceptanceCategoryForModule') &&
    publicContracts.includes('customerLegalAcceptanceCategoryForModule(moduleKey)'),
  'website and customer portal do not share the same canonical module-to-evidence mapping',
)
assert(
  tenantSync.includes('sourceRows.map(resolvedLegalModule)') &&
    tenantSync.includes('missingModules.map') &&
    tenantSync.includes('grouped_source_document_count') &&
    tenantSync.includes('accepted_document') &&
    tenantSync.includes("legal_reference_kind: legalDocument.referenceKind"),
  'customer sync does not expand each grouped acceptance back to every immutable source module',
)
assert(
  tenantSync.includes('LEGAL_ACCEPTANCE_DUPLICATE') &&
    tenantSync.includes('LEGAL_ACCEPTANCE_FORMAT_MIXED') &&
    tenantSync.includes('acceptanceReferenceKinds.size > 1'),
  'customer sync does not reject duplicate or mixed grouped/legacy acceptance payloads before writes',
)
assert(
  tenantSync.includes("signed: externallySendable && persistedAsSigned") &&
    tenantSync.includes('if (poaResult.signed)') &&
    !tenantSync.includes("if (poaResult !== 'skipped')"),
  'customer sync can emit power_of_attorney.signed for a fail-closed draft POA',
)
assert(
  poaWorkflow.includes('existingSignedScopes.some') &&
    poaWorkflow.includes('redan skapade behörighetens signerade scope-snapshot'),
  'authorization scope reuse does not reject a different signed scope snapshot',
)
assert(
  tenantSyncContract.includes('signer_identity_number') &&
    tenantSyncContract.includes('facility_information_lookup') &&
    tenantSyncContract.includes("Fullmakten måste uttryckligen innehålla supplier_switch"),
  'customer sync POA request validation is incomplete',
)
assert(
  materializer.includes('tenant_legal_profiles') &&
    materializer.includes('tenant_legal_profile_snapshot') &&
    materializer.includes('tenant_legal_profile_sha256'),
  'legal materializer does not preserve tenant identity snapshot and hash',
)
assert(
  publicLegal.includes('loadCustomerBundleDocument') &&
    publicLegal.includes('canonical_customer_document_package'),
  'public legal route cannot render grouped immutable documents',
)
assert(
  publicLegal.includes('tenant_legal_profile_snapshot') &&
    publicLegal.includes('companyFromTenantLegalSnapshot'),
  'public legal page header is not bound to the immutable tenant legal profile snapshot',
)
assert(
  publicContractModel.includes('suppliedCustomerDocuments') &&
    publicContractModel.includes('nullableLegalDocumentUrl'),
  'explicit public DTO serialization drops validated grouped document URLs',
)
assert(
  publicLegalPage.includes('if (!Array.isArray(raw)) return []') &&
    !publicLegalPage.includes('Product default: a single power of attorney'),
  'public POA view invents scopes that were not signed',
)

const schemas = openapi.components?.schemas ?? {}
const customerDocument = schemas.CustomerLegalDocument
assert(customerDocument?.additionalProperties === false, 'CustomerLegalDocument is not closed')
assert(
  JSON.stringify(customerDocument?.properties?.requirement_code?.enum) ===
    JSON.stringify(['agreement', 'power_of_attorney', 'withdrawal']),
  'OpenAPI customer document enum is wrong',
)
assert(
  schemas.WebsiteLegalBundle?.properties?.requirements?.maxItems === 3,
  'OpenAPI does not cap customer requirements at three',
)
assert(
  schemas.WebsiteLegalBlock?.required?.includes('customer_documents'),
  'public contract legal block does not require customer_documents',
)
const portalSchemas = customerPortalOpenapi.components?.schemas ?? {}
const portalPoa = portalSchemas.CustomerSyncRequest?.properties?.power_of_attorney
assert(
  portalPoa?.properties?.scope?.maxItems === 2 &&
    portalPoa?.properties?.scope?.contains?.const === 'supplier_switch',
  'Customer Portal OpenAPI does not enforce the exact supported POA scope set',
)
for (const field of ['signer_name', 'signer_identity_number', 'method']) {
  assert(
    portalPoa?.properties?.[field],
    `Customer Portal OpenAPI is missing POA evidence field ${field}`,
  )
}

for (const contract of fixture.data ?? []) {
  assert(
    Array.isArray(contract.legal?.customer_documents) &&
      contract.legal.customer_documents.length >= 1 &&
      contract.legal.customer_documents.length <= 3,
    'public contract fixture does not expose the grouped customer documents',
  )
}

console.log('Customer legal package, tenant snapshot and POA chain regression passed.')
