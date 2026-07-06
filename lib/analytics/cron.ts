import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'

function timingSafeEquals(candidate: string, secret: string): boolean {
  const left = Buffer.from(candidate)
  const right = Buffer.from(secret)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function isAnalyticsCronAuthorized(request: NextRequest): boolean {
  const secrets = [process.env.ANALYTICS_CRON_SECRET, process.env.CRON_SECRET]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
  if (secrets.length === 0) return false

  const authorization = request.headers.get('authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : null
  const headerSecret = String(request.headers.get('x-cron-secret') ?? '').trim() || null

  return [bearer, headerSecret].some((candidate) =>
    Boolean(candidate && secrets.some((secret) => timingSafeEquals(candidate, secret)))
  )
}

export async function listAnalyticsCompanyIds(): Promise<string[]> {
  // Governance uses companies.status (active/onboarding/paused/...). The
  // legacy is_active flag is not kept in sync and must not decide which
  // tenants get analytics.
  const { data, error } = await supabaseService
    .from('companies')
    .select('id')
    .in('status', ['active', 'onboarding'])
    .limit(1000)

  if (error) throw error
  return (data ?? []).map((row) => row.id as string)
}
