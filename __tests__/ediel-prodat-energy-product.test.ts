import {describe,it,expect,vi} from 'vitest'
import {validateRulebookMessage} from '@/lib/ediel/rulebook/validator'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {raw,characteristic,alphabets,type Parts} from './fixtures/prodat-register'
import {head,own,source} from './fixtures/prodat-identity'
import {permissionWire,permissionObject,z18Message} from './fixtures/prodat-energy-product'
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:vi.fn(async()=>({profileKey:'synthetic-qualified',sourceHash:'synthetic-evidence',messageProfileId:'synthetic',rulePackId:'synthetic'}))}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw Error('UNEXPECTED_DB')}}}))
const check=(wire:string,code:string)=>validateRulebookMessage({family:'PRODAT',code,direction:'inbound',rawPayload:wire,applicationReference:code==='Z13'||code==='Z14'?'23-DGI-PRODAT':'23-DDQ-PRODAT',mode:'parse'})
const national=(wire:string,code:string)=>check(wire,code).issues.filter(i=>i.prodatDiagnostic?.kind==='field'&&['242','506'].includes(i.prodatDiagnostic.fieldNumber))
for(const [n,alphabet] of alphabets.entries())describe(`incoming energy alphabet ${n}`,()=>{
 it('qualifies complete Z01 and ignores false fifth-slot invalid or late extras',async()=>{
  for(const extra of [[],characteristic('Z14','8716867000030',4),characteristic('Z14','INVALID',4),characteristic('Z14','X'.repeat(36),4)]){
   const wire=raw([...head(),...own('1','735123456789012345','CASE:A+B?C'),...extra],'Z01',alphabet)
   const d=await resolveCanonicalRuntimeDecisionWithRegistry(source(wire))
   expect(d.applicationDecision).toBe('accepted');expect(d.responsePlan.map(p=>p.family)).toEqual(['CONTRL'])
  }
 })
 for(const code of ['Z13','Z14'])for(const reason of ['S17','S18']){
  it(`qualifies complete ${code}/${reason} and reports missing/invalid506 with own references`,async()=>{
   for(const [value,erc] of [['8716867000030',null],[null,'41'],['INVALID','42'],['X'.repeat(36),'42']] as const){
    const wire=permissionWire(code,reason,value,alphabet),msg={...source(wire,code),application_reference:'23-DGI-PRODAT'}
    const d=await resolveCanonicalRuntimeDecisionWithRegistry(msg),p=d.responsePlan.find(p=>p.family==='APERAK')!
    expect(d.syntaxDecision).toBe('accepted');expect(d.applicationDecision,JSON.stringify(d.issues)).toBe(erc?'rejected':'accepted')
    expect(p.applicationErrors??[]).toMatchObject(erc?[{ercCode:erc,fieldCode:'506',referenceNumber:code==='Z13'?null:'735123456789012345',lineItemReference:'CASE:A+B?C'}]:[])
    expect(p.applicationErrors??[]).toHaveLength(erc?1:0)
    if(erc){const draft=buildAperakDraft({sourceMessage:msg,outcome:'negative',applicationErrors:p.applicationErrors});expect(draft.rawPayload).toContain('FTX+AAO++506::260');expect(draft.rawPayload).toContain('RFF+LI:CASE?:A?+B??C')}
   }
  })
 }
 it('ignores both false slots in source-valid idless Z14N',async()=>{
  for(const pair of [characteristic('Z14','INVALID',4),[['CCI','','Z14'],['CAV',['','','','INVALID','BAD']]] as Parts[]]){
   const body=permissionObject('Z14','Z96',null);body.splice(1,0,...pair)
   const wire=permissionWire('Z14','Z96',null,alphabet,body),d=await resolveCanonicalRuntimeDecisionWithRegistry({...source(wire,'Z14'),application_reference:'23-DGI-PRODAT'})
   expect(d.applicationDecision).toBe('accepted');expect(d.responsePlan.find(p=>p.family==='APERAK')?.outcome).toBe('positive')
  }
 })
})
it('does not fabricate national242/506 errors for empty false C889; full syntax validity is not asserted',()=>{
 const wire=raw([...head(),...own('1','735123456789012345','CASE'),['CCI','','Z14'],['CAV',['','','','','']]],'Z01')
 expect(national(wire,'Z01')).toEqual([])
})
it('ignores false fourth242 but does not let it supply required fifth506',()=>{
 const body=permissionObject('Z13','S17',null);body.splice(1,0,...characteristic('Z14','8716867000030',3))
 expect(national(permissionWire('Z13','S17',null,alphabets[0],body),'Z13')).toMatchObject([{prodatDiagnostic:{fieldNumber:'506',errorKind:'missing'}}])
})
it('preserves independent invalid207 and syntax count errors beside false506',async()=>{
 const wire=raw([...head(true),...own('1','735123456789012345','CASE'),...characteristic('Z14','BAD',4)],'Z01')
 const d=await resolveCanonicalRuntimeDecisionWithRegistry(source(wire))
 expect(d.responsePlan.find(p=>p.family==='APERAK')?.applicationErrors).toMatchObject([{fieldCode:'207',ercCode:'42'}]);expect(national(wire,'Z01')).toEqual([])
 const broken=wire.replace(/UNT\+\d+/,'UNT+999'),syntax=await resolveCanonicalRuntimeDecisionWithRegistry(source(broken))
 expect(syntax.syntaxDecision).toBe('rejected');expect(national(broken,'Z01')).toEqual([])
})

for(const code of ['Z13','Z14'])for(const reason of ['S17','S18',...(code==='Z14'?['Z96']:[])])it(`source-qualified clean control ${code}/${reason}`,async()=>{const msg={...source(permissionWire(code,reason,reason==='Z96'?null:'8716867000030'),code),application_reference:'23-DGI-PRODAT'};const d=await resolveCanonicalRuntimeDecisionWithRegistry(msg);expect(d.applicationDecision,JSON.stringify(d.issues)).toBe('accepted')})

it('qualifies the P140 Z18 control and preserves acceptance with false506 extra',async()=>{
 for(const energy of [null,'INVALID']){const d=await resolveCanonicalRuntimeDecisionWithRegistry(z18Message(energy));expect(d.syntaxDecision).toBe('accepted');expect(d.applicationDecision,JSON.stringify(d.issues)).toBe('accepted');expect(d.responsePlan.find(p=>p.family==='APERAK')?.outcome).toBe('positive')}
})
