const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
const read = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}
const assertIncludes = (file, snippets) => {
  const source = read(file)
  for (const snippet of snippets) {
    if (!source.includes(snippet)) {
      throw new Error(`${file} saknar förväntat kontrakt: ${snippet}`)
    }
  }
}
const assertExcludes = (file, snippets) => {
  const source = read(file)
  for (const snippet of snippets) {
    if (source.includes(snippet)) {
      throw new Error(`${file} innehåller förbjudet legacy-kontrakt: ${snippet}`)
    }
  }
}

const migration = 'supabase/migrations/20260716183000_contract_canonical_finalization.sql'
assertIncludes(migration, [
  'general_consumer_terms',
  'general_business_terms',
  'quarterly_price_terms',
  'production_terms',
  'create or replace function public.gridex_materialize_legal_bundle_version',
  'create or replace function public.gridex_publish_contract_version',
  'create or replace function public.gridex_bind_internal_customer_contract',
  'create or replace function public.gridex_contract_platform_readiness',
  'customer_contract_documents',
  'customer-contract-documents',
  'power_of_attorney_required',
  'facility_id_required',
  'completion_reminder',
  'manual_review',
  'revoke insert,update,delete on public.legal_text_versions',
  'revoke insert,update,delete on public.legal_bundles',
])

assertIncludes('lib/legal/publicLegalDocuments.ts', [
  'from("legal_bundle_version_documents")',
  'from("legal_bundle_versions")',
  'content_sha256',
  'immutable: true',
  'loadLegacyPublishedVersion',
])
assertIncludes('lib/website/publicContracts.ts', [
  'module_versions',
  'required_modules',
  'selectLegalVersionForAcceptance',
  'legal_bundle_version_documents',
  'content_sha256',
])
assertIncludes('lib/website/customerApplications.ts', [
  'legal_bundle_version_documents',
  'gridex_create_website_customer_contract',
  'offer_legal_bundle_unavailable',
  'selectLegalVersionForAcceptance',
])
assertIncludes('lib/customer-contracts/documents.ts', [
  'signed-contract-',
  'sha256',
  'customer-contract-documents',
  'downloadAndVerifyCustomerContractDocument',
])
assertIncludes('app/api/admin/customer-contract-documents/[documentId]/route.ts', [
  'downloadAndVerifyCustomerContractDocument',
  'new Uint8Array(pdf)',
])
assertIncludes('app/admin/website-applications/actions.ts', [
  'gridex_create_website_customer_contract',
  'public_contract_offer_id',
  'offer_reference',
])
assertExcludes('app/admin/website-applications/actions.ts', [
  'terms_version: "v1"',
  'price_version: "v1"',
])
assertExcludes('app/admin/companies/[id]/legal-actions.ts', [
  '.from("legal_text_versions").insert',
  ".from('legal_text_versions').insert",
  '.from("legal_bundles").insert',
])
assertExcludes('app/admin/platform/legal-templates/actions.ts', [
  'platform_default_legal_templates").insert',
  "platform_default_legal_templates').insert",
])
assertIncludes('lib/email/emailTemplates.ts', [
  'power_of_attorney_required',
  'facility_id_required',
  'customer_information_required',
  'completion_reminder',
  'rejected',
  'manual_review',
])
assertIncludes('lib/opsMaster/readiness.ts', [
  'canonical_tenant_legal_overrides_v',
])

console.log('Canonical contract/legal/pricing/PDF/tenant finalization regression passed.')
