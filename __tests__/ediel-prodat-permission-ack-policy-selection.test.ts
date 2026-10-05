import {expect,it} from 'vitest'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {permissionAckFieldsFromPayload} from '@/lib/ediel/prodat/prodatPermissionAckFields'
import {permissionAckMessage as message,permissionAckObject as object,characteristic,alphabets} from './fixtures/prodat-permission-ack'

const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z15',subtypeOrReasonCode:'V',direction:'inbound',referenceDate:'2026-09-20',applicationReference:'23-DGI-PRODAT',mode:'catalog_evidence'})
function assess(rawPayload:string|null,field:string){
 const wire=tokenizeEdifact(rawPayload??'')
 return validateCanonicalPolicyFields({policy:{...policy,fieldRules:policy.fieldRules.filter(r=>'fieldNumber' in r&&r.fieldNumber===field)},rawSegments:wire.segments.map(t=>t.raw),una:wire.una})
}
for(const field of ['322','324']){
 const qualifier=field==='322'?'Z23':'Z25',value=field==='322'?'A74':'B79',other=field==='322'?'324':'322'
 for(const placement of ['duplicate','header','late','text'] as const)it(`partial ${other} excludes ${field} ${placement} but selected and full assessments retain hold`,()=>{
  const body=object('Z15','S17','A74','B79')
  if(placement==='header')body.unshift(...characteristic(qualifier,value))
  else if(placement==='late')body.push(...characteristic(qualifier,value))
  else if(placement==='duplicate')body.splice(1,0,...characteristic(qualifier,value))
  const m=message('Z15','S17','A74','B79',alphabets[0],body)
  if(placement==='text')m.raw_payload=m.raw_payload!.replace(`CAV+${value}`,`CAV+${'X'.repeat(80)}`)
  expect(assess(m.raw_payload,other)).toEqual([])
  expect(assess(m.raw_payload,field).some(i=>i.blocking)).toBe(true)
  expect(permissionAckFieldsFromPayload(m.raw_payload).disposition.kind).toBe('internal_review')
 })
 it(`partial ${field} valid control`,()=>expect(assess(message('Z15').raw_payload,field)).toEqual([]))
 for(const scope of ['bgm','no-lin'] as const)it(`partial ${field} retains shared ${scope} ambiguity`,()=>{
  const m=message('Z15','S17','A74','B79',alphabets[0],scope==='no-lin'?[]:undefined)
  if(scope==='bgm')m.raw_payload=m.raw_payload!.replace('BGM+Z15+D+9+AB',"BGM+Z15+D+9+AB'BGM+Z18+D2+9+AB")
  expect(assess(m.raw_payload,field)).toEqual(expect.arrayContaining([expect.objectContaining({code:'PRODAT_PERMISSION_ACK_SCOPE_UNQUALIFIED',blocking:true,prodatDiagnostic:expect.objectContaining({kind:'internal'})})]))
 })
}
