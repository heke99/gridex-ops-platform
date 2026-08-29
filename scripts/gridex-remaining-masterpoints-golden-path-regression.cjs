'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const migration = path.join(root, 'supabase/migrations/20260811080000_remaining_masterpoint_convergence.sql')

if (!fs.existsSync(migration)) {
  throw new Error(`missing remediation migration: ${path.relative(root, migration)}`)
}

const sql = fs.readFileSync(migration, 'utf8')
const requiredFragments = [
  'review_owner text',
  'review_priority text',
  'review_sla_due_at timestamptz',
  'create or replace function public.anonymize_user_account',
  "delete from public.user_roles where user_id = $1",
  "delete from public.user_permission_overrides where user_id = $1",
  "delete from auth.sessions where user_id = $1",
  'create or replace function public.gridex_canonicalize_company_org_number',
  'companies_canonical_org_number',
  'migration_manifest_hash text',
  'database_schema_fingerprint text',
  'generated_types_hash text',
  'openapi_contract_version text',
  'openapi_hash text',
  'reconciliation_result jsonb',
  'performance_evidence jsonb',
  'role-without-auth-identity',
  'duplicate-active-membership',
  'duplicate-active-role',
  'accepted-invite-without-access',
  'stuck-provisioning',
  'manual-review-without-owner-or-sla',
  'contract-missing-customer-or-site',
  'contract-without-metering-point',
  'switch-without-contract',
  'ediel-live-without-valid-tenant',
  'invalid-tenant-lifecycle-projection',
  'deprecated-canonical-event-bus-backlog',
  'due-stranded-event-outbox',
]

for (const fragment of requiredFragments) {
  if (!sql.includes(fragment)) {
    throw new Error(`remaining-masterpoints migration is missing required fragment: ${fragment}`)
  }
}

const forbiddenFragments = [
  'create table public.platform_release_receipts',
  'create table public.company_memberships',
  'create table public.user_roles',
]
for (const fragment of forbiddenFragments) {
  if (sql.toLowerCase().includes(fragment)) {
    throw new Error(`migration creates a parallel canonical owner instead of extending the existing one: ${fragment}`)
  }
}

const regressions = [
  'gridex-canonical-architecture-57-point-regression.cjs',
  'gridex-ops-post-108-health-residuals-regression.cjs',
  'canonical-production-hardening-regression.cjs',
  'gridex-website-application-ops-chain-regression.cjs',
  'gridex-customer-application-continuation-regression.cjs',
  'gridex-customer-application-review-regression.cjs',
  'gridex-website-facility-intake-regression.cjs',
  'gridex-canonical-finalization-regression.cjs',
  'gridex-ops-continuation-hardening-regression.cjs',
  'gridex-website-api-power-of-attorney-regression.cjs',
]

for (const script of regressions) {
  const scriptPath = path.join(__dirname, script)
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`required existing regression is missing: scripts/${script}`)
  }

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(`existing regression failed in integrated golden path: scripts/${script}`)
  }
}

console.log('GRIDEX REMAINING MASTERPOINTS GOLDEN PATH: PASS')
