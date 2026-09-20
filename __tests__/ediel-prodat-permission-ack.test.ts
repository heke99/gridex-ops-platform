import {it,expect,vi} from 'vitest'
import {validateProdatPermissionMessage} from '@/lib/ediel/testing/prodatPermissionEngine'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {decideProdatAperak} from '@/lib/ediel/decisionEngine'
import {buildAckDraftForSource} from '@/lib/ediel/ack'
import {permissionAckMessage as message,permissionAckObject as object,alphabets,characteristic} from './fixtures/prodat-permission-ack'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw Error('NO_DB')}}}))
const selected=(errors:readonly {fieldCode?:string|null;ercCode:string}[])=>errors.filter(e=>['322','324'].includes(e.fieldCode??''))
const manual=(m:ReturnType<typeof message>)=>validateProdatPermissionMessage({message:m})
for(const [code,reason,status,end] of [
 ['Z14','S17','A74',null],['Z14','S18','A74',null],['Z14','Z96','A13',null],['Z14','Z96','A76',null],
 ...['S17','S18','Z24'].flatMap(r=>['A74','A75'].flatMap(s=>['B77','B78','B79','B80','E37'].map(e=>['Z15',r,s,e]))),
 ...['B77','B78','B79','B80','E37'].map(e=>['Z18','S17',null,e]),
] as [string,string,string|null,string|null][])it(`qualified ${code}/${reason}/${status}/${end}`,()=>{
 const m=message(code,reason,status,end),d=manual(m),c=resolveCanonicalRuntimeDecision(m)
 expect(d.outcome).toBe('positive');expect(selected(d.applicationErrors)).toEqual([])
 expect(c.syntaxDecision).toBe('accepted');expect(selected(c.responsePlan.flatMap(p=>p.applicationErrors??[]))).toEqual([])
 expect(selected(decideProdatAperak({message:m}).applicationErrors)).toEqual([])
})
for(const [code,reason,status,end,errors] of [
 ['Z14','S17',null,null,[['41','322']]],['Z14','S17','X99',null,[['42','322']]],['Z14','S17','A13',null,[['42','322']]],['Z14','S17','A75',null,[['42','322']]],['Z14','Z96','A74',null,[['42','322']]],
 ['Z15','S17',null,'B79',[['41','322']]],['Z15','S17','A75',null,[['41','324']]],['Z15','S17','A76','X99',[['42','322'],['42','324']]],['Z18','S17',null,null,[['41','324']]],['Z18','S17',null,'X99',[['42','324']]],
] as [string,string,string|null,string|null,string[][]][])it(`rejection ${code}/${reason}/${status}/${end}`,()=>{
 const m=message(code,reason,status,end)
 for(const errorsFound of [manual(m).applicationErrors,resolveCanonicalRuntimeDecision(m).responsePlan.flatMap(p=>p.applicationErrors??[]),decideProdatAperak({message:m}).applicationErrors])expect(selected(errorsFound).map(e=>[e.ercCode,e.fieldCode])).toEqual(errors)
})
for(const a of alphabets)it(`raw punctuation/case and second physical object ${a.join('')}`,()=>{
 const m=message('Z15','S17','A75','B79',a,[...object('Z15','S17','x:+?\'','B79'),...object('Z15','S17','A74','X99','2','SECOND')])
 const d=manual(m)
 expect(d.applicationErrors).toMatchObject([{ercCode:'42',fieldCode:'322',text:"Felaktigt Tillståndets status x:+?'",lineItemReference:'CASE:A+B?C',prodatOccurrence:{lineIndex:0}},{ercCode:'42',fieldCode:'324',text:'Felaktigt Orsak till tillståndets upphörande X99',lineItemReference:'SECOND',prodatOccurrence:{lineIndex:1}}])
 const draft=buildAckDraftForSource({sourceMessage:m,ackFamily:'APERAK',outcome:d.outcome,applicationErrors:d.applicationErrors})
 expect(draft.rawPayload).toContain('ERC+42')
})
it('inapplicable fields and unknown subtype do not create selected errors',()=>{
 for(const code of ['Z13','Z18']){const m=message(code,'S17','A74','B79',alphabets[0],[...object(code),...characteristic('Z23','X99'),...(code==='Z13'?characteristic('Z25','X99'):[])])
 expect(selected(resolveCanonicalRuntimeDecision(m).responsePlan.flatMap(p=>p.applicationErrors??[]))).toEqual([])}
 expect(manual(message('Z14','UNKNOWN','A75')).applicationErrors).toEqual([])
})
it('independent equal-business-reference physical objects are never collapsed',()=>{
 const first=object('Z15','S17','A75','X99'),second=object('Z15','S17','A75','X99','2');second[0]=[first[0][0],'2',...first[0].slice(2)]
 const d=manual(message('Z15','S17','A75','B79',alphabets[0],[...first,...second]))
 expect(d.applicationErrors).toHaveLength(2);expect(d.applicationErrors.map(e=>e.prodatOccurrence?.lineIndex)).toEqual([0,1])
})
it('missing own LI uses own customer and never the later object',()=>{
 const first=object('Z15','S17',null,'B79').filter(p=>!(p[0]==='RFF'&&Array.isArray(p[1])&&p[1][0]==='LI'))
 const d=manual(message('Z15','S17','A75','B79',alphabets[0],[...first,...object('Z15','S17','A75','B79','2','DONOR')]))
 expect(d.applicationErrors).toMatchObject([{ercCode:'41',fieldCode:'322',lineItemReference:null,text:'Tillståndets status saknas, kundid=001'}])
})
it('internal text capacity retains ready F in error evidence without positive result',()=>{
 const m=message('Z15','S17','X99','X'.repeat(80))
 try{manual(m);expect.fail('must hold')}catch(e){expect(e).toMatchObject({message:'PRODAT_PERMISSION_ACK_REVIEW_REQUIRED',assessment:{applicationErrors:[{fieldCode:'322',ercCode:'42'}],disposition:{kind:'internal_review'}}})}
})

it('classifier uses own223 and accepts source-valid Z15C fields',async()=>{
 const {selectRuleProfile}=await import('@/lib/ediel/rulebook/ruleProfileSelector')
 expect(selectRuleProfile({message:message('Z14','Z96','A76')})).toMatchObject({variant:'Z14N'})
 expect(selectRuleProfile({message:message('Z14','UNKNOWN','A74')})).toMatchObject({variant:'unknown'})
 expect(selectRuleProfile({message:message('Z15','Z24','A74','E37')})).toMatchObject({applicationValidity:'valid'})
})

for(const a of alphabets)it(`distinct later UNH never donates ${a.join('')}`,async()=>{
 const {tokenizeEdifact}=await import('@/lib/ediel/core/edifactTokenizer')
 const first=message('Z15','S17','A75',null,a),second=message('Z15','S17','A75','B79',a),t=tokenizeEdifact(second.raw_payload)
 const parts=t.segments.filter(s=>!['UNA','UNB','UNZ'].includes(s.tag)).map(s=>s.tag==='UNH'?s.raw.replace('M'+a[1],'M2'+a[1]):s.tag==='UNT'?s.raw.slice(0,-1)+'M2':s.tag==='BGM'?s.raw.replace(a[1]+'D'+a[1],a[1]+'D2'+a[1]):s.raw)
 first.raw_payload=first.raw_payload!.replace('UNZ'+a[1]+'1'+a[1]+'I'+a[3],parts.map(x=>x+a[3]).join('')+'UNZ'+a[1]+'2'+a[1]+'I'+a[3])
 for(const d of [manual(first),decideProdatAperak({message:first})])expect(selected(d.applicationErrors)).toMatchObject([{ercCode:'41',fieldCode:'324',prodatOccurrence:{messageReference:'M',lineIndex:0}}])
})
for(const kind of ['header','duplicate','duplicate-invalid','late-cav','bgm','reason'] as const)it(`ambiguous ${kind} keeps internal evidence and no invented42`,()=>{
 const body=object('Z15','S17','A75','B79')
 if(kind==='header')body.unshift(...characteristic('Z25','B79'))
 if(kind==='duplicate'||kind==='duplicate-invalid')body.splice(1,0,...characteristic('Z25',kind==='duplicate'?'B79':'X99'))
 if(kind==='late-cav')body.push(...characteristic('Z25','B79'))
 let m=message('Z15','S17','A75','B79',alphabets[0],body)
 if(kind==='bgm')m.raw_payload=m.raw_payload!.replace('BGM+Z15+D+9+AB',"BGM+Z15+D+9+AB'BGM+Z18+D2+9+AB")
 if(kind==='reason'){const b=object('Z14','S17','A13');b.splice(1,0,...characteristic('Z13','Z96'));m=message('Z14','S17','A13',null,alphabets[0],b)}
 try{manual(m);expect.fail('must hold')}catch(e){expect(e).toMatchObject({message:'PRODAT_PERMISSION_ACK_REVIEW_REQUIRED',assessment:{disposition:{kind:'internal_review'}}});const assessment=(e as Error&{assessment:{applicationErrors:{ercCode:string;fieldCode:string}[];issues:unknown[]}}).assessment
 expect(assessment.applicationErrors.filter(e=>e.ercCode==='42').map(e=>e.fieldCode)).toEqual(kind==='duplicate-invalid'?['324']:[]);expect(JSON.stringify(assessment.issues)).toContain('CCI')}
})
it('unused metadata is ignored; missing primary still41 and exact case is42',()=>{
 const m=message('Z15');m.raw_payload=m.raw_payload!.replace('CAV+A74',"CAV+A74:UNUSED:TEXT:EXTRA")
 expect(manual(m).applicationErrors).toEqual([])
 m.raw_payload=m.raw_payload.replace('CAV+A74:UNUSED:TEXT:EXTRA','CAV+:UNUSED:TEXT:EXTRA')
 expect(manual(m).applicationErrors).toMatchObject([{ercCode:'41',fieldCode:'322'}])
 m.raw_payload=m.raw_payload.replace('CAV+:UNUSED:TEXT:EXTRA','CAV+a74')
 expect(manual(m).applicationErrors).toMatchObject([{ercCode:'42',fieldCode:'322',text:'Felaktigt Tillståndets status a74'}])
})

it('original custom-UNA header status without own223 cannot create Z14N',async()=>{
 const {classifyEdielMessage}=await import('@/lib/ediel/rulebook/ruleProfileSelector')
 const rawPayload=['UNA;*.? !','UNB*UNOC;3*GRIDOWNER;;14*ESCO;;14*260829;0030*REF2**23-DGI-PRODAT!','UNH*2*PRODAT;D;96A;UN;E2SE6A!','BGM*Z14*DOC2*9!','CCI**Z23!','CAV*A75!','LIN*1**735999123456789003!','RFF*Z07;FACILITY-1!','UNT*7*2!','UNZ*1*REF2!'].join('')
 expect(classifyEdielMessage({rawPayload})).toMatchObject({variant:'unknown',businessResult:'unknown',applicationValidity:'uncertain'})
})
