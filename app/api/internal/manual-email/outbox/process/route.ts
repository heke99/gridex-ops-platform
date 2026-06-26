import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { processManualEmailOutbox } from '@/lib/email/manualEmailOutbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function expectedSecrets(): string[] {
  return [process.env.MANUAL_EMAIL_OUTBOX_CRON_SECRET, process.env.EMAIL_OUTBOX_CRON_SECRET, process.env.CRON_SECRET]
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
  return clean(request.headers.get('x-cron-secret'))
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

async function run(request: NextRequest, body: Record<string, unknown> = {}) {
  if (expectedSecrets().length === 0) {
    return NextResponse.json({ ok: false, error: 'Manuell e-postkö är inte konfigurerad.' }, { status: 503 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const companyId = clean(String(body.companyId ?? body.company_id ?? '')) ?? clean(searchParams.get('companyId')) ?? clean(searchParams.get('company_id'))
  const limit = parseLimit(String(body.limit ?? searchParams.get('limit') ?? '25'))

  try {
    const result = await processManualEmailOutbox({ companyId, limit })
    // Do not expose raw provider error strings publicly. Provider diagnostics
    // stay in server logs and manual_email_outbox.last_error (superadmin only).
    const summary = {
      scanned: result.scanned,
      claimed: result.claimed,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
    }
    if (result.errors.length > 0) {
      console.error('[manual-email-outbox-cron] Provider errors', { count: result.errors.length, errors: result.errors })
    }
    return NextResponse.json({ ok: true, source: 'manual_email_outbox_cron', companyId: companyId ?? null, result: summary })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[manual-email-outbox-cron] Run failed', { traceId, error })
    return NextResponse.json({ ok: false, error: 'Manuell e-postkö kunde inte köras just nu.', code: 'manual_email_outbox_processing_failed', trace_id: traceId }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return run(request)
}

export async function POST(request: NextRequest) {
  return run(request, await readJson(request))
}
