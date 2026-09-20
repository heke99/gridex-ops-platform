import {validateRulebookMessage} from '@/lib/ediel/rulebook/validator'
import {describe,it,expect,vi} from 'vitest'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {raw,characteristic,alphabets} from './fixtures/prodat-register'
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:vi.fn(async()=>({profileKey:'synthetic-qualified',sourceHash:'synthetic-evidence',messageProfileId:'synthetic',rulePackId:'synthetic'}))}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw Error('UNEXPECTED_DB')}}}))
import {own,head,source,z10} from './fixtures/prodat-identity'
for(const [n,alphabet] of alphabets.entries())describe(`source-owned errors alphabet ${n}`,()=>{
 it('keeps a complete two-object Z01 accepted without application ACK',async()=>{
 const d=await resolveCanonicalRuntimeDecisionWithRegistry(source(raw([...head(),...own('1','735123456789012345','CASE-A'),...own('2','735123456789012352','CASE-B')],'Z01',alphabet)))
 expect(d.applicationDecision).toBe('accepted');expect(d.responsePlan.map(x=>x.family)).toEqual(['CONTRL'])
 })
 it('reports missing second LI as41/226 with only its own object and no cached LI',async()=>{
 const msg=source(raw([...head(),...own('1','735123456789012345','CASE-A'),...own('2','735123456789012352',null)],'Z01',alphabet)),d=await resolveCanonicalRuntimeDecisionWithRegistry(msg),p=d.responsePlan.find(x=>x.family==='APERAK')!
 expect(p.applicationErrors).toMatchObject([{ercCode:'41',fieldCode:'226',referenceNumber:'735123456789012352',lineItemReference:null}])
 const draft=buildAperakDraft({sourceMessage:msg,outcome:'negative',applicationErrors:p.applicationErrors})
 expect(draft.rawPayload).toContain('FTX+AAO++226::260');expect(draft.rawPayload).toContain('RFF+Z07:735123456789012352');expect(draft.rawPayload).not.toContain('RFF+LI:');expect(draft.rawPayload).not.toContain('RFF+Z07:735123456789012345');expect(draft.rawPayload).not.toContain('CACHED-UNRELATED')
 })
 it('reports header207 without C082 extraction or borrowed object references',async()=>{
 const msg=source(raw([...head(true),...own('1','735123456789012345','CASE-A')],'Z01',alphabet)),d=await resolveCanonicalRuntimeDecisionWithRegistry(msg),p=d.responsePlan.find(x=>x.family==='APERAK')!
 expect(p.applicationErrors).toMatchObject([{ercCode:'42',fieldCode:'207'}]);const draft=buildAperakDraft({sourceMessage:msg,outcome:'negative',applicationErrors:p.applicationErrors})
 expect(draft.rawPayload).toContain('FTX+AAO++207::260');expect(draft.rawPayload).not.toContain('RFF+Z07:');expect(draft.rawPayload).not.toContain('RFF+LI:')
 })
 it('preserves exact decoded escaped LI through the actual draft',()=>{
 const msg=source(raw([...head(),...own('1','735123456789012345','CASE:A+B?C')],'Z01',alphabet))
 const draft=buildAperakDraft({sourceMessage:msg,outcome:'negative',applicationErrors:[{ercCode:'42',fieldCode:'260',text:'invalid',referenceQualifier:'Z07',referenceNumber:'735123456789012345',lineItemReference:'CASE:A+B?C'}]})
 expect(draft.rawPayload).toContain('RFF+LI:CASE?:A?+B??C');expect(draft.validationReport?.applicationErrors).toMatchObject([{lineItemReference:'CASE:A+B?C'}])
 })
})
it('keeps receiver-local readings U as diagnostics with prescribed positive Z10 ACK',async()=>{
 const msg=source(raw(z10(),'Z10'),'Z10'),d=await resolveCanonicalRuntimeDecisionWithRegistry(msg)
 expect(d.syntaxDecision).toBe('accepted');expect(d.applicationDecision).toBe('accepted');expect(d.functionalDecision).toBe('accepted')
 expect(d.issues.map(x=>x.code)).toEqual(Array(3).fill('PRODAT_DEPENDENT_CONDITION_UNDETERMINED'));expect(d.issues.every(x=>x.severity==='warning')).toBe(true)
 const p=d.responsePlan.find(x=>x.family==='APERAK')!;expect(p.outcome).toBe('positive');expect(buildAperakDraft({sourceMessage:msg,outcome:'positive',applicationErrors:p.applicationErrors}).rawPayload).toContain('ERC+100::260')
})
it('retains the concrete missing LI negative when readings knowledge is unknown',async()=>{
 const msg=source(raw(z10(false),'Z10'),'Z10'),d=await resolveCanonicalRuntimeDecisionWithRegistry(msg),p=d.responsePlan.find(x=>x.family==='APERAK')!
 expect(d.applicationDecision).toBe('rejected');expect(d.functionalDecision).toBe('accepted');expect(p.applicationErrors).toMatchObject([{ercCode:'41',fieldCode:'226'}]);expect(p.applicationErrors).toHaveLength(1)
 expect(d.issues.filter(x=>x.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toHaveLength(3)
})

it('checks supplied invalid254 independently of unknown readings and meter-change requiredness',async()=>{
 const body=z10();body.splice(3,0,...characteristic('Z15','INVALID'))
 const d=await resolveCanonicalRuntimeDecisionWithRegistry(source(raw(body,'Z10'),'Z10'))
 expect(d.applicationDecision).toBe('rejected');expect(d.functionalDecision).toBe('accepted')
 const errors=d.responsePlan.find(x=>x.family==='APERAK')!.applicationErrors!
 expect(errors.some(x=>x.ercCode==='42'&&x.fieldCode==='254')).toBe(true);expect(errors.every(x=>x.fieldCode==='254')).toBe(true)
})
it('uses the special40/A903109 source rule for both Z09D contract dates',async()=>{
 const body=[...head(),...own('1','735123456789012345','CASE')].map(p=>p[0]==='CAV'?['CAV','Z70']:p)
 body.splice(4,0,['DTM',['93','202611010000','203']])
 const d=await resolveCanonicalRuntimeDecisionWithRegistry(source(raw(body,'Z09'),'Z09'))
 expect(d.responsePlan.find(x=>x.family==='APERAK')?.applicationErrors).toEqual(expect.arrayContaining([expect.objectContaining({ercCode:'40',fieldCode:'109'})]))
})

it('qualifies a complete Z03 control and only missing226 for the legacy script repair',async()=>{
 const body=[...head(),...own('1','735123456789012345','CASE-A')];body.splice(6,0,...characteristic('Z04','Z01'));body.push(['NAD','Z02',['54321','160','SVK'],'','','','','','','SE'])
 const wire=raw(body,'Z03'),bad=raw(body.filter(p=>!(p[0]==='RFF'&&Array.isArray(p[1])&&p[1][0]==='LI')),'Z03')
 const control=validateRulebookMessage({family:'PRODAT',code:'Z03',direction:'inbound',rawPayload:wire,applicationReference:'23-DDQ-PRODAT',mode:'parse'})
 expect(control.issues.filter(i=>i.blocking||i.severity==='error'),JSON.stringify(control.issues)).toEqual([])
 const invalid=validateRulebookMessage({family:'PRODAT',code:'Z03',direction:'inbound',rawPayload:bad,applicationReference:'23-DDQ-PRODAT',mode:'parse'})
 expect(invalid.issues.filter(i=>i.blocking||i.severity==='error')).toMatchObject([{prodatDiagnostic:{kind:'field',fieldNumber:'226',errorKind:'missing'}}])
 expect((await resolveCanonicalRuntimeDecisionWithRegistry(source(bad,'Z03'))).responsePlan.find(p=>p.family==='APERAK')?.applicationErrors).toMatchObject([{ercCode:'41',fieldCode:'226'}])
})
