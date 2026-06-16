import { NextRequest, NextResponse } from 'next/server'
import { processTenantEmailOutbox } from '@/lib/email/emailOutbox'

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

function requestToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return clean(authorization.slice('bearer '.length))
  }

  return clean(request.headers.get('x-email-cron-secret')) ?? clean(request.headers.get('x-cron-secret'))
}

function isAuthorized(request: NextRequest) {
  const token = requestToken(request)
  return Boolean(token && expectedSecrets().includes(token))
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
    return NextResponse.json({ ok: false, error: 'EMAIL_OUTBOX_CRON_SECRET or CRON_SECRET is not configured.' }, { status: 503 })
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const companyId = clean(String(body.companyId ?? body.company_id ?? '')) ?? clean(searchParams.get('companyId')) ?? clean(searchParams.get('company_id'))
  const limit = parseLimit(String(body.limit ?? searchParams.get('limit') ?? '25'))

  try {
    const result = await processTenantEmailOutbox({ companyId, limit })
    return NextResponse.json({ ok: true, source: 'tenant_email_outbox_cron', companyId: companyId ?? null, result })
  } catch (error) {
    console.error('[tenant-email-outbox-cron] Run failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Tenant email outbox processing failed.' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return run(request)
}

export async function POST(request: NextRequest) {
  return run(request, await readJson(request))
}
