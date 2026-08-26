import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runMonthlyBillingAutomation } from '@/lib/billing/monthlyAutomation'
import { authorizeScheduledRequest } from '@/lib/automation/scheduledAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  return text || null
}

function authorized(request: NextRequest) {
  return authorizeScheduledRequest({
    request,
    dedicatedSecretEnv: 'BILLING_AUTOMATION_CRON_SECRET',
    allowVercelCron: true,
  })
}

async function run(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }
  try {
    const result = await runMonthlyBillingAutomation({
      companyId: clean(request.nextUrl.searchParams.get('company_id')),
      billingMonth: clean(request.nextUrl.searchParams.get('billing_month')) ?? clean(request.nextUrl.searchParams.get('month')),
    })
    return NextResponse.json({ ...result, mode: 'prepare_only', approval_required: true })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[billing-monthly-cron] failed', { traceId, error })
    return NextResponse.json(
      { ok: false, error: 'Månatlig fakturaförberedelse kunde inte köras just nu.', code: 'billing_monthly_automation_failed', trace_id: traceId },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
