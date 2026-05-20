import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const checks = []
const warnings = []

function addCheck(name, ok, details) {
  checks.push({ name, ok, details })
}

function addWarning(name, details) {
  warnings.push({ name, details })
}

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function walk(dir, files = []) {
  const full = join(root, dir)
  if (!existsSync(full)) return files
  for (const item of readdirSync(full)) {
    const path = join(full, item)
    const rel = path.slice(root.length + 1)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(rel, files)
    else files.push(rel)
  }
  return files
}

for (const file of ['app/admin/users/actions.ts', 'app/admin/users/[id]/actions.ts']) {
  const source = read(file)
  addCheck(
    `${file}: global user actions use platform guard`,
    source.includes('requirePlatformAdminActionAccess') && !source.includes('requireAdminActionAccess('),
    'Global user/role/permission mutations must not be reachable through users.write alone.'
  )
}

for (const route of [
  'app/admin/platform/ediel/rules/page.tsx',
  'app/admin/platform/ediel/versions/page.tsx',
  'app/admin/platform/ediel/routes/page.tsx',
  'app/admin/platform/security/page.tsx',
]) {
  addCheck(`${route}: route exists`, existsSync(join(root, route)), 'Required platform-only route.')
  if (existsSync(join(root, route))) {
    addCheck(
      `${route}: requires platform admin`,
      read(route).includes('requirePlatformAdminAccess'),
      'Platform routes must not use generic permission-only guards.'
    )
  }
}

const companySettingsPage = read('app/admin/company-settings/page.tsx')
for (const field of [
  'billing_contact_email',
  'support_email',
  'address_line_1',
  'address_line_2',
  'postal_code',
  'city',
  'country_code',
  'ediel_id',
  'actor_role',
  'sender_sub_address',
  'ediel_mailbox',
  'operating_environment',
]) {
  addCheck(`company settings field: ${field}`, companySettingsPage.includes(`name="${field}"`), 'Company settings must include the full Batch 6E field set.')
}

const companyActions = read('app/admin/company-settings/actions.ts')
addCheck(
  'company settings action uses company-scoped guard',
  companyActions.includes('requireCompanyScopedActionAccess'),
  'Company admins may only update their own company.'
)

const companiesPage = read('app/admin/companies/page.tsx')
addCheck(
  'admin/companies cards are responsive',
  companiesPage.includes('xl:grid-cols-2 2xl:grid-cols-3') && companiesPage.includes('overflow-hidden') && companiesPage.includes('break-all'),
  'Company cards must not overflow with long company names, ids or action forms.'
)

const adminFiles = walk('app/admin').filter((file) => /\.(ts|tsx)$/.test(file))
const riskyServiceClientFiles = adminFiles.filter((file) => {
  const source = read(file)
  return source.includes('supabaseService') && !source.includes('requirePlatformAdmin') && !source.includes('requireCompanyScoped') && !source.includes('requireOperationalCompany')
})
if (riskyServiceClientFiles.length > 0) {
  addWarning(
    'service-client tenant-scope manual review',
    `Files using service client without an obvious guard marker should be reviewed in the tenant-isolation pass: ${riskyServiceClientFiles.join(', ')}`
  )
}

const failed = checks.filter((check) => !check.ok)
for (const check of checks) {
  const prefix = check.ok ? 'PASS' : 'FAIL'
  console.log(`${prefix} ${check.name} — ${check.details}`)
}

for (const warning of warnings) {
  console.log(`WARN ${warning.name} — ${warning.details}`)
}

if (failed.length > 0) {
  console.error(`\nRBAC audit failed: ${failed.length} check(s).`)
  process.exit(1)
}

console.log(`\nRBAC audit passed: ${checks.length} checks${warnings.length ? `, ${warnings.length} warning(s)` : ''}.`)
