import { NextRequest, NextResponse } from 'next/server'
import { runInboundEdielMailEngine } from '@/lib/inbound-mail/edielMailboxPoller'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.EDIEL_INBOUND_CRON_SECRET ?? process.env.CRON_SECRET
  if (!configuredSecret) return process.env.NODE_ENV !== 'production'

  const authorization = request.headers.get('authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  const headerSecret = request.headers.get('x-cron-secret')
  const querySecret = request.nextUrl.searchParams.get('secret')

  return bearer === configuredSecret || headerSecret === configuredSecret || querySecret === configuredSecret
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const environment = request.nextUrl.searchParams.get('environment')
  const result = await runInboundEdielMailEngine({ environment })
  return NextResponse.json({ ok: true, result })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
