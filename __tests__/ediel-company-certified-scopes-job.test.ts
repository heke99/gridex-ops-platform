// reality-defects: F89, F90, F91 (the post-deploy/cron job that records company-certified scope proofs)
import { beforeEach, expect, it, vi } from 'vitest'
import { AI_LIST_SOURCE_PROFILE } from '@/lib/ediel/aiListFormat'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, rpc: vi.fn(), queries: [] as string[] }))
vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: Array<(row: Row) => boolean> = []; one = false; max = Infinity
    constructor(readonly table: string) {}
    select() { return this }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this }
    not(key: string, op: string, value: unknown) { if (op !== 'is' || value !== null) throw Error('undeclared'); this.filters.push(row => row[key] != null); return this }
    order(key: string, options?: { ascending?: boolean }) { void key; void options; return this }
    limit(max: number) { this.max = max; return this }
    maybeSingle() { this.one = true; return this }
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      io.queries.push(this.table)
      const rows = (io.tables[this.table] ?? []).filter(row => this.filters.every(f => f(row)))
        .sort((a, b) => String(b.verified_at ?? '').localeCompare(String(a.verified_at ?? ''))).slice(0, this.max)
      return Promise.resolve({ data: this.one ? rows[0] ?? null : rows, error: null }).then(resolve, reject)
    }
  }
  return { supabaseService: { from: (table: string) => new Query(table), rpc: io.rpc } }
})

import { recordCompanyCertifiedScopes } from '@/lib/ediel/companyCertifiedScopes'

const SHA = 'a'.repeat(40), OLD = 'b'.repeat(40)
const receipt = (sha: string, deployment: string, verifiedAt: string) => ({ id: `r-${sha.slice(0, 1)}-${deployment}`, release_sha: sha, ci_run_id: 'github:run/1', deployment_id: deployment,
  environment: 'production', schema_migration_version: '20261023160000', status: 'verified', verified_at: verifiedAt, evidence: { recordedBy: 'ci' },
  migration_manifest_hash: 'm'.repeat(64), database_schema_fingerprint: 'f'.repeat(64), generated_types_hash: 't'.repeat(64), openapi_contract_version: '2026-10-22.1',
  openapi_hash: 'o'.repeat(64), reconciliation_result: { status: 'not_captured' }, performance_evidence: { status: 'not_captured' } })

beforeEach(() => {
  vi.unstubAllEnvs(); io.rpc.mockReset(); io.queries = []
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', SHA); vi.stubEnv('VERCEL_DEPLOYMENT_ID', '')
  io.tables = { platform_release_receipts: [receipt(SHA, 'dpl_new', '2026-10-23T08:00:00Z')], platform_runtime_readiness: [{ id: true, migration_version: '20261023160000', is_ready: true }] }
  io.rpc.mockImplementation(async (name: string) => name === 'ediel_record_company_certified_scopes_v1'
    ? { data: { version: 1, scopes: 2, recorded: 2, current: 0, held: 0, results: [] }, error: null }
    : { data: 'receipt-id', error: null })
})

it('records through the SQL job with the running release SHA and the AI source profile hash', async () => {
  await expect(recordCompanyCertifiedScopes()).resolves.toMatchObject({ status: 'ran', releaseSha: SHA, receipt: { status: 'current' }, summary: { recorded: 2 } })
  expect(io.rpc).toHaveBeenCalledTimes(1)
  expect(io.rpc).toHaveBeenCalledWith('ediel_record_company_certified_scopes_v1', { p_release_sha: SHA, p_ai_rulepack_hash: AI_LIST_SOURCE_PROFILE.sourceSha256, p_limit: 200, p_company_id: null })
})

it('does nothing without a genuine running release SHA', async () => {
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', ''); vi.stubEnv('GIT_COMMIT_SHA', '')
  await expect(recordCompanyCertifiedScopes()).resolves.toEqual({ status: 'skipped', reason: 'ediel_release_sha_unavailable' })
  expect(io.rpc).not.toHaveBeenCalled(); expect(io.queries).toEqual([])
})

it('never writes a receipt for a new SHA: without a CI-recorded receipt nothing is recorded', async () => {
  io.tables.platform_release_receipts = [receipt(OLD, 'dpl_old', '2026-10-23T08:00:00Z')]
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_new')
  await expect(recordCompanyCertifiedScopes()).resolves.toMatchObject({ status: 'skipped', reason: 'release_receipt_missing_for_running_sha' })
  expect(io.rpc).not.toHaveBeenCalled()
})

it('re-verifies the existing receipt verbatim when Vercel serves that same deployment again (rollback)', async () => {
  const own = receipt(SHA, 'dpl_rollback', '2026-10-22T08:00:00Z')
  io.tables.platform_release_receipts = [own, receipt(OLD, 'dpl_newer', '2026-10-23T08:00:00Z')]
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_rollback')
  await expect(recordCompanyCertifiedScopes()).resolves.toMatchObject({ status: 'ran', receipt: { status: 'reverified', receiptId: 'receipt-id' } })
  expect(io.rpc).toHaveBeenNthCalledWith(1, 'canonical_record_platform_release_receipt', expect.objectContaining({ p_release_sha: SHA, p_ci_run_id: own.ci_run_id,
    p_deployment_id: 'dpl_rollback', p_schema_migration_version: own.schema_migration_version, p_migration_manifest_hash: own.migration_manifest_hash, p_evidence: own.evidence }))
  expect(io.rpc).toHaveBeenNthCalledWith(2, 'ediel_record_company_certified_scopes_v1', expect.objectContaining({ p_release_sha: SHA }))
})

it.each([
  ['another deployment of the same SHA', { deployment: 'dpl_other', migration: '20261023160000' }, 'release_receipt_missing_for_running_sha'],
  ['a database schema that changed since the deploy', { deployment: 'dpl_rollback', migration: '20261024000000' }, 'release_receipt_schema_changed_since_deploy'],
])('does not re-verify for %s', async (_label, input, reason) => {
  io.tables.platform_release_receipts = [receipt(SHA, 'dpl_rollback', '2026-10-22T08:00:00Z'), receipt(OLD, 'dpl_newer', '2026-10-23T08:00:00Z')]
  io.tables.platform_runtime_readiness = [{ id: true, migration_version: input.migration, is_ready: true }]
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', input.deployment)
  await expect(recordCompanyCertifiedScopes()).resolves.toMatchObject({ status: 'skipped', reason })
  expect(io.rpc).not.toHaveBeenCalled()
})

it('fails closed on an RPC error without leaking it', async () => {
  io.rpc.mockResolvedValue({ data: null, error: { message: 'private detail' } })
  await expect(recordCompanyCertifiedScopes()).rejects.toThrow(/^ediel_company_certified_scopes_failed$/)
})
