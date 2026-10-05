import {syntheticPriorContext} from './fixtures/prodat-prior-flow-adapter'
import {assertPriorPermissionContext} from '@/lib/ediel/prodat/prodatPriorPermissionFlow'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {beforeEach,it,expect,vi} from 'vitest'
import {permissionAckMessage as message,permissionAckObject as object,alphabets} from './fixtures/prodat-permission-ack'
import {validateProdatPermissionMessage} from '@/lib/ediel/testing/prodatPermissionEngine'
import {assertIncomingProdatEnergyProductReview} from '@/lib/ediel/prodat/prodatEnergyProduct'
import {selectRuleProfile,compareEngineDecisionWithExpected} from '@/lib/ediel/rulebook/ruleProfileSelector'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {EdielAperakApplicationError} from '@/lib/ediel/ack'
import type {EdielTgtCaseTestData} from '@/lib/ediel/testing/tgtTestData'
const state=vi.hoisted(()=>({writes:[] as {table:string;body:Record<string,unknown>}[],reads:[] as string[],rules:[] as Record<string,unknown>[],events:[] as Record<string,unknown>[],contextUnavailable:false,contextCalls:0}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 state.reads.push(table);let single=false,body:Record<string,unknown>|undefined
 const q:Record<string,unknown>={then:(done:(r:unknown)=>unknown)=>done({data:single?{id:JSON.stringify(body??{})}:table==='ediel_aperak_error_rules'?state.rules:[],error:null})}
 for(const op of ['select','limit','eq','in','not','lte','order','or','is','upsert','insert','update','maybeSingle'])q[op]=(...args:unknown[])=>{if(op==='maybeSingle')single=true;if(['upsert','insert','update'].includes(op)){body=args[0] as Record<string,unknown>;state.writes.push({table,body})}return q}
 return q
}}}))
import {deriveProdatAperakValidationIssues,resolveAndStoreProdatAperakErrors} from '@/lib/ediel/testing/aperakErrorRuleRegistry'
function extract<T>(path:string,names:string[],deps:Record<string,unknown>):T{const file=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true),code=file.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text??'')).map(s=>s.getText(file).replace(/^export /,'')).join('\n'),js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;return new Function(...Object.keys(deps),`${js};return ${names[0]}`)(...Object.values(deps)) as T}
type Result={outcome:string;applicationErrors:EdielAperakApplicationError[]|null}
const manual=extract<(p:{sourceMessage:EdielMessageRow;actorUserId:string;roleCode:string;fallbackOutcome?:'positive'|'negative';fallbackApplicationErrors?:EdielAperakApplicationError[]})=>Promise<Result>>('app/admin/ediel/actions.part-3.ts',['resolveBackendAperakDecision'],{assertIncomingProdatEnergyProductReview,validateProdatPermissionMessage,assertPriorPermissionContext,resolveAndStoreProdatAperakErrors,resolveTgtTestDataForAckAction:async()=>({testData:null,selectedRow:null}),resolveProdatPermissionContextForAck:async(m:EdielMessageRow)=>{state.contextCalls++;if(state.contextUnavailable)throw Error('SYNTHETIC_UNAVAILABLE');return syntheticPriorContext(m)},createEdielMessageEvent:async(e:Record<string,unknown>)=>state.events.push(e)})
const system=extract<(p:{sourceMessage:EdielMessageRow;ackFamily:string;requestedOutcome:string;messageText:null;testCaseCode:null})=>Promise<Result>>('app/admin/ediel/system-tests/actions.part-2.ts',['resolveSystemTestAckDecision','prodatPermissionLooksApplicationValid','buildApplicationErrorSummary','firstErrorTransactionReference'],{selectRuleProfile,compareEngineDecisionWithExpected,resolveAndStoreProdatAperakErrors,expectedSystemTestAckOutcome:()=>null,isAgtSystemTestCase:()=>false})
const run=(m:EdielMessageRow)=>manual({sourceMessage:m,actorUserId:'synthetic',roleCode:'supplier'})
const scenario=(code='9.2.1'):EdielTgtCaseTestData=>({suite:'PRODAT',roleCode:'supplier',testCaseCode:code,title:'Synthetic',sourceNote:'Synthetic',groups:[{block:{kind:'PRODAT',sourceWorkbook:'synthetic',sourceSheet:'synthetic',entityLabel:'synthetic',entityNumbers:[],columns:[],fields:[]},columns:[],fields:[{fieldCode:'322',fieldName:'322',values:{synthetic:'Z99'}},{fieldCode:'324',fieldName:'324',values:{synthetic:'Z99'}}]}]} as unknown as EdielTgtCaseTestData)
beforeEach(()=>{state.writes=[];state.reads=[];state.rules=[];state.events=[];state.contextUnavailable=false;state.contextCalls=0})
for(const data of [null,scenario(),scenario('1.2.1')])it(`registry wire invalid beats scenario/positive ${data?.testCaseCode}`,async()=>{
 const result=await resolveAndStoreProdatAperakErrors({message:message('Z15','Z24','A74','X99'),testData:data})
 expect(result.errors).toMatchObject([{ercCode:'42',fieldCode:'324',text:'Felaktigt Orsak till tillståndets upphörande X99',prodatOccurrence:{lineIndex:0}}])
 expect(state.writes.filter(w=>w.table==='ediel_aperak_error_details').map(w=>w.body)).toMatchObject([{application_error:'42',free_text_code:'324',free_text:'Felaktigt Orsak till tillståndets upphörande X99'}])
})
it('valid wire ignores selected permission fault and hostile mutable DB mapping',async()=>{
 state.rules=[{id:'hostile',message_family:'PRODAT',message_code:'*',direction:'both',rule_key:'permission_end_reason_invalid',application_error:'41',free_text_code:'322',free_text:'CUSTOM Z99',environment:'all',priority:0,is_active:true}]
 expect((await resolveAndStoreProdatAperakErrors({message:message('Z15','Z24','A74','E37'),testData:scenario()})).errors).toEqual([])
 expect(state.writes).toEqual([])
 const d=await resolveAndStoreProdatAperakErrors({message:message('Z15','S17','A75','X99')})
 expect(d.errors).toMatchObject([{ercCode:'42',fieldCode:'324',text:'Felaktigt Orsak till tillståndets upphörande X99'}])
})
it('equal references retain distinct stable physical issue and detail upsert keys',async()=>{
 const first=object('Z15','S17','A75','X99'),second=object('Z15','S17','A75','X99','2');second[0]=[first[0][0],'2',...first[0].slice(2)]
 const m=message('Z15','S17','A75','B79',alphabets[0],[...first,...second]);const d=await resolveAndStoreProdatAperakErrors({message:m})
 expect(d.errors).toHaveLength(2);expect(d.errors.map(e=>e.prodatOccurrence?.lineIndex)).toEqual([0,1])
 for(const table of ['ediel_message_validation_issues','ediel_aperak_error_details']){const writes=state.writes.filter(w=>w.table===table).map(w=>w.body);expect(writes).toHaveLength(2);expect(new Set(writes.map(w=>w.rule_key)).size).toBe(2)}
 const prior=structuredClone(state.writes);state.writes=[];await resolveAndStoreProdatAperakErrors({message:m});expect(state.writes).toEqual(prior)
})
it('registry and manual text/internal guards precede all reads/writes/events',async()=>{
 const m=message('Z15','S17','X99','X'.repeat(80))
 expect(()=>deriveProdatAperakValidationIssues({message:m})).toThrow('PRODAT_PERMISSION_ACK_REVIEW_REQUIRED')
 await expect(resolveAndStoreProdatAperakErrors({message:m})).rejects.toMatchObject({assessment:{applicationErrors:[{fieldCode:'322'}]}})
 await expect(run(m)).rejects.toThrow('PRODAT_PERMISSION_ACK_REVIEW_REQUIRED');expect(state.writes).toEqual([]);expect(state.reads).toEqual([]);expect(state.events).toEqual([]);expect(state.contextCalls).toBe(0)
})
it('unavailable history retains field diagnostics and has no event/write',async()=>{
 state.contextUnavailable=true
 await expect(run(message('Z14','S17','X99'))).rejects.toMatchObject({message:'SYNTHETIC_UNAVAILABLE',permissionFieldAssessment:{applicationErrors:[{ercCode:'42',fieldCode:'322'}]}})
 expect(state.writes).toEqual([]);expect(state.events).toEqual([])
})
for(const code of ['Z14','Z15','Z18'])it(`actual system fallback and manual event consume ${code} wire evidence`,async()=>{
 const m=message(code,'S17',code==='Z18'?null:'X99',code==='Z14'?null:'X99')
 const d=await system({sourceMessage:m,ackFamily:'APERAK',requestedOutcome:'positive',messageText:null,testCaseCode:null});expect(d.outcome).toBe('negative');expect(d.applicationErrors?.some(e=>e.ercCode==='42'&&['322','324'].includes(e.fieldCode??''))).toBe(true)
 expect((await run(m)).outcome).toBe('negative');expect(state.events.map(e=>e.eventStatus)).toEqual(['warning'])
})
it('registry absence cannot be filled from cached LI',async()=>{
 const body=object('Z15','S17',null,'B79').filter(p=>!(p[0]==='RFF'&&Array.isArray(p[1])&&p[1][0]==='LI'))
 const d=await resolveAndStoreProdatAperakErrors({message:{...message('Z15','S17',null,'B79',alphabets[0],body),transaction_reference:'CACHED'}})
 const selected=d.errors.filter(e=>e.fieldCode==='322');expect(selected).toMatchObject([{lineItemReference:null,text:'Tillståndets status saknas, kundid=001'}]);expect(state.writes.filter(w=>w.body.free_text_code==='322').map(w=>w.body.transaction_reference)).toEqual([null])
})

for(const a of alphabets)for(const code of ['Z14','Z15','Z18'])it(`amendment independent ${code} occurrences ${a.join('')}`,async()=>{
 const first=object(code,'S17',code==='Z18'?null:'X99',code==='Z14'?null:'X99'),second=object(code,'S17',code==='Z18'?null:'X99',code==='Z14'?null:'X99','2');second[0]=[first[0][0],'2',...first[0].slice(2)]
 const d=await resolveAndStoreProdatAperakErrors({message:message(code,'S17','A75','B79',a,[...first,...second])})
 expect(d.errors.filter(e=>['322','324'].includes(e.fieldCode??'')).map(e=>e.prodatOccurrence?.lineIndex)).toEqual(code==='Z15'?[0,0,1,1]:[0,1])
 for(const table of ['ediel_message_validation_issues','ediel_aperak_error_details']){const writes=state.writes.filter(w=>w.table===table);expect(new Set(writes.map(w=>w.body.rule_key)).size).toBe(writes.length)}
})
for(const kind of ['populated','empty','malformed','extra','sequence','identity','reading','outbound','cached','ambiguous'] as const)it(`amendment preserves ${kind} hold and field evidence`,async()=>{
 const first=object('Z15','S17','A75','X99'),second=object('Z15','S17','A75','X99','2');second[0]=[first[0][0],'2',...first[0].slice(2)]
 if(kind==='populated')first[0]=[...first[0],['1','1']]
 if(kind==='empty')first[0]=[...first[0],'']
 if(kind==='malformed')first[0]=[...first[0],['2','1']]
 if(kind==='extra')first[0]=[...first[0],['1','1'],'EXTRA']
 if(kind==='sequence')second[0]=[first[0][0],'7',...first[0].slice(2)]
 if(kind==='identity'){first[0]=['LIN','1','',['735123456789012345','','','BAD']];second[0]=['LIN','2','',['735123456789012345','','','BAD']]}
 if(kind==='reading')first.splice(1,0,['QTY',['31','INVALID','KWH']])
 const m=message('Z15','S17','A75','B79',alphabets[0],[...first,...second]);if(kind==='outbound')m.direction='outbound';if(kind==='cached')m.raw_payload=m.raw_payload!.replace('BGM+Z15','BGM+Z04');if(kind==='ambiguous')m.raw_payload=m.raw_payload!.replace('BGM+Z15+D+9+AB',"BGM+Z15+D+9+AB'BGM+Z15+D2+9+AB")
 await expect(resolveAndStoreProdatAperakErrors({message:m})).rejects.toThrow(/PRODAT_.*ACK_REVIEW_REQUIRED/);expect(state.writes).toEqual([])
})
it('populated scenario comparator ambiguity still holds with typed field evidence',async()=>{
 const first=object('Z15','S17','A75','X99'),second=object('Z15','S17','A75','X99','2');second[0]=[first[0][0],'2',...first[0].slice(2)]
 const data=scenario('1.2.1');data.groups[0].columns=[{index:0,name:'synthetic',sourceOrder:0,testCase:'1.2.1'}];data.groups[0].fields=[{fieldCode:'209',fieldName:'Anläggning',values:{synthetic:'735123456789012345'}}]
 await expect(resolveAndStoreProdatAperakErrors({message:message('Z15','S17','A75','B79',alphabets[0],[...first,...second]),testData:data})).rejects.toMatchObject({message:'PRODAT_REGISTER_ACK_REVIEW_REQUIRED',permissionApplicationErrors:[{fieldCode:'324',prodatOccurrence:{lineIndex:0}},{fieldCode:'324',prodatOccurrence:{lineIndex:1}}]});expect(state.writes).toEqual([])
})

it('submitted positive fallback cannot replace a ready selected national failure',async()=>{
 const d=await manual({sourceMessage:message('Z14','S17','X99'),actorUserId:'synthetic',roleCode:'supplier',fallbackOutcome:'positive',fallbackApplicationErrors:[{ercCode:'100',fieldCode:null,text:'SUBMITTED'}]})
 expect(d.outcome).toBe('negative');expect(d.applicationErrors).toMatchObject([{ercCode:'42',fieldCode:'322'}]);expect(d.applicationErrors?.some(e=>e.text==='SUBMITTED')).toBe(false)
})
for(const code of ['Z04','Z06','Z10'])it(`registry amendment preserves ${code} omitted and valid C829 chain`,async()=>{
 const {line,raw}=await import('./fixtures/prodat-register'),{source}=await import('./fixtures/prodat-identity')
 const {validateProdatRegisterPayload}=await import('@/lib/ediel/rulebook/prodatRegisterPolicy'),{permissionRegistryRegisterFailures}=await import('@/lib/ediel/testing/prodatPermissionAckRegistry'),{tokenizeEdifact}=await import('@/lib/ediel/core/edifactTokenizer')
 for(const present of [false,true]){const wire=raw([line('1','735123456789012345',present?'1':undefined),line('2','735123456789012345',present?'2':undefined)],code),t=tokenizeEdifact(wire),issues=validateProdatRegisterPayload({code,rawSegments:t.segments.map(s=>s.raw),una:t.una})
 const kept=permissionRegistryRegisterFailures(source(wire,code),issues);expect(kept).toEqual(issues);expect(kept.filter(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='258').length).toBe(present?0:2)}
})
for(const a of alphabets)it(`subsequent permission UNH cannot grant register exclusion ${a.join('')}`,async()=>{
 const {line,raw}=await import('./fixtures/prodat-register'),{source}=await import('./fixtures/prodat-identity'),{tokenizeEdifact}=await import('@/lib/ediel/core/edifactTokenizer'),{validateProdatRegisterPayload}=await import('@/lib/ediel/rulebook/prodatRegisterPolicy'),{permissionRegistryRegisterFailures}=await import('@/lib/ediel/testing/prodatPermissionAckRegistry')
 const first=raw([line('1','735123456789012345'),line('2','735123456789012345')],'Z04',a),second=message('Z15','S17','A75','X99',a).raw_payload!
 const later=tokenizeEdifact(second).segments.filter(s=>!['UNA','UNB','UNZ'].includes(s.tag)).map(s=>s.tag==='UNH'?s.raw.replace('M'+a[1],'M2'+a[1]):s.tag==='UNT'?s.raw.slice(0,-1)+'M2':s.tag==='BGM'?s.raw.replace(a[1]+'D'+a[1],a[1]+'D2'+a[1]):s.raw)
 const combined=first.replace('UNZ'+a[1]+'1'+a[1]+'I'+a[3],later.map(s=>s+a[3]).join('')+'UNZ'+a[1]+'2'+a[1]+'I'+a[3]),t=tokenizeEdifact(combined),issues=validateProdatRegisterPayload({code:'Z04',rawSegments:t.segments.map(s=>s.raw),una:t.una})
 expect(permissionRegistryRegisterFailures(source(combined,'Z15'),issues)).toEqual(issues);expect(issues.length).toBeGreaterThan(0)
})
it('valid scalar under unknown subtype preserves positive while outside union rejects',async()=>{
 expect((await run(message('Z14','UNKNOWN','A75'))).outcome).toBe('positive')
 expect((await run(message('Z14','UNKNOWN','X99'))).applicationErrors).toMatchObject([{ercCode:'42',fieldCode:'322'}])
})
it('cached code cannot suppress own wire322/324 or manufacture their applicability',async()=>{
 expect((await run({...message('Z14','S17','X99'),message_code:'Z04'})).applicationErrors).toMatchObject([{ercCode:'42',fieldCode:'322'}])
 const d=await resolveAndStoreProdatAperakErrors({message:{...message('Z13'),message_code:'Z15'},testData:scenario()})
 expect(d.errors.filter(e=>['322','324'].includes(e.fieldCode??''))).toEqual([])
})
