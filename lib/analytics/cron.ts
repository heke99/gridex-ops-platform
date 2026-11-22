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
  const eligibleCompanies = () => supabaseService
    .from('companies')
    .select('id')
    .in('status', ['active', 'onboarding'])

  // Fix the upper bound for this run so new companies cannot keep extending it.
  const { data: upperBound, error: upperBoundError } = await eligibleCompanies()
    .order('id', { ascending: false })
    .limit(1)
  if (upperBoundError) throw upperBoundError
  if (!upperBound) throw new Error('The analytics company selection could not be read.')
  const lastEligibleId = upperBound[0]?.id as string | undefined
  if (!lastEligibleId) return []

  const companyIds: string[] = []
  let afterId: string | undefined
  while (afterId !== lastEligibleId) {
    const query = eligibleCompanies().lte('id', lastEligibleId).order('id', { ascending: true })
    const { data, error } = await (afterId ? query.gt('id', afterId) : query).limit(1000)
    if (error) throw error
    if (!data) throw new Error('The analytics company selection could not be read.')
    if (data.length === 0) break

    companyIds.push(...data.map((row) => row.id as string))
    afterId = companyIds.at(-1)
  }
  return companyIds
}
