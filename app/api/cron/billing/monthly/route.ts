import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runMonthlyBillingAutomation } from '@/lib/billing/monthlyAutomation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  return text || null
}

function authorized(request: NextRequest) {
  const expected = [process.env.BILLING_AUTOMATION_CRON_SECRET, process.env.CRON_SECRET]
    .map(clean)
    .filter((value): value is string => Boolean(value))
  if (expected.length === 0) return false

  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? clean(authorization.slice('bearer '.length))
    : clean(request.headers.get('x-cron-secret'))

  return Boolean(token && expected.some((secret) => {
    const left = Buffer.from(token)
    const right = Buffer.from(secret)
    return left.length === right.length && timingSafeEqual(left, right)
  }))
}

function booleanParam(value: string | null) {
  return ['1', 'true', 'yes', 'ja'].includes(String(value ?? '').trim().toLowerCase())
}

async function run(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  try {
    const result = await runMonthlyBillingAutomation({
      companyId: clean(request.nextUrl.searchParams.get('company_id')),
      billingMonth: clean(request.nextUrl.searchParams.get('billing_month')) ?? clean(request.nextUrl.searchParams.get('month')),
      targetSystem: clean(request.nextUrl.searchParams.get('target_system')) ?? 'billing_partner',
      exportFormat: clean(request.nextUrl.searchParams.get('export_format')) ?? 'json',
      sendToPartner: booleanParam(request.nextUrl.searchParams.get('send_to_partner')),
    })
    return NextResponse.json(result)
  } catch (error) {
    const traceId = randomUUID()
    console.error('[billing-monthly-cron] failed', { traceId, error })
    return NextResponse.json(
      { ok: false, error: 'Månatlig faktureringsautomation kunde inte köras just nu.', code: 'billing_monthly_automation_failed', trace_id: traceId },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
