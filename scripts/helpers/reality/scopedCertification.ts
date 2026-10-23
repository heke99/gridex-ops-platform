// World stand-in for the production deploy pipeline's release receipt (FINDINGS F89/F90/F91).
//
// Owner decision 2026-10-23 ("Automatiska bevis"): the product now records the per-scope
// production proof itself, from the tenant's own company certification, in the Ediel outbox
// cron (lib/ediel/companyCertifiedScopes.ts -> ediel_record_company_certified_scopes_v1). The
// world therefore no longer writes capability rows, rebinds certification rows or records
// proofs: it exercises that real job through the outbox cron.
//
// What remains simulated is what the world has no equivalent for: the CI/deploy pipeline. In
// production, .github/workflows/vercel-production-deploy.yml records the verified release
// receipt of the deployment it made READY (scripts/record-production-release-receipt.mjs). The
// world's app runs a local build of GIT_COMMIT_SHA with no CI run or Vercel deployment, so this
// records that receipt once per SHA, through the same canonical writer, marked as simulated.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { supabaseService } from '@/lib/supabase/service'
import { sql } from '../live-chain-fixture'

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

function releaseSha(): string {
  const git = process.env.GIT_COMMIT_SHA, vercel = process.env.VERCEL_GIT_COMMIT_SHA
  if (!git || !/^[0-9a-f]{40}$/.test(git)) throw Error('reality_git_commit_sha_required')
  // The transport reads VERCEL_GIT_COMMIT_SHA first: both must name the same build.
  if (vercel && vercel !== git) throw Error('reality_release_sha_ambiguous')
  return git
}

/** The running build's verified production release receipt, recorded once per SHA (the deploy pipeline's job). */
export async function recordSimulatedReleaseReceipt(): Promise<{ releaseSha: string; recorded: boolean; receiptId?: string }> {
  const sha = releaseSha()
  const current = sql<string | null>(`SELECT to_jsonb(release_sha) FROM public.platform_release_receipts WHERE environment='production' AND status='verified'
    AND verified_at IS NOT NULL AND nullif(ci_run_id,'') IS NOT NULL AND nullif(deployment_id,'') IS NOT NULL ORDER BY verified_at DESC,recorded_at DESC,id LIMIT 1`)
  if (current === sha) return { releaseSha: sha, recorded: false }
  const runtime = sql<{ migration: string; fingerprint: string }>(`SELECT jsonb_build_object('migration',migration_version,'fingerprint',schema_fingerprint) FROM public.platform_runtime_readiness WHERE id`)
  const root = process.cwd()
  const manifest = (dir: string, ext: string) => readdirSync(resolve(root, dir)).filter(f => f.endsWith(ext)).sort()
    .map(f => `${f}\t${sha256(readFileSync(resolve(root, dir, f)))}`).join('\n')
  const marker = { reality_simulated: true, finding: 'F89/F91', note: 'stand-in for the deploy workflow that records the production release receipt' }
  const { data, error } = await supabaseService.rpc('canonical_record_platform_release_receipt', {
    p_release_sha: sha, p_ci_run_id: `reality-simulated-ci:${sha}`, p_deployment_id: `reality-simulated-deployment:${sha}`, p_environment: 'production',
    p_schema_migration_version: runtime.migration, p_migration_manifest_hash: sha256(manifest('supabase/migrations', '.sql')), p_database_schema_fingerprint: runtime.fingerprint,
    p_generated_types_hash: sha256(readFileSync(resolve(root, 'supabase/database.types.ts'))), p_openapi_contract_version: 'reality-simulated',
    p_openapi_hash: sha256(manifest('docs/openapi', '.json')), p_reconciliation_result: marker, p_performance_evidence: marker, p_evidence: marker,
  } as never)
  if (error) throw Error(`reality_release_receipt_failed: ${error.message}`)
  return { releaseSha: sha, recorded: true, receiptId: data as unknown as string }
}
