import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authorizeScheduledRequest } from '@/lib/automation/scheduledAuth'
import { withAutomationLock } from '@/lib/automation/locks'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { supabaseService } from '@/lib/supabase/service'
import { mapWithConcurrency } from '@/lib/performance/mapWithConcurrency'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Owner decision 34 (FINDINGS J2-13): the monthly settlement reconciliation summary. Runs the previous Stockholm
// month (or ?month=YYYY-MM) for every tenant, or one tenant (?company_id=), through gridex_settlement_reconcile_v1.
// Deviations open staff cases; nothing is corrected and no billing is blocked.

function clean(value: string | null): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function previousStockholmMonth(now = new Date()): string {
  const [year, month] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit' })
    .format(now).split('-').map(Number)
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  return `${previous.year}-${String(previous.month).padStart(2, '0')}-01`
}

async function run(request: NextRequest) {
  if (!authorizeScheduledRequest({ request, dedicatedSecretEnv: 'RECONCILIATION_CRON_SECRET', allowVercelCron: true })) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }
  const companyId = clean(request.nextUrl.searchParams.get('company_id'))
  const monthParam = clean(request.nextUrl.searchParams.get('month'))
  if (monthParam && !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) {
    return NextResponse.json({ ok: false, error: 'month måste vara YYYY-MM.' }, { status: 400 })
  }
  const month = monthParam ? `${monthParam}-01` : previousStockholmMonth()
  try {
    await assertPlatformSchemaReady()
    const result = await withAutomationLock({
      lockKey: `reconciliation:settlement:${month}:${companyId ?? 'all'}`,
      companyId,
      ttlSeconds: 3600,
      metadata: { source: 'settlement_reconciliation_cron', month },
      run: async () => {
        let companyIds: string[]
        if (companyId) companyIds = [companyId]
        else {
          const { data, error } = await supabaseService.from('companies').select('id').neq('status', 'deleted_test_only').order('id')
          if (error) throw error
          companyIds = (data ?? []).map((company) => company.id)
        }
        const companies = await mapWithConcurrency(companyIds, 4, async (scopedCompanyId) => {
          const { data, error } = await supabaseService.rpc('gridex_settlement_reconcile_v1', {
            p_company_id: scopedCompanyId, p_month: month, p_trigger: 'monthly',
          })
          if (error) return { company_id: scopedCompanyId, ok: false, error_code: error.code ?? 'settlement_reconciliation_failed' }
          return { company_id: scopedCompanyId, ok: true, result: data }
        })
        return { month, company_count: companies.length, failed_count: companies.filter((c) => !c.ok).length, companies }
      },
    })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[settlement-reconciliation] failed', { traceId, companyId, month, error })
    return NextResponse.json({ ok: false, error: 'Avstämningen mot nätägarens värden kunde inte köras.', code: 'settlement_reconciliation_failed', trace_id: traceId }, { status: 500 })
  }
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
