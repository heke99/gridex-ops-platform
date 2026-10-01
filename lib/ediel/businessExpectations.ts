import { parseCanonicalMessageRow } from '@/lib/ediel/core/canonicalMessage'
import { canonicalDeadlineForMessage, canonicalProdatSubtypeForMessage, canonicalZ01BusinessResponseDeadlineMinutesProjection } from '@/lib/ediel/rulebook/canonicalEdielFacade'
import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'

export type EdielBusinessExpectationPlan = Readonly<{
  version: 1; sourceCode: 'Z01' | 'Z13' | 'Z18'; expectedFamily: 'PRODAT'; expectedCode: string;
  expectedSubtypes: readonly string[]; timerRuleId: string | null; offset: number | null; unit: 'minutes' | 'calendar_days' | null;
  anchor: 'actual_accepted_smtp_observed_at'; timerKind: 'internal_sender_watch' | 'untimed_business_response'; remoteReceiptKnown: false;
  deadlineSource: unknown; policy: { guideRevision: string; referenceDate: string; profileKey: string | null; sourceTrace: CanonicalEdielPolicy['sourceTrace'] };
}>

/** Prepare once from the chosen canonical policy, before SMTP. The journal must
 * seal this projection; registration never resolves a different later policy. */
export function prepareEdielBusinessExpectationPlan(message: EdielMessageRow, policy: CanonicalEdielPolicy): EdielBusinessExpectationPlan | null {
  const canonical = parseCanonicalMessageRow(message)
  if (canonical.family !== 'PRODAT' || !['Z01', 'Z13', 'Z18'].includes(canonical.messageCode ?? '')) return null
  if (message.direction !== 'outbound' || policy.direction !== 'outbound' || policy.family !== 'PRODAT'
    || policy.code !== canonical.messageCode || policy.subtype !== canonicalProdatSubtypeForMessage(canonical.messageCode ?? '', canonical.subtype)) throw new Error('ediel_expectation_policy_source_mismatch')
  const responses = policy.businessResponses.map(value => value.split(':')).filter(value => value[0] === 'PRODAT')
  const codes = [...new Set(responses.map(value => value[1]))]
  if (codes.length !== 1 || !codes[0]) throw new Error('ediel_expectation_source_response_missing')
  const expectedCode = codes[0]
  const expectedSubtypes = [...new Set(responses.flatMap(value => value[2] ? [value[2]] : []))]
  const deadline = canonicalDeadlineForMessage({ family: 'PRODAT', code: expectedCode, subtype: policy.subtype })
  const constraint = deadline?.constraints.find(value => value.kind === 'within_after' && (value.unit === 'minutes' || value.unit === 'calendar_days'))
  const offset = canonical.messageCode === 'Z01' ? canonicalZ01BusinessResponseDeadlineMinutesProjection() : constraint?.offset ?? null
  const unit = offset === null ? null : canonical.messageCode === 'Z01' ? 'minutes' : constraint?.unit === 'calendar_days' ? 'calendar_days' : 'minutes'
  return Object.freeze({ version: 1, sourceCode: canonical.messageCode as 'Z01' | 'Z13' | 'Z18', expectedFamily: 'PRODAT', expectedCode,
    expectedSubtypes: Object.freeze(expectedSubtypes), timerRuleId: canonical.messageCode === 'Z01' ? 'TM-Z02' : canonical.messageCode === 'Z13' ? 'TM-ESCO21' : null,
    offset, unit, anchor: 'actual_accepted_smtp_observed_at', timerKind: offset === null ? 'untimed_business_response' : 'internal_sender_watch', remoteReceiptKnown: false,
    deadlineSource: deadline?.source ?? null, policy: Object.freeze({ guideRevision: policy.guide.guideRevision, referenceDate: policy.referenceDate,
      profileKey: policy.profileKey, sourceTrace: policy.sourceTrace }) })
}

export type EdielBusinessExpectationScope = { companyId: string; environment: 'test' | 'production'; actorUserId: string }
export type EdielBusinessExpectation = { id: string; source_message_id: string; expected_code: string; due_at: string | null; status: string; metadata: Record<string, unknown> }
async function expectations(input: EdielBusinessExpectationScope & { action: 'register' | 'read' | 'expire'; messageId?: string; limit?: number }): Promise<EdielBusinessExpectation[]> {
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (name: 'gridex_ediel_business_expectations_v1', args: { p_input: Record<string, unknown> }) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  const { data, error } = await rpc('gridex_ediel_business_expectations_v1', { p_input: input })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('ediel_expectation_result_invalid')
  return data as EdielBusinessExpectation[]
}
export function registerEdielBusinessExpectations(input: EdielBusinessExpectationScope & { messageId: string }): Promise<EdielBusinessExpectation[]> {
  return expectations({ ...input, action: 'register' })
}
export function readEdielBusinessExpectations(input: EdielBusinessExpectationScope & { messageId?: string; limit?: number }): Promise<EdielBusinessExpectation[]> {
  return expectations({ ...input, action: 'read' })
}
export function expireEdielBusinessExpectations(input: EdielBusinessExpectationScope & { limit?: number }): Promise<EdielBusinessExpectation[]> {
  return expectations({ ...input, action: 'expire' })
}
