#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const failures = []
const warnings = []

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel))
}

function mustContain(rel, needle, label = needle) {
  if (!exists(rel)) {
    failures.push(`${rel} saknas`)
    return
  }
  const text = read(rel)
  if (!text.includes(needle)) failures.push(`${rel} saknar: ${label}`)
}

function mustNotContain(rel, needle, label = needle) {
  if (!exists(rel)) return
  const text = read(rel)
  if (text.includes(needle)) failures.push(`${rel} innehåller förbjudet mönster: ${label}`)
}

mustContain('lib/admin/guards.ts', 'requirePlatformAdminAccess')
mustContain('lib/admin/guards.ts', 'requirePlatformAdminActionAccess')
mustContain('lib/admin/guards.ts', 'isPlatformAdminContext')
mustContain('lib/admin/guards.ts', 'return input.roles.some')
mustNotContain('lib/admin/guards.ts', "input.permissions.includes('tenants.write')", 'platform access via tenants.write')
mustNotContain('lib/admin/guards.ts', "input.permissions.includes('roles.manage')", 'platform access via roles.manage')
mustNotContain('middleware.ts', "permissions.includes('tenants.write')", 'middleware platform access via tenants.write')
mustContain('app/dashboard/page.tsx', 'isPlatformAdmin ?')
mustContain('app/dashboard/page.tsx', 'href="/admin/company-settings"')
mustNotContain('app/dashboard/page.tsx', 'title="Admin Console"', 'company dashboard hardcoded Admin Console card')
mustNotContain('app/dashboard/page.tsx', 'title="Företag och användare"', 'company dashboard hardcoded company onboarding card')
mustNotContain('app/admin/company-settings/page.tsx', 'href={`/admin/companies/${companyId}`}', 'company settings link to platform company detail')
mustContain('app/admin/companies/actions.ts', 'parseCompanyAssignableRoleKey')
mustContain('middleware.ts', 'isPlatformAdminPath')
mustContain('middleware.ts', "pathname === '/admin/companies'")
mustContain('middleware.ts', "pathname === '/admin/users'")
mustContain('middleware.ts', "pathname === '/admin/roles'")
mustContain('middleware.ts', "pathname.startsWith('/admin/platform/')")
mustContain('supabase/migrations/20260520_batch_6e_hard_platform_roles_only.sql', "gridex_user_is_platform_admin")
mustContain('supabase/migrations/20260520_batch_6e_hard_platform_roles_only.sql', "r.key not in ('super_admin', 'superadmin', 'platform_admin')")
mustContain('supabase/migrations/20260520_batch_6e_hard_platform_roles_only.sql', "p.key in ('tenants.write', 'permissions.manage', 'roles.manage')")
mustContain('app/admin/companies/page.tsx', 'requirePlatformAdminAccess')
mustContain('app/admin/companies/actions.ts', 'requirePlatformAdminActionAccess')
mustContain('app/admin/companies/actions.ts', 'assertCanManageCompanyUsers')
mustNotContain('app/admin/companies/actions.ts', "requireAdminActionAccess({ anyOf: ['tenants.write', 'users.write'] })", 'tenants.write OR users.write på company governance')
mustContain('app/admin/users/page.tsx', 'requirePlatformAdminAccess')
mustContain('app/admin/users/actions.ts', 'requirePlatformAdminActionAccess')
mustContain('app/admin/users/[id]/page.tsx', 'requirePlatformAdminAccess')
mustContain('app/admin/users/[id]/actions.ts', 'requirePlatformAdminActionAccess')
mustContain('app/admin/roles/page.tsx', 'requirePlatformAdminAccess')
mustContain('components/admin/AdminSidebar.tsx', 'platformOnly?: boolean')
mustContain('components/admin/AdminSidebar.tsx', 'isPlatformAdmin')
mustContain('app/admin/page.tsx', 'isPlatformAdminContext')
mustContain('app/admin/page.tsx', "href=\"/admin/company-settings\"")
mustContain('lib/ediel/summary.ts', 'companyId?: string | null')
mustContain('app/admin/platform/ediel/rules/page.tsx', 'requirePlatformAdminAccess')
mustContain('app/admin/platform/ediel/versions/page.tsx', 'requirePlatformAdminAccess')
mustContain('app/admin/platform/ediel/routes/page.tsx', 'requirePlatformAdminAccess')

const reviewedServiceClientFiles = new Set([
  'app/admin/audit/page.tsx',
  'app/admin/billing/import/actions.ts',
  'app/admin/billing/import/page.tsx',
  'app/admin/customers/duplicates/actions.ts',
  'app/admin/platform/actor-testing/actions.ts',
  'app/admin/platform/go-live/[companyId]/route-wizard/actions.ts',
  'app/admin/platform/go-live/[companyId]/route-wizard/page.tsx',
  'app/admin/cis/actions.ts',
  'app/admin/companies/actions.ts',
  'app/admin/company-settings/actions.ts',
  'app/admin/contracts/actions.ts',
  'app/admin/customer-cases/actions.ts',
  'app/admin/customer-cases/page.tsx',
  'app/admin/customers/[id]/actions.ts',
  'app/admin/customers/[id]/document-actions.ts',
  'app/admin/customers/[id]/grid-owner-import-actions.ts',
  'app/admin/customers/[id]/profile-actions.ts',
  'app/admin/customers/[id]/switch-actions.ts',
  'app/admin/customers/[id]/switch-create-actions.ts',
  'app/admin/customers/actions.ts',
  'app/admin/customers/page.tsx',
  'app/admin/customers/segments/page.tsx',
  'app/admin/ediel/actions.ts',
  'app/admin/ediel/agt/actions.ts',
  'app/admin/operations/actions.ts',
  'app/admin/operations/control-actions.ts',
  'app/admin/outbound/unresolved/actions.ts',
  'app/admin/users/[id]/actions.ts',
  'app/admin/users/actions.ts',
])

const serviceClientFiles = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const rel = path.relative(root, full)
      const text = fs.readFileSync(full, 'utf8')
      if (text.includes('supabaseService') && rel.startsWith('app/admin/')) serviceClientFiles.push(rel)
    }
  }
}
walk(path.join(root, 'app'))

const unreviewedServiceClientFiles = serviceClientFiles
  .filter((rel) => !reviewedServiceClientFiles.has(rel))
  .sort((a, b) => a.localeCompare(b))
const removedReviewedServiceClientFiles = [...reviewedServiceClientFiles]
  .filter((rel) => !serviceClientFiles.includes(rel))
  .sort((a, b) => a.localeCompare(b))

if (unreviewedServiceClientFiles.length > 0) {
  failures.push(`Ogranskad supabaseService i app/admin: ${unreviewedServiceClientFiles.join(', ')}`)
}

if (removedReviewedServiceClientFiles.length > 0) {
  warnings.push(`Service-client review-listan innehåller filer som inte längre använder supabaseService: ${removedReviewedServiceClientFiles.join(', ')}`)
}

if (failures.length > 0) {
  console.error('RBAC audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  for (const warning of warnings) console.warn(`warning: ${warning}`)
  process.exit(1)
}

console.log(`RBAC audit passed: ${24 + warnings.length} checks, ${warnings.length} warning(s).`)
for (const warning of warnings) console.warn(`warning: ${warning}`)
