#!/usr/bin/env node
// Records the verified production release receipt of the deployment this workflow just made
// READY (FINDINGS F89/F91: canonical_record_platform_release_receipt had no caller, so the
// scoped Ediel production gate could never find a receipt for the running release SHA).
//
// Every field is observed, never assumed:
//  - release SHA = the checked-out commit (git HEAD) = GITHUB_SHA = the Vercel deployment's own
//    githubCommitSha, and the deployment is READY with target production;
//  - CI run = this GitHub Actions run/attempt; deployment = the Vercel deployment id;
//  - schema version and fingerprint = the production database's platform_runtime_readiness,
//    which must be is_ready; migration manifest, generated types and OpenAPI hashes = the
//    exact files of this commit.
// Tenant reconciliation and performance evidence are not captured here and say so.
// Usage (CI): RELEASE_SHA, CI_RUN_ID, DEPLOYMENT_ID, VERCEL_TOKEN, VERCEL_TEAM_ID,
//   GRIDEX_PRODUCTION_SUPABASE_URL, GRIDEX_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const env = name => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`release_receipt_input_missing:${name}`)
  return value
}
const sha256 = value => createHash('sha256').update(value).digest('hex')
const fileManifest = (dir, filter) => readdirSync(resolve(dir)).filter(filter).sort()
  .map(name => `${name}\t${sha256(readFileSync(resolve(dir, name)))}`).join('\n')

const releaseSha = env('RELEASE_SHA')
if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error('release_receipt_sha_invalid')
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (head !== releaseSha) throw new Error('release_receipt_checkout_mismatch')

const deploymentId = env('DEPLOYMENT_ID')
const deployment = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}?teamId=${encodeURIComponent(env('VERCEL_TEAM_ID'))}`,
  { headers: { Authorization: `Bearer ${env('VERCEL_TOKEN')}` } }).then(async response => {
  if (!response.ok) throw new Error(`release_receipt_deployment_read_failed:${response.status}`)
  return response.json()
})
if ((deployment.readyState ?? deployment.state) !== 'READY' || deployment.target !== 'production' || deployment.meta?.githubCommitSha !== releaseSha) {
  throw new Error('release_receipt_deployment_identity_mismatch')
}

const supabaseUrl = env('GRIDEX_PRODUCTION_SUPABASE_URL').replace(/\/$/, '')
const serviceKey = env('GRIDEX_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY')
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
const [runtime] = await fetch(`${supabaseUrl}/rest/v1/platform_runtime_readiness?select=migration_version,schema_fingerprint,is_ready&id=eq.true`, { headers })
  .then(async response => { if (!response.ok) throw new Error(`release_receipt_runtime_read_failed:${response.status}`); return response.json() })
if (runtime?.is_ready !== true || !/^[0-9]{14}$/.test(runtime.migration_version ?? '') || !/^[a-f0-9]{64}$/.test(runtime.schema_fingerprint ?? '')) {
  throw new Error('release_receipt_database_runtime_not_ready')
}

const migrations = fileManifest('supabase/migrations', name => name.endsWith('.sql'))
const latestRepoMigration = migrations.split('\n').map(line => line.slice(0, 14)).filter(v => /^[0-9]{14}$/.test(v)).sort().at(-1) ?? null
const openapiReleases = readdirSync(resolve('docs/openapi/releases')).filter(name => /^\d{4}-\d{2}-\d{2}\.\d+$/.test(name)).sort()
const notCaptured = { status: 'not_captured', reason: 'release identity receipt only; tenant reconciliation and performance are separate gates' }
const response = await fetch(`${supabaseUrl}/rest/v1/rpc/canonical_record_platform_release_receipt`, { method: 'POST', headers, body: JSON.stringify({
  p_release_sha: releaseSha, p_ci_run_id: env('CI_RUN_ID'), p_deployment_id: deploymentId, p_environment: 'production',
  p_schema_migration_version: runtime.migration_version, p_migration_manifest_hash: sha256(migrations),
  p_database_schema_fingerprint: runtime.schema_fingerprint, p_generated_types_hash: sha256(readFileSync(resolve('supabase/database.types.ts'))),
  p_openapi_contract_version: openapiReleases.at(-1) ?? 'unreleased', p_openapi_hash: sha256(fileManifest('docs/openapi', name => name.endsWith('.json'))),
  p_reconciliation_result: notCaptured, p_performance_evidence: notCaptured,
  p_evidence: { recordedBy: 'vercel-production-deploy', checks: ['git_head_is_release_sha', 'vercel_deployment_ready_production_same_sha', 'database_runtime_readiness_ready'],
    latestRepoMigration, databaseMigrationVersion: runtime.migration_version },
}) })
if (!response.ok) throw new Error(`release_receipt_record_failed:${response.status}`)
console.log(`Recorded verified production release receipt ${await response.json()} for ${releaseSha} (${deploymentId}).`)
