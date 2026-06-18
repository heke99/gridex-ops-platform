// app/api/internal/inbound-mail/cron/route.ts
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.EDIEL_INBOUND_CRON_SECRET ?? process.env.CRON_SECRET
  if (!configuredSecret) return false

  const authorization = request.headers.get('authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  const headerSecret = request.headers.get('x-cron-secret')

  return [bearer, headerSecret].some((candidate) => {
    if (!candidate) return false
    const left = Buffer.from(candidate)
    const right = Buffer.from(configuredSecret)
    return left.length === right.length && timingSafeEqual(left, right)
  })
}

function parseEnvironment(value: string | null): 'test' | 'production' {
  if (value === 'test' || value === 'production') return value
  throw new Error('environment måste vara test eller production.')
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('company_id') || request.nextUrl.searchParams.get('companyId')) {
    return NextResponse.json({ ok: false, error: 'company_id overrides är inte tillåtna för shared mailbox-cron.' }, { status: 400 })
  }

  let environment: 'test' | 'production'
  try {
    environment = parseEnvironment(request.nextUrl.searchParams.get('environment'))
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Ogiltig environment.' }, { status: 400 })
  }

  const mailboxId = request.nextUrl.searchParams.get('mailbox_id') ?? request.nextUrl.searchParams.get('mailboxId')
  const debugForceAllowed = request.headers.get('x-gridex-internal-debug') === 'true'
  const force = debugForceAllowed && ['1', 'true', 'yes'].includes((request.nextUrl.searchParams.get('force') ?? '').toLowerCase())

  try {
    const { runInboundEdielMailEngine } = await import('@/lib/inbound-mail/edielMailboxPoller')
    const result = await runInboundEdielMailEngine({
      environment,
      mailboxId,
      force,
      sharedOnly: !mailboxId,
      allowMissingMailboxConfig: true,
    })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[inbound-mail-cron] Run failed', { traceId, error })
    return NextResponse.json(
      { ok: false, error: 'Inbound mail engine failed.', code: 'inbound_mail_processing_failed', trace_id: traceId },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
