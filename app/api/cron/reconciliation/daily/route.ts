import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authorizeScheduledRequest } from '@/lib/automation/scheduledAuth'
import { withAutomationLock } from '@/lib/automation/locks'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { runProductionConsistencyChecks } from '@/lib/ops/reconciliation'
import { supabaseService } from '@/lib/supabase/service'

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
        const [applicationChecks, canonicalResult] = await Promise.all([
          runProductionConsistencyChecks({ companyId }),
          supabaseService.rpc('canonical_run_architecture_reconciliation', {
            p_company_id: companyId,
          }),
        ])
        if (canonicalResult.error) throw canonicalResult.error
        return {
          applicationChecks,
          canonicalArchitecture: canonicalResult.data,
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
