import {prodatFieldDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import {resolveCanonicalRuntimeDecision,resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {projectProdatRegisterValidation, type ProdatRegisterValidationEvidence} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import {describe, expect, it,vi,beforeEach} from 'vitest'
const io=vi.hoisted(()=>({database:null as ReturnType<typeof prodatOwnSourceReadingFixtureDatabase>|null}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(name:string,args:Record<string,unknown>)=>io.database!.rpc(name,args),from:(table:string)=>io.database!.from(table)}}))
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {input, raw, line, characteristic, qty} from './fixtures/prodat-register'
import {createProdatOwnSourceReadingSdk,resetProdatOwnSourceReadingSdk,installProdatOwnSourceReadingFixture,withProdatOwnSourceReadings,prodatOwnSourceReadingMessage,prodatOwnSourceReadingActor} from './helpers/prodatOwnSourceReadingFixture'
import {prodatOwnSourceReadingFixtureDatabase,finiteProdatRulePack} from './helpers/prodatOwnSourceReadingAdapter'
const reads=createProdatOwnSourceReadingSdk()
beforeEach(()=>{resetProdatOwnSourceReadingSdk(reads);io.database=prodatOwnSourceReadingFixtureDatabase(reads,()=>[finiteProdatRulePack('Z04','L','Z22')])})

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
  it('keeps the field 209 length boundary local to each agency-qualified object', () => {
    const validId = 'A'.repeat(25)
    const invalidId = 'B'.repeat(26)
    const { evidence, issues } = assess(raw([
      line('1', validId, undefined, '9'), ...reason, qty('10'),
      line('2', invalidId, undefined, '89'), ...reason, qty('20'),
    ]))
    expect(evidence.objects.map((object) => [object.objectId, object.identityAgency, object.disposition])).toEqual([
      [validId, '9', 'accepted'], [invalidId, '89', 'rejected'],
    ])
    expect(issues.some((issue) => issue.blocking && JSON.stringify(issue).includes(invalidId))).toBe(true)
  })
  it('takes field 213 unit market from electric UNB, not a contradictory caller fact', () => {
    const payload = raw([line('1','A'), ...reason, ['QTY',['31','20','MTQ']]])
    const { evidence, issues } = assess(payload, {prodatDependentFacts:{market:'gas',meterReadingsSentInUtilts:false}})
    expect(issues).toContainEqual(expect.objectContaining({code:'PRODAT_REGISTER_QUANTITY_UNIT_INVALID',blocking:true,
      prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'213',failureEvidence:[expect.objectContaining({content:'MTQ'})]})}))
    expect(evidence.objects[0].disposition).toBe('rejected')
  })
})

it('actual runtime exposes the direct facet and leaves syntax-rejected runs without it', async () => {
  const message=prodatOwnSourceReadingMessage(withProdatOwnSourceReadings(raw([line('1','A'),qty('10'),...reason]),{addLegalHeader:true}))
  installProdatOwnSourceReadingFixture(reads,message,'L',{actorUserId:prodatOwnSourceReadingActor,receivedAt:message.message_received_at!,mailId:message.inbound_email_message_id!,parseId:'00000000-0000-4000-8000-000000000005',receptionId:'00000000-0000-4000-8000-000000000006',legalActorId:'00000000-0000-4000-8000-000000000008'})
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:prodatOwnSourceReadingActor})
  expect(decision.applicationDecision).toBe('rejected')
  expect(decision.prodatRegisterValidation?.objects[0].disposition).toBe('accepted')
  const bad = resolveCanonicalRuntimeDecision({...message,raw_payload:message.raw_payload!.replace(/UNT\+\d+/,'UNT+999')})
  expect(bad.syntaxDecision).toBe('rejected')
  expect(bad.prodatRegisterValidation).toBeUndefined()
})
it('does not certify a partial register rule selection', () => {
  const resolved = policy()
  const {evidence} = assess(raw([line('1','A'),...reason,qty('10')]),{fieldRules:resolved.fieldRules.filter(rule=>'fieldNumber' in rule && rule.fieldNumber==='258')})
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
