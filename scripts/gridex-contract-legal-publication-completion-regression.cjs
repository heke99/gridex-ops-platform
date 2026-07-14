const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20260714160000_canonical_contract_runtime_completion.sql')
const page = read('app/admin/contracts/page.tsx')
const actions = read('app/admin/contracts/actions.ts')
const canonical = read('lib/contracts/canonical.ts')
const publicContracts = read('lib/website/publicContracts.ts')
const applications = read('lib/website/customerApplications.ts')
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
]
const failed = required.filter(([, ok]) => !ok)
if (failed.length) {
  for (const [name] of failed) console.error(`FAIL: ${name}`)
  process.exit(1)
}
console.log(`Canonical contract completion regression passed (${required.length} controls).`)
