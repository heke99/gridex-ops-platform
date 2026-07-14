const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260714130000_canonical_contract_legal_publication_model.sql'), 'utf8')
const publicContracts = fs.readFileSync(path.join(root, 'lib/website/publicContracts.ts'), 'utf8')
const application = fs.readFileSync(path.join(root, 'lib/website/customerApplications.ts'), 'utf8')

const requiredTables = [
  'contract_products', 'contract_product_versions', 'tenant_contract_assignments', 'tenant_contract_channels',
  'legal_templates', 'legal_template_versions', 'tenant_legal_profiles', 'tenant_legal_overrides',
  'legal_bundle_versions', 'legal_bundle_version_documents', 'contract_publications', 'contract_publication_versions',
  'customer_contract_acceptances', 'customer_contract_evidence', 'customer_contract_documents',
]
for (const table of requiredTables) {
  if (!migration.includes(`public.${table}`)) throw new Error(`Missing canonical table: ${table}`)
}
for (const guard of ['signed_customer_contract_immutable', 'immutable_version_locked', 'immutable_evidence']) {
  if (!migration.includes(guard)) throw new Error(`Missing immutability guard: ${guard}`)
}
for (const binding of ['publication_version_id', 'legal_bundle_version_id', 'legal_document_versions', 'price_book_id', "channel: 'website'", 'valid_from', 'valid_to']) {
  if (!publicContracts.includes(binding)) throw new Error(`offer_reference does not bind ${binding}`)
}
if (!application.includes("offer_reference_mismatch")) throw new Error('Application flow must fail closed on offer_reference mismatch')
if (!application.includes('loadOfferBoundLegalVersions')) throw new Error('Application flow must load offer-bound legal versions')
console.log('Canonical contract/legal/publication regression: OK')
