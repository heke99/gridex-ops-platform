import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authorizeScheduledRequest } from '@/lib/automation/scheduledAuth'
import { withAutomationLock } from '@/lib/automation/locks'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: string | null): string | null {
  const text = String(value ?? '').trim()
  return text || null
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
      lockKey: `reconciliation:end-to-end:${companyId ?? 'all'}`,
      companyId,
      ttlSeconds: 3600,
      metadata: { source: 'reconciliation_cron' },
      run: async () => {
        const response = await supabaseService.rpc('gridex_run_end_to_end_reconciliation', {
          p_company_id: companyId,
        })
        if (response.error) throw response.error
        return response.data
      },
    })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[end-to-end-reconciliation] failed', { traceId, companyId, error })
    return NextResponse.json({
      ok: false,
      error: 'End-to-end-avstämningen kunde inte köras.',
      code: 'end_to_end_reconciliation_failed',
      trace_id: traceId,
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
