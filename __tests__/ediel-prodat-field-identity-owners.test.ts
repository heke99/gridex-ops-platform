import {it,expect,vi} from 'vitest'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {input,characteristic,raw,line} from './fixtures/prodat-register'
import {deathRaw,deathBody,deathSelection} from './fixtures/prodat-death-status'
import {payload as gasPayload} from './fixtures/prodat-gas'
import {source,head,own} from './fixtures/prodat-identity'
import type {ProdatDependentConditionFacts} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw Error('UNEXPECTED_DB')}}}))
function check(wire:string,code:string,subtype:string,fields:string[],facts?:ProdatDependentConditionFacts){
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:subtype,direction:'inbound',referenceDate:'2026-09-19',applicationReference:['Z13','Z15'].includes(code)?'23-DGI-PRODAT':'23-DDQ-PRODAT',mode:'catalog_evidence',prodatDependentFacts:facts})
 const issues=validateCanonicalPolicyFields({policy:{...policy,fieldRules:policy.fieldRules.filter(r=>'fieldNumber' in r&&fields.includes(r.fieldNumber??''))},...input(wire,code)})
 return projectProdatDiagnostics(issues)
}
it('keeps owner310 supplied-content42 under local U and ignores independently false extras',()=>{
 const wire=deathRaw('Z06',deathBody('E34',characteristic('Z17','BAD')))
 const p=check(wire,'Z06','E',['310']);expect(p.disposition.kind).toBe('continue');expect(p.applicationErrors).toMatchObject([{ercCode:'42',fieldCode:'310',referenceNumber:'A',lineItemReference:'LI-A'}])
 expect(buildAperakDraft({sourceMessage:source(wire,'Z06'),outcome:'negative',applicationErrors:p.applicationErrors}).rawPayload).toContain('FTX+AAO++310::260')
 expect(check(wire,'Z06','E',['310'],{deathStatus:deathSelection('not_death')}).applicationErrors).toEqual([])
})
it('keeps GAS320 known required absence41 and present invalid42 independent of unqualified240',()=>{
 expect(check(gasPayload('Z04','Z22',[],'gas'),'Z04','L',['320','240']).applicationErrors).toMatchObject([{ercCode:'41',fieldCode:'320'}])
 expect(check(gasPayload('Z04','Z22',[['RFF',['Z08','X'.repeat(36)]]],'gas'),'Z04','L',['320','240']).applicationErrors).toMatchObject([{ercCode:'42',fieldCode:'320'}])
})
it('retains supplied reporting321 date identity through its specialized owner',()=>{
 const wire=raw([...head(),line('1','A'),['DTM',['91','202602300000','203']],...characteristic('Z13','S17'),['RFF',['LI','REPORT']]],'Z13')
 expect(check(wire,'Z13','V',['321']).applicationErrors).toMatchObject([{ercCode:'42',fieldCode:'321'}])
})
it('reports missing327 from its source descriptor rather than DTM164',()=>{
 const wire=raw([...head(),line('1','A'),['RFF',['LI','PERMISSION']]],'Z15')
 expect(check(wire,'Z15','C',['327']).applicationErrors).toMatchObject([{ercCode:'41',fieldCode:'327'}])
})
it('preserves known numeric invoicee errors beside a genuine aggregate parent hold',()=>{
 const party=['NAD','IV',['I','','89'],'','Invoicee','Street','City','','12 345','SE'] as const
 const wire=raw([...head(),...own('1','A','CASE'),[...party] as never,[...party] as never],'Z03'),p=check(wire,'Z03','L',['250','251','252','253','317','INVOICEE_GROUP'])
 expect(p.disposition.kind).toBe('internal_review');expect(p.applicationErrors).toEqual(expect.arrayContaining([expect.objectContaining({ercCode:'42',fieldCode:'253'})]))
})
it('keeps repeated-register topology258 and sequence314 distinct with exact own register',()=>{
 for(const [second,want] of [[line('2','A','3'),'258'],[line('7','A','2'),'314']] as const){
  const wire=raw([line('1','A','1'),['RFF',['LI','OWN']],second],'Z04'),p=check(wire,'Z04','L',['258','314'])
  expect(p.disposition.kind).toBe('continue');expect(p.applicationErrors).toEqual(expect.arrayContaining([expect.objectContaining({ercCode:'42',fieldCode:want,prodatOccurrence:expect.objectContaining({lineNumber:want==='314'?'7':'2',registerPosition:2,objectId:'A'})})]))
  const draft=buildAperakDraft({sourceMessage:source(wire,'Z04'),outcome:'negative',applicationErrors:p.applicationErrors})
  expect(draft.rawPayload).toContain(`FTX+AAO++${want}::260`);expect(draft.rawPayload).not.toContain('CACHED-UNRELATED')
 }
})
it('keeps qualifier faults on field310 with local U, not a generic unknown error',()=>{
 const wire=deathRaw('Z06',deathBody('E34',[['CCI','','Z17'],['CAV',['Z41','BAD','AGENCY']]])),p=check(wire,'Z06','E',['310'])
 expect(p.disposition.kind).toBe('continue');expect(p.applicationErrors).toMatchObject([{ercCode:'42',fieldCode:'310'}])
})
it('keeps exact LI and message identity separate for repeated object IDs in two messages',()=>{
 const one=deathRaw('Z06',deathBody('E34',characteristic('Z17','BAD')))
 const two=deathRaw('Z06',deathBody('E34',characteristic('Z17','BAD'))).replace('UNH+M+','UNH+SECOND+').replace('RFF+LI:LI-A','RFF+LI:OTHER').replace(/UNT\+([0-9]+)\+M/, 'UNT+$1+SECOND')
 const body=one.slice(0,one.indexOf('UNZ'))+two.slice(two.indexOf('UNH'))
 const p=check(body,'Z06','E',['310'])
 expect(p.applicationErrors.map(e=>[e.prodatOccurrence?.messageReference,e.lineItemReference])).toEqual([['M','LI-A'],['SECOND','OTHER']])
})
it('keeps the unrepresented zero-date alternative internal without choosing210 or211',()=>{
 const wire=raw([line('1','A'),...characteristic('Z13','Z70'),['RFF',['LI','CASE']]],'Z09'),p=check(wire,'Z09','D',['210','211'])
 expect(p.disposition.kind).toBe('internal_review');expect(p.applicationErrors).toEqual([])
})
