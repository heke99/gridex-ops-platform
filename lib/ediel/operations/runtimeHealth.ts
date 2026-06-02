import { supabaseService } from '@/lib/supabase/service'

export type RuntimeHealthStatus = 'healthy' | 'warning' | 'critical'

export async function recordSystemClockHealth(input?: {
  companyId?: string | null
  environmentType?: string | null
  referenceTimestamp?: string | null
  actorUserId?: string | null
}) {
  const now = new Date()
  const reference = input?.referenceTimestamp ? new Date(input.referenceTimestamp) : now
  const measuredOffsetMs = Number.isNaN(reference.getTime()) ? null : now.getTime() - reference.getTime()
  const absOffset = Math.abs(measuredOffsetMs ?? 0)
  const status: RuntimeHealthStatus =
    measuredOffsetMs === null ? 'warning' : absOffset > 120_000 ? 'critical' : absOffset > 30_000 ? 'warning' : 'healthy'

  const { data, error } = await supabaseService
    .from('ediel_runtime_health_checks')
    .insert({
      company_id: input?.companyId ?? null,
      environment_type: input?.environmentType ?? null,
      check_type: 'time_sync',
      status,
      measured_offset_ms: measuredOffsetMs,
      reference_source: input?.referenceTimestamp ? 'provided_reference' : 'runtime_clock',
      details: {
        serverTimestamp: now.toISOString(),
        referenceTimestamp: Number.isNaN(reference.getTime()) ? null : reference.toISOString(),
      },
      checked_by: input?.actorUserId ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function getLatestSystemClockHealth(input?: {
  companyId?: string | null
  environmentType?: string | null
}) {
  let query = supabaseService
    .from('ediel_runtime_health_checks')
    .select('*')
    .eq('check_type', 'time_sync')
    .order('checked_at', { ascending: false })
    .limit(1)

  if (input?.companyId) query = query.eq('company_id', input.companyId)
  if (input?.environmentType) query = query.eq('environment_type', input.environmentType)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}
