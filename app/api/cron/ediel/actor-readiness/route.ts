// This cron route triggers actor readiness and the durable certificate refresh recovery path.
import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { internalApiError } from '@/lib/http/apiError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.EDIEL_ACTOR_READINESS_CRON_SECRET ?? process.env.EDIEL_INBOUND_CRON_SECRET ?? process.env.CRON_SECRET
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

function parseMode(value: string | null): 'full' | 'certificates' | 'apply' | 'route_profiles' {
  if (value === 'certificates' || value === 'apply' || value === 'full' || value === 'route_profiles') return value
  return 'full'
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const mode = parseMode(request.nextUrl.searchParams.get('mode'))

  try {
    const operations = await import('@/lib/ediel/operations/actorAutoReadiness')
    const certificateRecovery = mode === 'full' || mode === 'certificates'
      ? await import('@/lib/ediel/certificates/scheduledRefreshRecovery')
          .then((module) => module.runScheduledCertificateRefreshRecovery({ limit: 50 }))
      : null

    const readinessResult = mode === 'certificates'
      ? await operations.refreshActorCertificateStatuses('certificate_refresh')
      : mode === 'apply'
        ? await operations.applyActorAutoSendReadiness()
        : mode === 'route_profiles'
          ? await operations.refreshRouteProfileProductionReadiness()
          : await operations.runFullActorAutoReadiness()

    return NextResponse.json({
      ok: true,
      mode,
      result: {
        certificate_refresh_recovery: certificateRecovery,
        actor_readiness: readinessResult,
      },
    })
  } catch (error) {
    return internalApiError({ context: 'actor-readiness-cron', error, code: 'actor_readiness_failed', message: 'Aktörsreadiness kunde inte köras.' })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
