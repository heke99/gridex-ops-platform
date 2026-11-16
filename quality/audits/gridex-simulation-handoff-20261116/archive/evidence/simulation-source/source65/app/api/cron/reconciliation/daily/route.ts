import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authorizeScheduledRequest } from '@/lib/automation/scheduledAuth'
import { withAutomationLock } from '@/lib/automation/locks'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { runProductionConsistencyChecks } from '@/lib/ops/reconciliation'
import { supabaseService } from '@/lib/supabase/service'
import { mapWithConcurrency } from '@/lib/performance/mapWithConcurrency'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: string | null): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

async function run(request: NextRequest) {
  if (!authorizeScheduledRequest({
    request,
    dedicatedSecretEnv: 'RECONCILIATION_CRON_SECRET',
    allowVercelCron: true,
  })) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  const companyId = clean(request.nextUrl.searchParams.get('company_id'))
  try {
    await assertPlatformSchemaReady()
    const result = await withAutomationLock({
      lockKey: `reconciliation:daily:${companyId ?? 'all'}`,
      companyId,
      ttlSeconds: 3600,
      metadata: { source: 'daily_reconciliation_cron' },
      run: async () => {
        const applicationChecksPromise = runProductionConsistencyChecks({ companyId })
        let companyIds: string[]
        if (companyId) {
          companyIds = [companyId]
        } else {
          const { data: companies, error: companiesError } = await supabaseService
            .from('companies')
            .select('id')
            .neq('status', 'deleted_test_only')
            .order('id')
          if (companiesError) throw companiesError
          companyIds = (companies ?? []).map((company) => company.id)
        }

        const companyResults = await mapWithConcurrency(companyIds, 4, async (scopedCompanyId) => {
          const canonicalResult = await supabaseService.rpc(
            'canonical_run_architecture_reconciliation',
            { p_company_id: scopedCompanyId },
          )
          if (canonicalResult.error) {
            return {
              company_id: scopedCompanyId,
              ok: false,
              error_code: canonicalResult.error.code ?? 'reconciliation_check_failed',
            }
          }
          return {
            company_id: scopedCompanyId,
            ok: true,
            checks: canonicalResult.data,
          }
        })
        const failedCount = companyResults.filter((company) => !company.ok).length

        return {
          applicationChecks: await applicationChecksPromise,
          canonicalArchitecture: {
            company_count: companyResults.length,
            failed_count: failedCount,
            ok: failedCount === 0,
            companies: companyResults,
          },
        }
      },
    })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[daily-reconciliation] failed', { traceId, companyId, error })
    return NextResponse.json({
      ok: false,
      error: 'Den dagliga avstämningen kunde inte köras.',
      code: 'daily_reconciliation_failed',
      trace_id: traceId,
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
