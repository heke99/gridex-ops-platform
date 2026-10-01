import {describe,expect,it} from 'vitest'
import {bindDeathStatusSourceContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {validateEdielMessageRowWithRulebook} from '@/lib/ediel/rulebook/validator'
import {preflightEdielMessageRow,preflightEdielPayload} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {deathBody,deathRaw,deathSelection} from './fixtures/prodat-death-status'
import {characteristic} from './fixtures/prodat-register'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'

function example(direction:'inbound'|'outbound'='outbound'){
 const code=direction==='outbound'?'Z09':'Z06'
 const rawPayload=deathRaw(code,deathBody('E34',characteristic('Z17','Z41')))
 const row={...energyHandoffMessage('2026-10-01','company-A'),id:'source-A',direction,
  message_family:'PRODAT' as const,message_code:code,raw_payload:rawPayload,intent_id:'intent-A',communication_route_id:'route-A'}
 const basis={kind:'customer_life_event' as const,companyId:'company-A',environment:'test' as const,rawPayload,
  sourceEventId:'event-A',sourceRevision:'2',sourceDigest:'a'.repeat(64),businessContext:'death' as const,
  bilateralCapabilityVerified:false,selection:deathSelection('death',code)}
 const context=bindDeathStatusSourceContext(direction==='outbound'
  ? {...basis,direction:'outbound',code:'Z09',intentId:'intent-A',routeId:'route-A'}
  : {...basis,direction:'inbound',code:'Z06',sourceMessageId:'source-A'})
 return {row,context}
}
describe('same independent life-event context reaches actual validation consumers',()=>{
 it('removes only the unqualified source hold across row/raw preflight and rulebook for the actual bound source',()=>{
  const {row,context}=example()
  expect(validateEdielMessageRowWithRulebook(row,'send').issues.map(i=>i.code)).toContain('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
  const qualified=validateEdielMessageRowWithRulebook(row,'send',undefined,undefined,undefined,context)
  expect(qualified.issues.map(i=>i.code)).not.toContain('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
  expect(qualified.issues.map(i=>i.code)).not.toContain('PRODAT_DEATH_STATUS_UNDETERMINED')
  for(const result of [preflightEdielMessageRow(row,'send',undefined,undefined,undefined,context),
   preflightEdielPayload({rawPayload:row.raw_payload,messageStandard:'edifact',mode:'send',companyId:row.company_id,deathStatusRow:row,deathStatusContext:context})])
   expect(result.issues.map(i=>i.code)).not.toContain('PRODAT_DEPENDENT_PREFLIGHT_PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
  // Other national mandatory fields in this reduced fixture remain checked.
  expect(qualified.issues.length).toBeGreaterThan(0)
 })
 it('passes an inbound independently classified source through the one original policy invocation',()=>{
  const {row,context}=example('inbound')
  const decision=resolveCanonicalRuntimeDecision(row,{deathStatusContext:context})
  expect(decision.policy?.prodatDependentFacts?.deathStatus).toEqual(context.selection)
  expect(decision.issues.map(i=>i.code)).not.toContain('PRODAT_DEATH_STATUS_UNDETERMINED')
 })
 it.each(['company_id','environment','intent_id','communication_route_id','raw_payload'] as const)('holds changed own %s rather than reusing another context',field=>{
  const {row,context}=example(),changed={...row,[field]:'different'}
  expect(()=>validateEdielMessageRowWithRulebook(changed,'send',undefined,undefined,undefined,context)).toThrow('customer_life_event_source_context_mismatch')
 })
 it('does not turn serialized selections or copied authority into an independent source',()=>{
  const {row,context}=example()
  expect(()=>validateEdielMessageRowWithRulebook(row,'send',undefined,undefined,undefined,{...context})).toThrow('customer_life_event_source_context_mismatch')
  expect(preflightEdielMessageRow({...row,parsed_payload:{deathStatus:context.selection,customer_event:'death'}},'send').issues.map(i=>i.code)).toContain('PRODAT_DEPENDENT_PREFLIGHT_PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
 })
 it('holds before source context evaluation when actual service syntax is rejected',()=>{
  const {row,context}=example('inbound')
  const decision=resolveCanonicalRuntimeDecision({...row,raw_payload:row.raw_payload.replace('UNT+','UNT+999')},{deathStatusContext:context})
  expect(decision.syntaxDecision).toBe('rejected');expect(decision.policy).toBeNull()
 })
})
