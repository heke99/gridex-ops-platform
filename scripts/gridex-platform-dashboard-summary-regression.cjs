#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/"/g, "'")
let failures = 0

function expect(condition, message) {
  if (!condition) {
    failures += 1
    console.error(`FAIL: ${message}`)
  } else {
    console.log(`OK: ${message}`)
  }
}

const adminPage = read('app/admin/page.tsx')
const platformSummary = read('lib/performance/platformDashboardSummary.ts')
const companySummaries = read('lib/performance/companySummaries.ts')
const edielSummary = read('lib/ediel/summary.ts')
const migration = read('supabase/migrations/20260826093000_platform_dashboard_and_rls_read_performance.sql')
const masterdataGuard = read('supabase/migrations/20260826103000_electricity_suppliers_masterdata_rls_guard.sql')

expect(
  platformSummary.includes("rpc('gridex_platform_dashboard_summary_v1')") &&
    platformSummary.includes("rpc('gridex_user_is_platform_admin')") &&
    platformSummary.includes('getVerifiedPlatformDashboardSummary'),
  'platform dashboard loader verifies platform admin before the service-role aggregate'
)

expect(
  migration.includes('grant execute on function public.gridex_platform_dashboard_summary_v1() to service_role') &&
    migration.includes('revoke all on function public.gridex_platform_dashboard_summary_v1() from public, anon, authenticated'),
  'platform dashboard aggregate execute is service_role-only'
)

expect(
  masterdataGuard.includes("drop policy if exists gridex_perf_authenticated_select_v1") &&
    masterdataGuard.includes('electricity_suppliers authenticated SELECT contains an unconditional permissive policy') &&
    masterdataGuard.includes('masterdata.read'),
  'electricity_suppliers masterdata SELECT gate is migration-asserted'
)

expect(
  companySummaries.includes('getVerifiedPlatformDashboardSummary(supabase)') &&
    companySummaries.includes("companyId: '__platform__'") &&
    companySummaries.includes('companiesTotal: platform.companiesTotal'),
  'null company dashboard scope reuses the verified platform aggregate including platform totals'
)

expect(
  edielSummary.includes('getVerifiedPlatformDashboardSummary(supabase)') &&
    edielSummary.includes('if (platform) return platform.ediel'),
  'null company Ediel summary reuses the verified platform aggregate'
)

expect(
  adminPage.includes('const summaryCompanyId = isPlatformAdmin ? null : companyId') ||
    adminPage.includes('const summaryCompanyId = isPlatformAdmin ? null : companyScope.companyId'),
  'admin dashboard uses platform-null summary scope for platform admins'
)

expect(
  adminPage.includes('getCompanyDashboardSummary(supabase, summaryCompanyId)') &&
    adminPage.includes('getEdielSummary(supabase, summaryCompanyId)') &&
    adminPage.includes("getActiveEdielActorSettings('production', companyId)"),
  'admin dashboard and Ediel summary share the platform-null summary scope while actor lookup keeps operational companyId'
)

expect(
  adminPage.includes('dashboardSummary.companiesTotal') &&
    adminPage.includes('dashboardSummary.gridOwnersTotal') &&
    adminPage.includes('dashboardSummary.electricitySuppliersTotal'),
  'admin dashboard reuses platform aggregate totals for companies, grid owners, and suppliers'
)

expect(
  !adminPage.includes('getCompanyDashboardSummary(supabase, companyId)') ||
    adminPage.includes('getCompanyDashboardSummary(supabase, summaryCompanyId)'),
  'admin dashboard does not bind the platform aggregate path to a selected tenant membership'
)

if (failures > 0) process.exit(1)
console.log('platform dashboard summary regression: OK')
