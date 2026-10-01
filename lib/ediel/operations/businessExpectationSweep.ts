import { readEdielBusinessExpectations, expireEdielBusinessExpectations } from '@/lib/ediel/businessExpectations'
import { supabaseService } from '@/lib/supabase/service'
import {readEdielMeteringMethodExpectations,expireEdielMeteringMethodExpectations} from '@/lib/ediel/meteringMethodExpectations'
import type {EdielBusinessExpectation} from '@/lib/ediel/businessExpectations'

/** Sweep only the automation actor's accepted memberships. Each operation
 * repeats authorization in the source-owner RPC; a clock never sends a message. */
export async function sweepEdielBusinessExpectations(input: { actorUserId: string; limit?: number }) {
  if (!input.actorUserId) throw new Error('ediel_expectation_sweep_actor_required')
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 100)
  const memberships = await supabaseService.from('company_memberships').select('company_id')
    .eq('user_id', input.actorUserId).eq('status', 'active').eq('is_active', true)
    .not('accepted_at', 'is', null).order('company_id', { ascending: true }).limit(201)
  if (memberships.error) throw memberships.error
  const companies = [...new Set((memberships.data ?? []).flatMap(row => typeof row.company_id === 'string' ? [row.company_id] : []))]
  // Do not silently visit only an arbitrary prefix of a larger actor scope.
  if (companies.length > 200) throw new Error('ediel_expectation_sweep_scope_limit')
  const result = { scopes: 0, observed: 0, manualReview: 0, fulfilled: 0, rejected: 0,
    blocked: [] as Array<{ companyId: string; environment: 'test' | 'production'; operation: 'read' | 'expire'; reason: string }> }
  for (const companyId of companies) {
    for (const environment of ['test', 'production'] as const) {
      const scope = { actorUserId: input.actorUserId, companyId, environment, limit }
      const observations=new Map<string,EdielBusinessExpectation>()
      let visited=false
      for(const owner of [{read:readEdielBusinessExpectations,expire:expireEdielBusinessExpectations},
        {read:readEdielMeteringMethodExpectations,expire:expireEdielMeteringMethodExpectations}]) {
       let operation: 'read' | 'expire' = 'read'
       try {
        // Each source owner reconciles its own committed responses and calendar.
        // Failure in one independent watch does not suppress the other sweep.
        await owner.read(scope)
        operation = 'expire'
        const rows = await owner.expire(scope)
        visited=true
        for(const row of rows)observations.set(row.id,row)
       } catch (error) {
        result.blocked.push({ companyId, environment, operation,
          reason: error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : 'ediel_expectation_sweep_failed' })
       }
      }
      if(visited) {
        const rows=[...observations.values()]
        result.scopes += 1
        result.observed += rows.length
        result.manualReview += rows.filter(row => row.status === 'manual_review').length
        result.fulfilled += rows.filter(row => row.status === 'fulfilled').length
        result.rejected += rows.filter(row => row.status === 'rejected').length
      }
    }
  }
  return result
}
