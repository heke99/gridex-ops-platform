import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { processTenantEmailOutbox } from '@/lib/email/emailOutbox'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function expectedSecrets(): string[] {
  return [process.env.EMAIL_OUTBOX_CRON_SECRET, process.env.CRON_SECRET]
    .map((value) => clean(value))
    .filter((value): value is string => Boolean(value))
}

function sameSecret(candidate: string | null, expected: string): boolean {
  if (!candidate) return false
  const left = Buffer.from(candidate)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function requestToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.toLowerCase().startsWith('bearer ')) return clean(authorization.slice('bearer '.length))
  return clean(request.headers.get('x-email-cron-secret')) ?? clean(request.headers.get('x-cron-secret'))
}

function isAuthorized(request: NextRequest) {
  const token = requestToken(request)
  return expectedSecrets().some((secret) => sameSecret(token, secret))
}

function parseLimit(value: string | null) {
  const parsed = Number(value ?? 25)
  if (!Number.isFinite(parsed) || parsed <= 0) return 25
  return Math.min(Math.floor(parsed), 100)
}

async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  return request.json().catch(() => ({}))
}

async function logRun(payload: Record<string, unknown>) {
  await supabaseService.from('tenant_email_outbox_runs').insert(payload).then(({ error }) => {
    if (error && !['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) {
      console.warn('[tenant-email-outbox-cron] Could not write run log', error.message)
    }
  })
}

async function run(request: NextRequest, body: Record<string, unknown> = {}) {
  if (expectedSecrets().length === 0) {
    await logRun({ status: 'blocked', error_message: 'Email outbox cron secret is not configured.', metadata: { reason: 'missing_secret' } })
    return NextResponse.json({ ok: false, error: 'E-postkön är inte konfigurerad.' }, { status: 503 })
  }

  if (!isAuthorized(request)) {
    await logRun({ status: 'blocked', error_message: 'Unauthorized.', metadata: { reason: 'unauthorized' } })
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const companyId = clean(String(body.companyId ?? body.company_id ?? '')) ?? clean(searchParams.get('companyId')) ?? clean(searchParams.get('company_id'))
  const limit = parseLimit(String(body.limit ?? searchParams.get('limit') ?? '25'))

  try {
    const result = await processTenantEmailOutbox({ companyId, limit })
    await logRun({
      company_id: companyId ?? null,
      status: result.errors.length > 0 ? 'completed_with_errors' : 'completed',
      scanned: result.scanned,
      claimed: result.claimed,
      sent: result.sent,
      retried: result.retried,
      failed: result.failed,
      skipped: result.skipped,
      metadata: { source: 'tenant_email_outbox_cron', result },
    })
    return NextResponse.json({ ok: true, source: 'tenant_email_outbox_cron', companyId: companyId ?? null, result })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[tenant-email-outbox-cron] Run failed', { traceId, error })
    await logRun({ company_id: companyId ?? null, status: 'failed', error_message: `trace_id=${traceId}`, metadata: { trace_id: traceId } })
    return NextResponse.json({ ok: false, error: 'E-postkön kunde inte köras just nu.', code: 'email_outbox_processing_failed', trace_id: traceId }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return run(request)
}

export async function POST(request: NextRequest) {
  return run(request, await readJson(request))
}
