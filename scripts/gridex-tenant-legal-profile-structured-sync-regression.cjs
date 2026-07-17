const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const migration = read('supabase/migrations/20260717160000_tenant_legal_profile_structured_sync.sql')
const companyPage = read('app/admin/companies/[id]/page.tsx')
const companyAction = read('app/admin/companies/[id]/company-profile-actions.ts')
const contractAction = read('app/admin/contracts/actions.ts')
const contractPage = read('app/admin/contracts/page.tsx')
const component = read('components/admin/legal/TenantLegalProfileForm.tsx')
const governance = read('lib/tenant/governance.ts')

for (const token of [
  'gridex_jsonb_valid_email',
  'gridex_legal_contact_complete',
  'gridex_billing_information_complete',
  'gridex_dispute_information_complete',
  'address_line_1',
  'postal_code',
  'gridex_upsert_company_legal_profile_defaults',
]) assert(migration.includes(token), `Migration missing ${token}`)

assert(companyPage.includes('href="#tenant-legal-profile"'), 'Superadmin legal link must remain on company card')
assert(companyPage.includes('getTenantLegalProfile(row.id)'), 'Company card must load the legal profile')
assert(companyPage.includes('<TenantLegalProfileForm'), 'Company card must render the legal profile editor')
assert(!companyPage.includes('/admin/contracts?company_id=${company.id}#tenant-legal-profile'), 'Broken cross-page legal link remains')

for (const field of ['address_line_1', 'address_line_2', 'postal_code', 'city', 'country_code', 'billing_contact_email']) {
  assert(companyPage.includes(`name="${field}"`), `Company editor missing ${field}`)
  assert(companyAction.includes(`${field}:`), `Company action missing ${field}`)
  assert(governance.includes(`${field}: string | null`), `Governance type missing ${field}`)
}

for (const field of [
  '${prefix}_line_1',
  '${prefix}_postal_code',
  '${prefix}_city',
  '${prefix}_email',
  'billing_email',
  'dispute_authority',
]) assert(component.includes(field), `Structured legal form missing ${field}`)

assert(contractAction.includes('buildStructuredAddress'), 'Legal action does not build structured addresses')
assert(contractAction.includes('buildStructuredContact'), 'Legal action does not build structured contacts')
assert(contractAction.includes('verified_by: actor.userId'), 'Complete profile is not explicitly verified')
assert(contractAction.includes('revalidatePath(`/admin/companies/${companyId}`)'), 'Company card cache is not revalidated')
assert(contractAction.includes('redirectLegalProfileBack'), 'Selected company redirect is not preserved')
assert(contractPage.includes('<TenantLegalProfileForm'), 'Tenant contracts page is not using the shared structured form')

console.log('Tenant legal profile structured sync regression passed')
