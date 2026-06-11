#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const suite = process.argv[2] || 'launch-smoke'
const failures = []

function fail(message) {
  failures.push(message)
}

function exists(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required file: ${relativePath}`)
}

function walk(dir, out = []) {
  const absolute = path.join(root, dir)
  if (!fs.existsSync(absolute)) return out
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue
    const relative = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(relative, out)
    else if (/\.(ts|tsx|js|jsx|cjs|mjs)$/.test(entry.name)) out.push(relative)
  }
  return out
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function scanFiles(files, pattern, message, allow = () => false) {
  for (const file of files) {
    if (allow(file)) continue
    const content = read(file)
    if (pattern.test(content)) fail(`${message}: ${file}`)
  }
}

const sourceFiles = [...walk('app'), ...walk('lib'), ...walk('scripts')]
const appLibFiles = sourceFiles.filter((file) => file.startsWith('app/') || file.startsWith('lib/'))

const requiredFiles = [
  'lib/launch/readiness.ts',
  'app/admin/external-contract-intakes/page.tsx',
  'app/admin/ediel/routes/page.tsx',
  'app/admin/ediel/route-readiness/page.tsx',
  'app/admin/ediel/route-readiness/actions.ts',
  'app/api/admin/ediel/route-readiness/export/route.ts',
  'app/admin/system-health/page.tsx',
  'supabase/migrations/20260611150000_launch_readiness_security_routes_stats.sql',
  'supabase/migrations/20260611170000_launch_readiness_completion_db_warnings_retention_bulk.sql',
  'app/api/admin/ediel/supplier-contacts/export/route.ts',
]
requiredFiles.forEach(exists)

scanFiles(appLibFiles, /\.from\(['"]api_keys['"]\)/, 'Legacy api_keys table access remains')
scanFiles(appLibFiles, /\.from\(['"]api_audit_logs['"]\)/, 'Legacy api_audit_logs table access remains')
scanFiles(appLibFiles, /\.from\(['"]customer_applications['"]\)/, 'Legacy customer_applications table access remains')
scanFiles(appLibFiles, /\.from\(['"]webhook_events['"]\)/, 'Legacy webhook_events table access remains')
scanFiles(appLibFiles, /\.from\(['"]webhook_endpoints['"]\)/, 'Legacy webhook_endpoints table access remains')
scanFiles(appLibFiles, /\.from\(['"]contracts['"]\)/, 'Legacy contracts table access remains')
scanFiles(appLibFiles, /customer_sites\.price_area(?!_code)/, 'Invalid customer_sites.price_area reference remains')
scanFiles(appLibFiles, /platform_actor_roles[\s\S]{0,180}role_key/, 'platform_actor_roles.role_key mismatch remains')
scanFiles(appLibFiles, /ediel_business_errors[\s\S]{0,180}severity/, 'ediel_business_errors.severity assumption remains')

if (fs.existsSync(path.join(root, 'app/admin/ediel/routes/page.tsx'))) {
  const routePage = read('app/admin/ediel/routes/page.tsx')
  if (!routePage.includes("from('platform_actor_routes')")) fail('/admin/ediel/routes is not backed by platform_actor_routes')
  if (!routePage.includes("from('platform_actor_roles')")) fail('/admin/ediel/routes is not backed by platform_actor_roles')
  if (routePage.includes("from('communication_routes')")) fail('/admin/ediel/routes still uses legacy communication_routes')
  if (!routePage.includes('actor_role')) fail('/admin/ediel/routes does not use actor_role')
}

if (fs.existsSync(path.join(root, 'app/admin/ediel/route-readiness/page.tsx'))) {
  const page = read('app/admin/ediel/route-readiness/page.tsx')
  if (!page.includes("from('gridex_route_readiness_v')")) fail('Route-readiness page is not backed by gridex_route_readiness_v')
  if (!page.includes('ready_verified_manual_send')) fail('Route-readiness page misses manual-send ready state')
  if (!page.includes('ready_auto_send_allowed')) fail('Route-readiness page misses auto-send ready state')
  if (!page.includes('bulkRouteReadinessByStatusAction')) fail('Route-readiness page misses bulk actions')
  if (!page.includes('importSupplierContactsCsvAction')) fail('Route-readiness page misses supplier contact CSV import')
  if (!page.includes('/api/admin/ediel/supplier-contacts/export')) fail('Route-readiness page misses supplier contact CSV export')
}

if (fs.existsSync(path.join(root, 'lib/admin/websiteIntegrationOps.ts'))) {
  const content = read('lib/admin/websiteIntegrationOps.ts')
  if (!content.includes("from('external_contract_intakes')")) fail('Website application admin listing does not read external_contract_intakes')
  if (!content.includes('listLegacyWebsiteApplications')) fail('Legacy application fallback was removed instead of safely bridged')
}

if (fs.existsSync(path.join(root, 'lib/website/customerApplications.ts'))) {
  const content = read('lib/website/customerApplications.ts')
  if (!content.includes('syncExternalContractIntakeRow')) fail('Website intake flow does not sync external_contract_intakes')
  if (!content.includes("from('external_contract_intakes')")) fail('Website intake flow does not write external_contract_intakes')
}

if (fs.existsSync(path.join(root, 'supabase/migrations/20260611150000_launch_readiness_security_routes_stats.sql'))) {
  const migration = read('supabase/migrations/20260611150000_launch_readiness_security_routes_stats.sql')
  const requiredSql = [
    'alter table public.admin_users enable row level security',
    'revoke all on table public.admin_users from anon',
    'gridex_audit_admin_users_change',
    'security_invoker = true',
    'platform_actor_contacts',
    'gridex_route_readiness_v',
    'gridex_company_operations_statistics_v',
    'gridex_launch_error_summary_v',
    'external_contract_intakes',
    'integration_api_clients',
    'domain_events',
    'event_outbox',
    'webhook_deliveries',
  ]
  for (const needle of requiredSql) {
    if (!migration.includes(needle)) fail(`Launch migration missing: ${needle}`)
  }
  if (/auto_send_allowed\s*=\s*true/i.test(migration)) fail('Migration must not enable auto_send_allowed automatically')
}

if (fs.existsSync(path.join(root, 'supabase/migrations/20260611170000_launch_readiness_completion_db_warnings_retention_bulk.sql'))) {
  const completionMigration = read('supabase/migrations/20260611170000_launch_readiness_completion_db_warnings_retention_bulk.sql')
  const requiredCompletionSql = [
    'integration_api_rate_limit_events',
    'platform_actor_contact_import_runs',
    'gridex_launch_db_security_warnings_v',
    'gridex_company_launch_blocker_reasons_v',
    'gridex_billing_launch_readiness_v',
    'gridex_data_retention_policies',
    'gridex_run_launch_retention_cleanup',
    'revoke all on function',
    'revoke all on table',
  ]
  for (const needle of requiredCompletionSql) {
    if (!completionMigration.includes(needle)) fail(`Launch completion migration missing: ${needle}`)
  }
  if (/auto_send_allowed\s*=\s*true/i.test(completionMigration)) fail('Launch completion migration must not enable auto_send_allowed automatically')
}

if (fs.existsSync(path.join(root, 'lib/integrations/apiAuth.ts'))) {
  const apiAuth = read('lib/integrations/apiAuth.ts')
  if (!apiAuth.includes('rate_limited')) fail('API auth does not normalize rate limit errors')
  if (!apiAuth.includes('integration_api_rate_limit_events')) fail('API auth does not log rate limit events')
  if (!apiAuth.includes('Tjänsten svarar långsamt just nu')) fail('API auth still lacks human rate-limit text')
}

const packageJson = JSON.parse(read('package.json'))
const expectedScripts = [
  'gridex:launch-security-regression',
  'gridex:db-ui-compatibility-regression',
  'gridex:website-api-webhook-regression',
  'gridex:external-contract-intake-regression',
  'gridex:company-statistics-regression',
  'gridex:pricing-flow-regression',
  'gridex:billing-readiness-regression',
  'gridex:route-readiness-regression',
  'gridex:supplier-contact-regression',
  'gridex:customer-intake-regression',
  'gridex:ui-db-mismatch-regression',
  'gridex:rate-limit-regression',
  'gridex:system-health-regression',
  'gridex:launch-smoke',
]
for (const script of expectedScripts) {
  if (!packageJson.scripts || !packageJson.scripts[script]) fail(`Missing package script: ${script}`)
}

if (failures.length) {
  console.error(`Gridex launch regression failed for ${suite}:`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Gridex launch regression passed: ${suite}`)
