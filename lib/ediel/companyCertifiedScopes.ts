import { supabaseService } from '@/lib/supabase/service'
import { AI_LIST_SOURCE_PROFILE } from '@/lib/ediel/aiListFormat'

/**
 * FINDINGS F89/F90/F91, owner decision 2026-10-23 ("Automatiska bevis").
 *
 * Records, for every pending production business scope of every tenant whose
 * ediel_production capability is ready, the per-scope proof that the unchanged
 * ediel_scoped_capability_readiness_v1 gate accepts, from the tenant's own approved
 * company certification (SQL: ediel_record_company_certified_scopes_v1). It runs before
 * the outbox on every cron cycle, so a deploy (release SHA), route change or rule-edition
 * change is re-proven automatically. The gate itself (assertScopedEdielProductionCapability,
 * the SQL transport entry) still refuses until a current proof exists; this job is never
 * called from a gate path.
 *
 * Release receipts: the receipt for a new release SHA is written by the production deploy
 * workflow (scripts/record-production-release-receipt.mjs), which alone knows the CI run and
 * hashes the exact commit. This job only re-verifies an existing receipt of the running SHA
 * when Vercel serves that very deployment again (instant rollback), unchanged in content.
 */

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>

type Receipt = {
  id: string; release_sha: string; ci_run_id: string | null; deployment_id: string | null; environment: string; schema_migration_version: string
  status: string; verified_at: string | null; evidence: unknown; migration_manifest_hash: string | null; database_schema_fingerprint: string | null
  generated_types_hash: string | null; openapi_contract_version: string | null; openapi_hash: string | null
  reconciliation_result: unknown; performance_evidence: unknown
}

export type ReleaseReceiptState =
  | { status: 'current' }
  | { status: 'reverified'; receiptId: string }
  | { status: 'missing'; reason: string }

export type CompanyCertifiedScopesResult =
  | { status: 'skipped'; reason: string; releaseSha?: string; receipt?: ReleaseReceiptState }
  | { status: 'ran'; releaseSha: string; receipt: ReleaseReceiptState; summary: unknown }

/** The release SHA the scoped gate uses (same source and order). */
export function runningEdielReleaseSha(): string | null {
  const value = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA
  return value && /^[0-9a-f]{40}$/.test(value) ? value : null
}

const filled = (value: string | null | undefined): value is string => typeof value === 'string' && value.trim() !== ''

async function latestVerifiedReceipt(): Promise<Receipt | null> {
  const { data, error } = await supabaseService.from('platform_release_receipts').select('*')
    .eq('environment', 'production').eq('status', 'verified').not('verified_at', 'is', null)
    .order('verified_at', { ascending: false }).order('recorded_at', { ascending: false }).order('id', { ascending: true }).limit(25)
  if (error) throw new Error('ediel_release_receipt_read_failed', { cause: error })
  // The gate's selection also skips receipts without CI run or deployment identity.
  return ((data ?? []) as Receipt[]).find(row => filled(row.ci_run_id) && filled(row.deployment_id)) ?? null
}

/**
 * The running SHA must be the latest verified production receipt. Only an existing receipt of
 * this SHA AND this Vercel deployment, recorded against the database schema version that is
 * still current, is re-verified (verbatim, through the canonical writer). Nothing is invented.
 */
export async function ensureRunningReleaseReceipt(sha: string): Promise<ReleaseReceiptState> {
  const latest = await latestVerifiedReceipt()
  if (latest?.release_sha === sha) return { status: 'current' }
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID
  if (!filled(deploymentId)) return { status: 'missing', reason: 'release_receipt_missing_for_running_sha' }
  const { data: rows, error } = await supabaseService.from('platform_release_receipts').select('*')
    .eq('environment', 'production').eq('status', 'verified').eq('release_sha', sha).eq('deployment_id', deploymentId)
    .order('verified_at', { ascending: false }).limit(1)
  if (error) throw new Error('ediel_release_receipt_read_failed', { cause: error })
  const existing = (rows ?? [])[0] as Receipt | undefined
  if (!existing || !filled(existing.ci_run_id)) return { status: 'missing', reason: 'release_receipt_missing_for_running_sha' }
  const { data: runtime, error: runtimeError } = await supabaseService.from('platform_runtime_readiness')
    .select('migration_version,is_ready').eq('id', true).maybeSingle()
  if (runtimeError) throw new Error('ediel_runtime_readiness_read_failed', { cause: runtimeError })
  const current = runtime as { migration_version?: string | null; is_ready?: boolean | null } | null
  if (current?.is_ready !== true || current.migration_version !== existing.schema_migration_version) {
    return { status: 'missing', reason: 'release_receipt_schema_changed_since_deploy' }
  }
  if (![existing.migration_manifest_hash, existing.database_schema_fingerprint, existing.generated_types_hash, existing.openapi_contract_version, existing.openapi_hash].every(filled)) {
    return { status: 'missing', reason: 'release_receipt_identity_incomplete' }
  }
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as Rpc
  const { data, error: recordError } = await rpc('canonical_record_platform_release_receipt', {
    p_release_sha: existing.release_sha, p_ci_run_id: existing.ci_run_id, p_deployment_id: existing.deployment_id, p_environment: 'production',
    p_schema_migration_version: existing.schema_migration_version, p_migration_manifest_hash: existing.migration_manifest_hash,
    p_database_schema_fingerprint: existing.database_schema_fingerprint, p_generated_types_hash: existing.generated_types_hash,
    p_openapi_contract_version: existing.openapi_contract_version, p_openapi_hash: existing.openapi_hash,
    p_reconciliation_result: existing.reconciliation_result, p_performance_evidence: existing.performance_evidence, p_evidence: existing.evidence,
  })
  if (recordError || typeof data !== 'string') throw new Error('ediel_release_receipt_reverify_failed', { cause: recordError })
  return { status: 'reverified', receiptId: data }
}

/** Post-deploy/cron job: record missing or stale company-certified scope proofs. */
export async function recordCompanyCertifiedScopes(options: { limit?: number } = {}): Promise<CompanyCertifiedScopesResult> {
  const releaseSha = runningEdielReleaseSha()
  if (!releaseSha) return { status: 'skipped', reason: 'ediel_release_sha_unavailable' }
  const receipt = await ensureRunningReleaseReceipt(releaseSha)
  if (receipt.status === 'missing') return { status: 'skipped', reason: receipt.reason, releaseSha, receipt }
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as Rpc
  const { data, error } = await rpc('ediel_record_company_certified_scopes_v1', {
    p_release_sha: releaseSha, p_ai_rulepack_hash: AI_LIST_SOURCE_PROFILE.sourceSha256,
    p_limit: Math.max(1, Math.min(Math.floor(options.limit ?? 200), 500)), p_company_id: null,
  })
  if (error) throw new Error('ediel_company_certified_scopes_failed', { cause: error })
  return { status: 'ran', releaseSha, receipt, summary: data }
}
