import {prodatFieldDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {projectProdatRegisterValidation, type ProdatRegisterValidationEvidence} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import {describe, expect, it} from 'vitest'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {input, raw, line, characteristic, qty} from './fixtures/prodat-register'

const policy = () => resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z04',subtypeOrReasonCode:'L',direction:'inbound',referenceDate:'2026-09-17',applicationReference:'23-DDQ-PRODAT',bilateralCapabilityVerified:true,mode:'parse',prodatDependentFacts:{market:'electricity',meterReadingsSentInUtilts:false}})
function assess(payload: string, override = {}) {
  let evidence: ProdatRegisterValidationEvidence | undefined
  const wire = input(payload)
  const resolved = {...policy(), ...override}
  const issues = validateCanonicalPolicyFields({policy:resolved,...wire,onRegisterValidation:(value:ProdatRegisterValidationEvidence) => {evidence=value}})
  if (!evidence) throw new Error('canonical register evidence missing')
  return {evidence,issues}
}
const reason = characteristic('Z13','Z22')
describe('actual canonical register validation evidence', () => {
  it('accepts register facet despite unrelated canonical field errors and preserves returned issues', () => {
    const payload = raw([line('1','A'),...reason,qty('10')])
    const {evidence,issues} = assess(payload)
    expect(issues.length).toBeGreaterThan(0)
    expect(evidence).toMatchObject({version:1,owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:[{messageIndex:0,messageReference:'M',objectId:'A',identityAgency:'89',disposition:'accepted',registers:[{lineIndex:0,lineNumber:'1',registerIndex:null,registerPosition:1,segmentIndex:5}]}]})
    expect(issues).toEqual(validateCanonicalPolicyFields({policy:policy(),...input(payload)}))
  })
  it('rejects only the exact physical object whose repeated own quantity is absent', () => {
    const {evidence} = assess(raw([line('1','A','1'),...reason,qty('10'),line('2','A','2'),line('3','A',undefined,'9'),...reason,qty('20')]))
    expect(evidence.objects.map((o)=>[o.objectId,o.identityAgency,o.disposition,o.registers.length])).toEqual([['A','89','rejected',2],['A','9','accepted',1]])
  })
  it('never accepts later messages the register validator did not validate', () => {
    const first = input(raw([line('1','A'),...reason,qty('10')])).rawSegments
    const second = input(raw([line('1','B'),...reason,qty('20')])).rawSegments
    const payload = [...first.slice(0,-1),...second.slice(1)].join("'")+"'"
    const {evidence} = assess(payload)
    expect(evidence.objects.map((o)=>[o.messageIndex,o.objectId,o.disposition])).toEqual([[0,'A','accepted'],[1,'B','unavailable']])
  })
  it('leaves unknown unscoped register conditions unavailable', () => {
    const {evidence} = assess(raw([line('1','A'),...reason,qty('10')]),{prodatDependentFacts:{market:'electricity'}})
    expect(evidence.objects[0].disposition).toBe('unavailable')
  })
  it('rejects malformed repeated register numbering', () => {
    const {evidence} = assess(raw([line('1','A','1'),...reason,qty('10'),line('2','A','1'),qty('20')]))
    expect(evidence.objects[0].disposition).toBe('rejected')
  })
})

it('actual runtime exposes the direct facet and leaves syntax-rejected runs without it', () => {
  const message = {direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z04',
    raw_payload:raw([line('1','A'),...reason,qty('10')]),created_at:'2026-09-17T12:00:00Z',
    parsed_payload:{prodatDependentFacts:{meterReadingsSentInUtilts:false}},validation_report:{}} as unknown as EdielMessageRow
  const decision = resolveCanonicalRuntimeDecision(message)
  expect(decision.applicationDecision).toBe('rejected')
  expect(decision.prodatRegisterValidation?.objects[0].disposition).toBe('accepted')
  const bad = resolveCanonicalRuntimeDecision({...message,raw_payload:message.raw_payload!.replace('UNT+9','UNT+999')})
  expect(bad.syntaxDecision).toBe('rejected')
  expect(bad.prodatRegisterValidation).toBeUndefined()
})
it('does not certify a partial register rule selection', () => {
  const resolved = policy()
  const {evidence} = assess(raw([line('1','A'),...reason,qty('10')]),{fieldRules:resolved.fieldRules.filter(rule=>rule.fieldNumber==='258')})
  expect(evidence.objects[0].disposition).toBe('unavailable')
})
it('does not certify dependent-only validation as complete register checks', () => {
  let evidence: ProdatRegisterValidationEvidence | undefined
  validateCanonicalPolicyFields({policy:policy(),...input(raw([line('1','A'),...reason,qty('10')])),scope:'dependent_only',onRegisterValidation:value=>{evidence=value}})
  expect(evidence?.objects[0].disposition).toBe('unavailable')
})

it('unscoped or malformed direct register findings cannot certify unrelated objects', () => {
  const wire=input(raw([line('1','A'),...reason,qty('10'),line('2','B'),...reason,qty('20')]))
  const diagnostic=prodatFieldDiagnostic('213','missing',wire,[],'PRODAT26A:P47/114–116',0)
  if(diagnostic.kind!=='field')throw new Error('fixture missing own diagnostic')
  for(const finding of [undefined,{...diagnostic,occurrence:{...diagnostic.occurrence,objectId:'FOREIGN'}},
    {...diagnostic,occurrence:{...diagnostic.occurrence,messageReference:'OTHER'}}]) {
    const evidence=projectProdatRegisterValidation({...wire,completeRuleSelection:true,handledFields:new Set(['213']),fieldIssues:[],
      registerIssues:[{code:'REGISTER_TEST_FAILURE',severity:'error',blocking:true,title:'Test',description:'Test',prodatDiagnostic:finding} as EdielRulebookIssue]})
    expect(evidence.objects.map(object=>object.disposition)).toEqual(['unavailable','unavailable'])
  }
})
it('missing physical identity never gets an accepted register facet', () => {
  expect(assess(raw([line('1',''),...reason,qty('10')])).evidence.objects[0].disposition).toBe('unavailable')
})
it('retains decoded identity, exact agency and physical indexes with custom UNA', () => {
  const {evidence}=assess(raw([line('1','A;*B'),...reason,qty('10')],'Z04',['*',';','!','~']))
  expect(evidence.objects[0]).toMatchObject({objectId:'A;*B',identityAgency:'89',disposition:'accepted',registers:[{lineIndex:0,segmentIndex:5}]})
})
