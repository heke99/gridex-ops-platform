import {describe,it,expect} from 'vitest'
import {copyProdatRegisterFacts,resolveProdatRegisterConditionFacts} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {resolveProdatDependentCondition} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {canonicalProdat26AFieldRules} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {meterChange,changeBody,changeFields,changeRaw} from './fixtures/prodat-meter-change'
import {alphabets,characteristic,line} from './fixtures/prodat-register'
import type {ProdatDependentConditionFacts} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
const facts = (selection = meterChange()) => ({market:'electricity',meterChange:selection}) as ProdatDependentConditionFacts
function check(direction:'inbound'|'outbound', payload:string, f?:ProdatDependentConditionFacts){
 const wire=tokenizeEdifact(payload),policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z10',subtypeOrReasonCode:'M',direction,referenceDate:'2026-09-19',applicationReference:'23-DDQ-PRODAT',mode:'catalog_evidence',prodatDependentFacts:f})
 return validateCanonicalPolicyFields({policy:{...policy,fieldRules:canonicalProdat26AFieldRules('Z10').filter(r=>['254','242'].includes(r.fieldNumber??''))},rawSegments:wire.segments.map(s=>s.raw),una:wire.una})
}
const blocked=(issues:ReturnType<typeof check>)=>issues.filter(i=>i.blocking||i.severity==='error')
describe('Z10 independent facts',()=>{
 it('copies the complete selection without nested aliases or conflating regime and assessment revisions',()=>{
  const s=meterChange(), copied=copyProdatRegisterFacts(facts(s))
  expect(copied).toHaveProperty('meterChange',s)
  s.objects[0].newMeter.number='MUTATED'
  expect(copied.meterChange?.objects[0].newMeter.number).toBe('NEW-A')
  expect(resolveProdatRegisterConditionFacts(facts()).meterChange).toEqual(meterChange())
 })
 it.each(['254','242'])('rejects root byCell %s authority',field=>{
  for(const flag of [true,false])expect(resolveProdatDependentCondition({messageCode:'Z10',fieldNumber:field,facts:{market:'electricity',byCell:{[`Z10:${field}`]:flag}}})?.status).toBe('undetermined')
 })
 it('rejects malformed provenance, aliases and unrelated event revisions',()=>{
  for(const mutate of [
   (s:ReturnType<typeof meterChange>)=>{delete (s.objects[0] as Partial<typeof s.objects[0]>).customer},
   (s:ReturnType<typeof meterChange>)=>{s.objects[0].event.revision='stale'},
   (s:ReturnType<typeof meterChange>)=>{s.objects[0].newMeterThreshold={kind:'unknown',below:false} as never},
   (s:ReturnType<typeof meterChange>)=>{s.objects[0].oldMeter.number=s.objects[0].newMeter.number},
   (s:ReturnType<typeof meterChange>)=>{if(s.objects[0].newMeterThreshold.kind!=='unknown')s.objects[0].newMeterThreshold.regime.revision='wrong-regime'},
  ]){const s=meterChange();mutate(s);expect(()=>copyProdatRegisterFacts(facts(s))).toThrow()}
 })
 it('computes true OR unknown, false only with both false, and own product change',()=>{
  const s=meterChange(true);s.objects[0].newMeterThreshold={kind:'unknown'}
  expect(resolveProdatDependentCondition({messageCode:'Z10',fieldNumber:'254',facts:facts(s)})?.status).toBe('required')
  expect(resolveProdatDependentCondition({messageCode:'Z10',fieldNumber:'242',facts:facts(s)})?.status).toBe('required')
  expect(resolveProdatDependentCondition({messageCode:'Z10',fieldNumber:'254',facts:facts()})?.status).toBe('not_required')
  s.objects[0].oldMeter.settlement={kind:'unknown'}
  expect(resolveProdatDependentCondition({messageCode:'Z10',fieldNumber:'254',facts:facts(s)})?.status).toBe('undetermined')
 })
})
for(const alphabet of alphabets)describe(`Z10 applicability ${alphabet.join('')}`,()=>{
 it('does not turn incoming local U into two blocking missing-field errors',()=>expect(blocked(check('inbound',changeRaw(changeBody(),alphabet)))).toEqual([]))
 it('ignores even invalid extra selected content under independently false conditions',()=>expect(blocked(check('inbound',changeRaw(changeBody(changeFields('BAD','INVALID')),alphabet),facts()))).toEqual([]))
 it('checks p122 supplied codes under U with independent EL and occurrence scope',()=>expect(blocked(check('inbound',changeRaw(changeBody(changeFields('BAD','INVALID')),alphabet))).length).toBeGreaterThan(0))
 it('requires independently true fields and keeps unknown output unsendable',()=>{
  expect(blocked(check('inbound',changeRaw(changeBody(),alphabet),facts(meterChange(true)))).length).toBeGreaterThan(0)
  expect(blocked(check('outbound',changeRaw(changeBody(changeFields()),alphabet)) ).length).toBeGreaterThan(0)
 })
 it('permits false outgoing omission, but checks independently known supplied new values',()=>{
  expect(blocked(check('outbound',changeRaw(changeBody(),alphabet),facts()))).toEqual([])
  expect(blocked(check('outbound',changeRaw(changeBody(changeFields()),alphabet),facts())).length).toBeGreaterThan(0)
  expect(blocked(check('outbound',changeRaw(changeBody(changeFields('Z31','L917')),alphabet),facts()))).toEqual([])
 })
 it('does not borrow another object or later register to determine first-register facts',()=>{
  expect(blocked(check('outbound',changeRaw([...changeBody(changeFields()),...changeBody(changeFields(),'B','2')],alphabet),facts(meterChange(true)))).length).toBeGreaterThan(0)
 })
})

for(const alphabet of alphabets)describe(`precise isolation and applicability ${alphabet.join('')}`,()=>{
 it('true missing fields have selected REQUIRED errors, never a generic local U',()=>{
  const issues=check('inbound',changeRaw(changeBody(),alphabet),facts(meterChange(true)))
  expect(issues.map(i=>[i.code,i.fieldPath])).toEqual(expect.arrayContaining([
   ['PRODAT_METER_CHANGE_REQUIRED','CCI++Z15/CAV'],['PRODAT_METER_CHANGE_REQUIRED','CCI++Z14/CAV']]))
 })
 it('U invalid supplied fields have specific field errors, not missing authority',()=>{
  const issues=check('inbound',changeRaw(changeBody(changeFields('BAD','INVALID')),alphabet))
  expect(issues.map(i=>i.code)).toContain('PRODAT_METER_CHANGE_FIELD_INVALID')
  expect(issues.some(i=>i.code.includes('UNDETERMINED')&&i.blocking)).toBe(false)
 })
 it('unknown compatibility stays diagnostic; independently applicable compatibility blocks',()=>{
  const payload=changeRaw(changeBody(changeFields('Z32','L917')),alphabet)
  expect(blocked(check('inbound',payload))).toEqual([])
  expect(check('inbound',payload)).toEqual(expect.arrayContaining([expect.objectContaining({code:'PRODAT_METER_CHANGE_COMPATIBILITY',blocking:false})]))
  expect(blocked(check('inbound',payload,facts(meterChange(true))))).toEqual(expect.arrayContaining([expect.objectContaining({code:'PRODAT_METER_CHANGE_COMPATIBILITY'})]))
 })
 it('invalid reason or unknown market cannot establish occurrence from selected contents',()=>{
  for(const payload of [changeRaw(changeBody(changeFields('BAD','INVALID')),alphabet).replace('E58','BAD'),changeRaw(changeBody(changeFields('BAD','INVALID')),alphabet).replace('23-DDQ-PRODAT','27-DDQ-PRODAT')]){
   expect(blocked(check('inbound',payload))).toEqual([])
   expect(check('inbound',payload)).toEqual(expect.arrayContaining([expect.objectContaining({code:'PRODAT_METER_CHANGE_SCOPE_UNDETERMINED',blocking:false})]))
  }
 })
 it('first-register true cannot be satisfied by a later repeat, which cannot override false either',()=>{
  const first=changeBody();first[0]=line('1','A','1')
  const later=[line('2','A','2'),...changeFields()]
  expect(check('outbound',changeRaw([...first,...later],alphabet),facts(meterChange(true))).map(i=>i.code)).toContain('PRODAT_METER_CHANGE_REQUIRED')
  expect(blocked(check('inbound',changeRaw([...first,line('2','A','2'),...changeFields('BAD','INVALID')],alphabet),facts()))).toEqual([])
 })
 it('released protocol-looking references cannot create fields or a different event',()=>{
  const s=meterChange(true);s.objects[0].li="EVENT+CCI:Z15?UNH'BGM+Z10"
  const body=changeBody(changeFields());body[body.length-1]=['RFF',['LI',s.objects[0].li]]
  expect(blocked(check('outbound',changeRaw(body,alphabet),facts(s)))).toEqual([])
  const wrong=structuredClone(s);wrong.objects[0].li='OTHER'
  expect(check('outbound',changeRaw(body,alphabet),facts(wrong)).map(i=>i.code)).toContain('PRODAT_METER_CHANGE_CONTEXT_MISMATCH')
 })
 it('known false optional outgoing content still receives supplied compatibility checks',()=>{
  const body=changeBody([...characteristic('Z15','Z31'),...characteristic('Z14','L917',3)])
  const malformed=changeRaw(body,alphabet).replace(`CAV${alphabet[1]}Z04${alphabet[3]}`,`CAV${alphabet[1]}Z03${alphabet[3]}`)
  expect(check('outbound',malformed,facts()).map(i=>i.code)).toContain('PRODAT_METER_CHANGE_COMPATIBILITY')
 })
})
it('ignored settlement cannot suppress a separately applicable product/method incompatibility',()=>{
 const s=meterChange(true);s.objects[0].newMeter.settlement={kind:'known',value:'Z31',evidence:{key:'new-settlement',revision:'assessment-2',eventKey:'replacement-A',reference:'independent:new-settlement'}}
 const payload=changeRaw(changeBody(changeFields('IGNORED','L639Q'))).replace('CAV+Z04','CAV+Z03')
 expect(blocked(check('inbound',payload,facts(s)))).toEqual(expect.arrayContaining([expect.objectContaining({code:'PRODAT_METER_CHANGE_COMPATIBILITY',fieldPath:'CCI++Z14/CAV'})]))
 expect(blocked(check('inbound',payload,facts(s))).some(i=>i.fieldPath==='CCI++Z15/CAV')).toBe(false)
})
