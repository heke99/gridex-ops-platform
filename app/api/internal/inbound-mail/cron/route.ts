// app/api/internal/inbound-mail/cron/route.ts
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.EDIEL_INBOUND_CRON_SECRET ?? process.env.CRON_SECRET
  if (!configuredSecret) return false

  const authorization = request.headers.get('authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  const headerSecret = request.headers.get('x-cron-secret')

  return bearer === configuredSecret || headerSecret === configuredSecret
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
    console.error('[inbound-mail-cron] Run failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Inbound mail engine failed',
      },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
