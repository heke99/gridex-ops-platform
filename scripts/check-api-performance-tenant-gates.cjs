const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const violations = []
function files(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...files(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

for (const file of files(path.join(root, 'app/api/v1'))) {
  const source = fs.readFileSync(file, 'utf8')
  if (/\.select\(\s*['"]\*['"]\s*\)/.test(source)) {
    violations.push(`${path.relative(root, file)} uses select('*')`)
  }
  if (/supabaseService/.test(source) && /\.from\(['"](?:customers|customer_sites|customer_invoices|customer_documents|customer_portal_identities)['"]\)/.test(source)) {
    if (!/company_id/.test(source)) violations.push(`${path.relative(root, file)} accesses tenant data without an explicit company_id guard`)
  }
}

const resolver = fs.readFileSync(path.join(root, 'lib/customer-portal/customerResolver.ts'), 'utf8')
if (/from\('customer_profiles'\)[\s\S]{0,300}\.eq\('email'/.test(resolver) && !/from\('customer_profiles'\)[\s\S]{0,250}\.eq\('company_id'/.test(resolver)) {
  violations.push('customer profile email lookup is not tenant-bound')
}

const apiData = fs.readFileSync(path.join(root, 'lib/customer-portal/apiData.ts'), 'utf8')
for (const forbidden of ['raw_payload', 'storage_bucket', 'file_path', 'fullmakt_snapshot']) {
  const publicSelect = new RegExp(`const (?:DOCUMENT|AUTH_DOCUMENT|POA|WEBSITE_APPLICATION)[A-Z_]*SELECT[^\\n]*${forbidden}`)
  if (publicSelect.test(apiData)) violations.push(`public customer DTO exposes ${forbidden}`)
}

if (violations.length) {
  console.error('API performance/tenant gates failed:\n' + violations.map((v) => `- ${v}`).join('\n'))
  process.exit(1)
}
console.log('API performance/tenant gates OK.')
