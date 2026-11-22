import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authorizeScheduledRequest } from '@/lib/automation/scheduledAuth'
import { withAutomationLock } from '@/lib/automation/locks'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { runProductionConsistencyChecks, type ReconciliationCheckResult } from '@/lib/ops/reconciliation'
import { supabaseService } from '@/lib/supabase/service'
import { mapWithConcurrency } from '@/lib/performance/mapWithConcurrency'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COMPANY_PAGE_SIZE = 500

// The SQL RPC reports a count or a sibling _error key for each check.
const CANONICAL_CHECKS = [
  'membership_without_role',
  'role_without_auth_identity',
  'duplicate_membership',
  'duplicate_role',
  'accepted_invite_without_access',
  'active_client_not_ready',
  'deprecated_event_bus_backlog',
  'due_stranded_outbox',
  'provisioning_dead_letter',
  'stuck_provisioning',
  'manual_review_over_sla',
  'manual_review_without_owner',
  'application_without_repair',
  'contract_missing_customer_or_site',
  'contract_without_metering_point',
  'switch_without_contract',
  'ediel_live_without_valid_tenant',
  'invalid_lifecycle',
]

const APPLICATION_CHECKS = [
  'contracts_missing_links',
  'active_contracts_missing_price_area',
  'active_contracts_missing_price_snapshot',
  'open_switches_missing_prerequisites',
  'invoice_run_totals_mismatch',
  'sent_items_missing_provider_guid',
  'duplicate_billing_per_contract_period',
  'invoice_export_retry_backlog',
]

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function checkCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function checkKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value)
}

function safeErrorCode(value: unknown): string | null {
  return typeof value === 'string' && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(value) ? value : null
}

async function listCompanyIds(): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | null = null
  while (true) {
    let query = supabaseService
      .from('companies')
      .select('id')
      .neq('status', 'deleted_test_only')
      .order('id')
      .limit(COMPANY_PAGE_SIZE)
    if (cursor !== null) query = query.gt('id', cursor)
    const { data, error } = await query
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('reconciliation_company_inventory_unavailable')
    if (data.length === 0) return ids

    // The database can return a smaller page than the requested limit.
    for (const { id } of data) {
      if (typeof id !== 'string' || !id || (cursor !== null && id <= cursor)) {
        throw new Error('reconciliation_company_inventory_no_progress')
      }
      ids.push(id)
      cursor = id
    }
  }
}

function verifyCanonicalChecks(companyId: string, data: unknown) {
  const envelope = record(data)
  const companies = record(envelope?.companies)
  const canonicalId = companyId.toLowerCase()
  const values = record(companies?.[canonicalId])
  const checkedAt = envelope?.checked_at
  if (!companies || Object.keys(companies).length !== 1 || !values ||
      typeof checkedAt !== 'string' || !Number.isFinite(Date.parse(checkedAt))) {
    return {
      checks: null,
      coverage: { verified_count: 0, failed_checks: [], unverified_checks: CANONICAL_CHECKS },
      finding_count: 0,
    }
  }

  const keys = new Set([...CANONICAL_CHECKS, ...Object.keys(values).map(key => key.replace(/_error$/, '')).filter(checkKey)])
  const safeValues = new Map<string, string | number>()
  const coverage = { verified_count: 0, failed_checks: [] as string[], unverified_checks: [] as string[] }
  let findingCount = 0
  for (const key of keys) {
    const errorKey = `${key}_error`
    if (Object.hasOwn(values, errorKey)) {
      const code = safeErrorCode(values[errorKey])
      if (code && !Object.hasOwn(values, key)) {
        safeValues.set(errorKey, code)
        coverage.failed_checks.push(key)
      } else {
        coverage.unverified_checks.push(key)
      }
      continue
    }

    const count = values[key]
    if (!checkCount(count)) {
      coverage.unverified_checks.push(key)
      continue
    }
    coverage.verified_count += 1
    if (count > 0) findingCount += 1
    safeValues.set(key, count)
  }

  return {
    checks: { checked_at: checkedAt, companies: { [canonicalId]: Object.fromEntries(safeValues) } },
    coverage,
    finding_count: findingCount,
  }
}

function verifyApplicationChecks(result: Awaited<ReturnType<typeof runProductionConsistencyChecks>> | null) {
  const byKey = new Map<string, ReconciliationCheckResult | null>(APPLICATION_CHECKS.map(key => [key, null]))
  const seen = new Set<string>()
  for (const check of Array.isArray(result?.checks) ? result.checks : []) {
    if (!checkKey(check?.key)) continue
    byKey.set(check.key, seen.has(check.key) ? null : check)
    seen.add(check.key)
  }

  const checks: ReconciliationCheckResult[] = []
  const failedChecks: string[] = []
  const unverifiedChecks: string[] = []
  let verifiedCount = 0
  for (const [key, check] of byKey) {
    if (!check) {
      unverifiedChecks.push(key)
      continue
    }

    let error: string | undefined
    if (typeof check.error === 'string' && check.error.trim() && check.error !== 'schema_missing') {
      failedChecks.push(key)
      error = 'reconciliation_check_failed'
    } else if (check.error != null || !checkCount(check.count) || !Array.isArray(check.sampleIds) ||
        check.sampleIds.some(id => typeof id !== 'string')) {
      unverifiedChecks.push(key)
      error = check.error === 'schema_missing' ? 'schema_missing' : 'reconciliation_check_unverified'
    } else {
      verifiedCount += 1
    }
    checks.push({
      key,
      label: check.label,
      description: check.description,
      severity: check.severity,
      count: error ? 0 : check.count,
      sampleIds: error ? [] : check.sampleIds,
      error,
    })
  }

  return {
    checks,
    criticalCount: checks.filter(check => check.severity === 'critical' && check.count > 0).length,
    warningCount: checks.filter(check => check.severity === 'warning' && check.count > 0).length,
    coverage: {
      verified_count: verifiedCount,
      failed_count: failedChecks.length,
      unverified_count: unverifiedChecks.length,
      failed_checks: failedChecks,
      unverified_checks: unverifiedChecks,
    },
  }
}

async function runCanonicalCompany(scopedCompanyId: string) {
  let data: unknown
  let errorCode: string | null = null
  try {
    const result = await supabaseService.rpc('canonical_run_architecture_reconciliation', { p_company_id: scopedCompanyId })
    data = result.data
    if (result.error) errorCode = safeErrorCode(result.error.code) ?? 'reconciliation_check_failed'
  } catch (error) {
    errorCode = safeErrorCode(record(error)?.code) ?? 'reconciliation_check_failed'
  }

  const { checks, coverage, finding_count } = verifyCanonicalChecks(scopedCompanyId, errorCode === null ? data : null)
  return {
    rpcFailed: errorCode !== null,
    company: {
      company_id: scopedCompanyId,
      ok: errorCode === null && coverage.failed_checks.length === 0 && coverage.unverified_checks.length === 0,
      ...(errorCode === null ? { checks } : { error_code: errorCode }),
      coverage,
      finding_count,
    },
  }
}

async function run(request: NextRequest) {
  if (!authorizeScheduledRequest({
    request,
    dedicatedSecretEnv: 'RECONCILIATION_CRON_SECRET',
    allowVercelCron: true,
  })) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  const companyId = request.nextUrl.searchParams.get('company_id')?.trim() || null
  try {
    await assertPlatformSchemaReady()
    const result = await withAutomationLock({
      lockKey: `reconciliation:daily:${companyId ?? 'all'}`,
      companyId,
      ttlSeconds: 3600,
      metadata: { source: 'daily_reconciliation_cron' },
      run: async () => {
        const companyIds = companyId ? [companyId] : await listCompanyIds()
        const [applicationResults, rpcResults] = await Promise.all([
          runProductionConsistencyChecks({ companyId }).catch(() => null),
          mapWithConcurrency(companyIds, 4, runCanonicalCompany),
        ])
        const { coverage: applicationCoverage, ...applicationChecks } = verifyApplicationChecks(applicationResults)
        const companyResults = rpcResults.map(result => result.company)
        const failedCount = rpcResults.filter(result => result.rpcFailed).length
        const incompleteCompanies = companyResults.filter(company => !company.ok).length
        const coverage = {
          complete: incompleteCompanies === 0 && applicationCoverage.failed_count === 0 && applicationCoverage.unverified_count === 0,
          application: applicationCoverage,
          canonical: {
            incomplete_company_count: incompleteCompanies,
            verified_check_count: companyResults.reduce((count, company) => count + company.coverage.verified_count, 0),
            failed_check_count: companyResults.reduce((count, company) => count + company.coverage.failed_checks.length, 0),
            unverified_check_count: companyResults.reduce((count, company) => count + company.coverage.unverified_checks.length, 0),
          },
        }

        return {
          applicationChecks,
          canonicalArchitecture: {
            company_count: companyResults.length,
            failed_count: failedCount,
            ok: incompleteCompanies === 0,
            companies: companyResults,
          },
          coverage,
          findings: {
            application_check_count: applicationChecks.checks.filter(check => check.count > 0).length,
            canonical_check_count: companyResults.reduce((count, company) => count + company.finding_count, 0),
          },
        }
      },
    })
    const ok = result.coverage.complete
    return NextResponse.json({ ok, execution: 'completed', result }, { status: ok ? 200 : 503 })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[daily-reconciliation] failed', { traceId, companyId, code: safeErrorCode(record(error)?.code) })
    return NextResponse.json({
      ok: false,
      execution: 'failed',
      error: 'Den dagliga avstämningen kunde inte köras.',
      code: 'daily_reconciliation_failed',
      trace_id: traceId,
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
