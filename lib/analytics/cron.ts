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
  // Stay below the configured PostgREST max_rows=1000. A unique ID cursor
  // avoids offset shifts when earlier companies are removed or change status.
  const pageSize = 200
  const companyIds: string[] = []
  let afterId: string | null = null
  while (true) {
    let query = supabaseService
      .from('companies')
      .select('id')
      .in('status', ['active', 'onboarding'])
      .order('id', { ascending: true })
      .limit(pageSize)
    if (afterId) query = query.gt('id', afterId)
    const { data, error } = await query
    if (error) throw error
    const page = (data ?? []).map((row) => row.id as string)
    companyIds.push(...page)
    if (page.length < pageSize) return companyIds
    afterId = page[page.length - 1]
  }
}
