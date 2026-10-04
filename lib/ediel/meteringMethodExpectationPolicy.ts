import {segmentComposite, tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {parseCanonicalMessageRow} from '@/lib/ediel/core/canonicalMessage'
import {canonicalDeadlineForMessage,canonicalProdatSubtypeForMessage} from '@/lib/ediel/rulebook/canonicalEdielFacade'
import type {CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type {EdielMessageRow} from '@/lib/ediel/types'

function methodWatchConstraints() {
  const deadline = canonicalDeadlineForMessage({family:'PRODAT',code:'Z06',subtype:'F'})
  const constraint = deadline?.constraints.find(value => value.kind === 'within_after'
    && value.condition === 'metering_method_change')
  if (!deadline || !constraint || constraint.unit !== 'calendar_days'
    || !Number.isSafeInteger(constraint.offset) || constraint.offset! <= 0) {
    throw new Error('ediel_metering_method_deadline_source_unavailable')
  }
  return Object.freeze({version:1 as const,ruleId:'TM-METHOD40' as const,sourceCode:'Z09' as const,
    expectedFamily:'PRODAT' as const,expectedCode:'Z06' as const,offset:constraint.offset!,unit:constraint.unit,
    anchor:'z09_validity_day' as const,timerKind:'source_validity_day_watch' as const,
    automaticResendAllowed:false as const,deadlineSource:deadline.source,constraint})
}

/** A projection of the sole canonical business deadline, also consumed by the
 * native generator. SMTP acceptance proves sending, never the timer anchor. */
export const EDIEL_METERING_METHOD_EXPECTATION_CONSTRAINTS = methodWatchConstraints()
export type EdielMeteringMethodExpectationPlan = Readonly<typeof EDIEL_METERING_METHOD_EXPECTATION_CONSTRAINTS & {
  sourceSubtype:'F'|'G';validityDay:string;
  policy:{guideRevision:string;referenceDate:string;profileKey:string|null;sourceTrace:CanonicalEdielPolicy['sourceTrace']}
}>

export function prepareEdielMeteringMethodExpectationPlan(message:EdielMessageRow,policy:CanonicalEdielPolicy):EdielMeteringMethodExpectationPlan|null {
  if (policy.family !== 'PRODAT' || policy.code !== 'Z09' || !['F','G'].includes(policy.subtype ?? '')) return null
  if (message.direction !== 'outbound' || policy.direction !== 'outbound'
    || message.message_family !== 'PRODAT' || message.message_code !== 'Z09') {
    throw new Error('ediel_metering_method_expectation_policy_source_mismatch')
  }
  const wire = tokenizeEdifact(message.raw_payload)
  const source = parseCanonicalMessageRow(message)
  if (canonicalProdatSubtypeForMessage('Z09',source.subtype) !== policy.subtype) {
    throw new Error('ediel_metering_method_expectation_policy_source_mismatch')
  }
  if (wire.segments.filter(value => value.tag === 'UNH').length !== 1
    || wire.segments.filter(value => value.tag === 'LIN').length !== 1
    || wire.segments.filter(value => value.tag === 'BGM').length !== 1
    || segmentComposite(wire.segments.find(value => value.tag === 'BGM')!,1,wire.una)[0] !== 'Z09'
    || segmentComposite(wire.segments.find(value => value.tag === 'UNH')!,2,wire.una)[0] !== 'PRODAT') {
    throw new Error('ediel_metering_method_expectation_own_message_required')
  }
  const lineIndex = wire.segments.findIndex(value => value.tag === 'LIN')
  const ownDates = wire.segments.slice(lineIndex).filter(value => value.tag === 'DTM'
    && segmentComposite(value,1,wire.una)[0] === '157').map(value => segmentComposite(value,1,wire.una))
  if (ownDates.length !== 1 || ownDates[0][2] !== '203' || !/^\d{12}$/.test(ownDates[0][1] ?? '')) {
    throw new Error('ediel_metering_method_expectation_validity_day_required')
  }
  const date = ownDates[0][1].slice(0,8),validityDay = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`
  if (new Date(`${validityDay}T00:00:00Z`).toISOString().slice(0,10) !== validityDay) {
    throw new Error('ediel_metering_method_expectation_validity_day_invalid')
  }
  return Object.freeze({...EDIEL_METERING_METHOD_EXPECTATION_CONSTRAINTS,sourceSubtype:policy.subtype as 'F'|'G',validityDay,
    policy:Object.freeze({guideRevision:policy.guide.guideRevision,referenceDate:policy.referenceDate,
      profileKey:policy.profileKey,sourceTrace:policy.sourceTrace})})
}
