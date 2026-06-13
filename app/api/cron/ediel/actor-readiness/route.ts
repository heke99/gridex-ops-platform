// This cron route is used to trigger the actor readiness process, which checks if actors are ready to send messages based on their certificates and other criteria.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.EDIEL_ACTOR_READINESS_CRON_SECRET ?? process.env.EDIEL_INBOUND_CRON_SECRET ?? process.env.CRON_SECRET
  if (!configuredSecret) return false

  const authorization = request.headers.get('authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  const headerSecret = request.headers.get('x-cron-secret')

  return bearer === configuredSecret || headerSecret === configuredSecret
}

function parseMode(value: string | null): 'full' | 'certificates' | 'apply' {
  if (value === 'certificates' || value === 'apply' || value === 'full') return value
  return 'full'
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const mode = parseMode(request.nextUrl.searchParams.get('mode'))

  try {
    const operations = await import('@/lib/ediel/operations/actorAutoReadiness')
    const result = mode === 'certificates'
      ? await operations.refreshActorCertificateStatuses('certificate_refresh')
      : mode === 'apply'
        ? await operations.applyActorAutoSendReadiness()
        : await operations.runFullActorAutoReadiness()

    return NextResponse.json({ ok: true, mode, result })
  } catch (error) {
    console.error('[actor-readiness-cron] Run failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Actor readiness run failed' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
