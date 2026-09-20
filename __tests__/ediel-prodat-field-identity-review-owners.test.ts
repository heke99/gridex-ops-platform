import {it,expect,vi} from 'vitest'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {raw,line,characteristic,type Parts} from '@/__tests__/fixtures/prodat-register'
import {head,own,source} from '@/__tests__/fixtures/prodat-identity'
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:async()=>({profileKey:'synthetic',sourceHash:'evidence',messageProfileId:'profile',rulePackId:'pack'})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw Error('UNEXPECTED_DB')}}}))
it('observes source-owned missing invoicee child in qualified actual Z03',async()=>{
 for(const name of ['Invoicee','']){
 const body:Parts[]=[...head(),...own('1','735123456789012345','CASE-A')];body.splice(6,0,...characteristic('Z04','Z01'));body.push(['NAD','Z02',['54321','160','SVK'],'','','','','','','SE'],['NAD','IV',['IVID','','89'],'',name,'Street','City','','12345','SE'])
 const wire=raw(body,'Z03'),msg=source(wire,'Z03'),d=await resolveCanonicalRuntimeDecisionWithRegistry(msg),p=d.responsePlan.find(p=>p.family==='APERAK')
 const draft=buildAperakDraft({sourceMessage:msg,outcome:p?.outcome === 'negative' ? 'negative' : 'positive',applicationErrors:p?.applicationErrors})
 if(name)expect(d.applicationDecision).toBe('accepted');else {expect(p?.applicationErrors?.map(e=>[e.ercCode,e.fieldCode])).toEqual([['41','251']]);expect(draft.rawPayload).toContain('FTX+AAO++251::260')}
 }
})
it('observes subtype owner metadata for error only in second physical LIN',async()=>{
 const body:Parts[]=[...head(),line('1','735123456789012345',undefined,'9'),...characteristic('Z13','E64'),...characteristic('Z04','Z04'),['RFF',['LI','A']],line('2','735123456789012352',undefined,'9'),...characteristic('Z13','E64'),['RFF',['LI','B']]]
 const wire=raw(body,'Z06'),d=await resolveCanonicalRuntimeDecisionWithRegistry(source(wire,'Z06'))
 expect(d.issues.find(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='217')?.prodatDiagnostic).toMatchObject({occurrence:{messageReference:'M',lineIndex:1,lineNumber:'2',objectId:'735123456789012352',lineItemReference:'B'}})
 const planError=d.responsePlan.flatMap(p=>p.applicationErrors??[]).find(e=>e.fieldCode==='217');
 expect(planError?.prodatFieldDiagnostic).toMatchObject({occurrence:{messageReference:'M',lineIndex:1,lineNumber:'2',objectId:'735123456789012352',identityAgency:'9',registerPosition:1,lineItemReference:'B'}});
 const draft=buildAperakDraft({sourceMessage:source(wire,'Z06'),outcome:'negative',applicationErrors:[planError!]});
 expect(draft.rawPayload).toContain('RFF+LI:B');expect(draft.rawPayload).not.toContain('RFF+LI:A');
})

for(const [field,element,invalid] of [['250',2,['ID','','WRONG']],['251',4,'N'.repeat(36)],['253',8,'1'.repeat(10)],['317',6,'C'.repeat(36)],['318',9,'lower']] as const){
 it(`distinguishes supplied IV child ${field} absence from invalid content`,async()=>{
  for(const [value,kind,erc] of [['','missing','41'],[invalid,'invalid','42']] as const){
   const party:Array<Parts[number]>=['NAD','IV',['IVID','','89'],'','Invoicee','Street','City','','12345','SE'];party[element]=value;
   const body:Parts[]=[...head(),...own('1','735123456789012345','CASE-A')];body.splice(6,0,...characteristic('Z04','Z01'));body.push(['NAD','Z02',['54321','160','SVK'],'','','','','','','SE'],party);
   const d=await resolveCanonicalRuntimeDecisionWithRegistry(source(raw(body,'Z03'),'Z03'));
   expect(d.issues.some(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber===field&&i.prodatDiagnostic.errorKind===kind)).toBe(true);
   expect(d.responsePlan.find(p=>p.family==='APERAK')?.applicationErrors).toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:field,ercCode:erc})]));
  }
 });
}
