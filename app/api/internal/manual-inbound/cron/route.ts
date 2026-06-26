// app/api/internal/manual-inbound/cron/route.ts
//
// Internal cron that polls the configured MANUAL operations mailbox(es) over IMAP
// and routes grid-owner replies (matched by GX-FIR case_reference) to the manual
// inbound ingestion. This is separate from the Ediel inbound cron
// (/api/internal/inbound-mail/cron), which serves ediel@gridex.se for EDIFACT
// transport only. This route never touches Ediel mailboxes or EDIFACT.

import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runManualInboundMailEngine } from '@/lib/inbound-mail/manualMailboxPoller'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function expectedSecrets(): string[] {
  return [process.env.MANUAL_INBOUND_CRON_SECRET, process.env.CRON_SECRET]
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
  return clean(request.headers.get('x-manual-inbound-secret')) ?? clean(request.headers.get('x-cron-secret'))
}

function isAuthorized(request: NextRequest): boolean {
  const token = requestToken(request)
  return expectedSecrets().some((secret) => sameSecret(token, secret))
}

async function run(request: NextRequest) {
  if (expectedSecrets().length === 0) {
    return NextResponse.json({ ok: false, error: 'Manuell inkommande e-postkö är inte konfigurerad.' }, { status: 503 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  // Reject mailbox-as-tenant overrides; tenant is resolved from the matched request.
  if (request.nextUrl.searchParams.get('company_id') || request.nextUrl.searchParams.get('companyId')) {
    return NextResponse.json({ ok: false, error: 'company_id overrides är inte tillåtna för manuell inbound-cron.' }, { status: 400 })
  }

  const environment = clean(request.nextUrl.searchParams.get('environment'))

  try {
    const result = await runManualInboundMailEngine({ environment })
    // Do not expose raw provider/IMAP error strings publicly; keep them in logs.
    const summary = {
      mailboxes: result.mailboxes,
      polled: result.polled,
      fetched: result.fetched,
      ingested: result.ingested,
      matched: result.matched,
      skipped: result.skipped,
    }
    if (result.errors.length > 0) {
      console.error('[manual-inbound-cron] Poll errors', { count: result.errors.length, errors: result.errors })
    }
    return NextResponse.json({ ok: true, source: 'manual_inbound_cron', result: summary })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[manual-inbound-cron] Run failed', { traceId, error })
    return NextResponse.json(
      { ok: false, error: 'Manuell inkommande e-post kunde inte hanteras.', code: 'manual_inbound_processing_failed', trace_id: traceId },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) {
  return run(request)
}

export async function POST(request: NextRequest) {
  return run(request)
}
