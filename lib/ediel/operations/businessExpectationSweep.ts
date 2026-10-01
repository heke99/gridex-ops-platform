import { readEdielBusinessExpectations, expireEdielBusinessExpectations } from '@/lib/ediel/businessExpectations'
import { supabaseService } from '@/lib/supabase/service'
import { readEdielProcessNextActions, type EdielProcessNextAction } from './processNextAction'

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
    nextActions: [] as Array<{companyId:string;environment:'test'|'production';decision:EdielProcessNextAction}>,
    blocked: [] as Array<{ companyId: string; environment: 'test' | 'production'; operation: 'read' | 'expire' | 'project'; reason: string }> }
  for (const companyId of companies) {
    for (const environment of ['test', 'production'] as const) {
      const scope = { actorUserId: input.actorUserId, companyId, environment, limit }
      let operation: 'read' | 'expire' | 'project' = 'read'
      try {
        // Reading projects already committed business responses. Expiry is a
        // separate send-level authorization and only escalates pending watches.
        await readEdielBusinessExpectations(scope)
        operation = 'expire'
        const rows = await expireEdielBusinessExpectations(scope)
        result.scopes += 1
        result.observed += rows.length
        result.manualReview += rows.filter(row => row.status === 'manual_review').length
        result.fulfilled += rows.filter(row => row.status === 'fulfilled').length
        result.rejected += rows.filter(row => row.status === 'rejected').length
        operation='project'
        const sourceIds=rows.flatMap(row=>typeof row.source_message_id==='string'?[row.source_message_id]:[])
        // Timer output is display-only. An automation actor's send grant never
        // manufactures cases.write permission, provider entry or an auto-resend.
        const decisions=await readEdielProcessNextActions({...scope,messageIds:sourceIds,evaluatedAt:new Date().toISOString(),
          access:{canRead:true,canReview:false,canPrepare:false}})
        for(const decision of decisions.values())result.nextActions.push({companyId,environment,decision})
      } catch (error) {
        result.blocked.push({ companyId, environment, operation,
          reason: error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : 'ediel_expectation_sweep_failed' })
      }
    }
  }
  return result
}
