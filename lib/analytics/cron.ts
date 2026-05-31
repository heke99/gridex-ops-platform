import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'

export function isAnalyticsCronAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.ANALYTICS_CRON_SECRET ?? process.env.CRON_SECRET
  if (!configuredSecret) return false
  const authorization = request.headers.get('authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  return bearer === configuredSecret || request.headers.get('x-cron-secret') === configuredSecret
}

export async function listAnalyticsCompanyIds(): Promise<string[]> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id')
    .eq('is_active', true)
    .limit(1000)

  if (error) throw error
  return (data ?? []).map((row) => row.id as string)
}
