import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {beforeEach,it,expect,vi} from 'vitest'
import {permissionAckMessage,permissionAckObject,alphabets} from './fixtures/prodat-permission-ack'
import {syntheticPriorContext} from './fixtures/prodat-prior-flow-adapter'
import {changeRaw,changeBody,changeFields,meterChange} from './fixtures/prodat-meter-change'
import {deathRaw,deathBody,deathSelection} from './fixtures/prodat-death-status'
import {payload,characteristic} from './fixtures/prodat-gas'
import {source} from './fixtures/prodat-identity'
import {selectedProdatAckFromPayload} from '@/lib/ediel/prodat/prodatIncomingSelectedAck'
import {assertPriorPermissionContext} from '@/lib/ediel/prodat/prodatPriorPermissionFlow'
import {assertIncomingProdatEnergyProductReview} from '@/lib/ediel/prodat/prodatEnergyProduct'
import {validateProdatPermissionMessage} from '@/lib/ediel/testing/prodatPermissionEngine'
import {resolveAndStoreProdatAperakErrors} from '@/lib/ediel/testing/aperakErrorRuleRegistry'
import {selectRuleProfile,compareEngineDecisionWithExpected} from '@/lib/ediel/rulebook/ruleProfileSelector'
import {buildAckDraftForSource} from '@/lib/ediel/ack'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {decideProdatAperak} from '@/lib/ediel/decisionEngine'
import {prodatIssuesToAperakErrors,decideProdatAperakOutcome} from '@/lib/ediel/prodat/prodatAperak'
import type {EdielMessageRow} from '@/lib/ediel/types'
const state=vi.hoisted(()=>({writes:[] as {table:string;body:Record<string,unknown>}[],reads:[] as string[],events:[] as Record<string,unknown>[],drafts:[] as string[],effects:[] as string[],unavailable:false}))
vi.mock('@/lib/supabase/service',async()=>{const {registryDatabase}=await import('./fixtures/prodat-ack-registry-db');return {supabaseService:{from:(table:string)=>{state.reads.push(table);return registryDatabase(state.writes,[{id:'hostile',message_family:'PRODAT',message_code:'*',direction:'both',rule_key:'report_end_invalid',application_error:'41',free_text_code:'999',free_text:'HOSTILE',is_active:true,priority:0,environment:'all'}])(table)}}}})
function extract(path:string,names:string[],deps:Record<string,unknown>){const f=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true),code=f.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text??'')).map(s=>s.getText(f).replace(/^export /,'')).join('\n');return new Function(...Object.keys(deps),ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return '+names[0])(...Object.values(deps))}
const backend=extract('app/admin/ediel/actions.part-3.ts',['resolveBackendAperakDecision'],{assertIncomingProdatEnergyProductReview,validateProdatPermissionMessage,assertPriorPermissionContext,resolveAndStoreProdatAperakErrors,resolveTgtTestDataForAckAction:async()=>({testData:null,selectedRow:null}),resolveProdatPermissionContextForAck:async(m:EdielMessageRow)=>{state.effects.push('context');return state.unavailable?null:syntheticPriorContext(m)},createEdielMessageEvent:async(e:Record<string,unknown>)=>state.events.push(e)})
const system=extract('app/admin/ediel/system-tests/actions.part-2.ts',['resolveSystemTestAckDecision','prodatPermissionLooksApplicationValid','buildApplicationErrorSummary','firstErrorTransactionReference'],{selectRuleProfile,compareEngineDecisionWithExpected,resolveAndStoreProdatAperakErrors,expectedSystemTestAckOutcome:()=>null,isAgtSystemTestCase:()=>false})
const reporting=(field='323',value='BAD',a:readonly string[]=alphabets[0])=>{const m=permissionAckMessage('Z14','S18','A74',null,a);m.raw_payload=m.raw_payload!.replace(field==='321'?'202611010000':'B72',[...value].map(c=>a.includes(c)?a[2]+c:c).join(''));return m}
const fixtures=()=>[
 ['321',reporting('321','202602300000')],['323',reporting()],
 ['254',source(changeRaw(changeBody(changeFields('BAD','L639Q'),'735123456789012345')),'Z10')],
 ['242',source(changeRaw(changeBody(changeFields('Z32','BAD'),'735123456789012345')),'Z10')],
 ...(['Z05','Z06','Z09'] as const).map(code=>['310',source(deathRaw(code,deathBody(code==='Z05'?'Z23':'E34',characteristic('Z17','BAD'),'735123456789012345')),code)] as const),
 ['320',source(payload('Z04','Z22',[['QTY',['31','1000','KWH']],...characteristic('Z02','1',3),...characteristic('Z05','6',3)],'gas').replace('LIN+1++A:::89','LIN+1++735123456789012345:::89'),'Z04')],
 ['320',source(payload('Z06','E32',[...characteristic('Z02','1',3),...characteristic('Z05','6',3)],'gas').replace('LIN+1++A:::89','LIN+1++735123456789012345:::89'),'Z06')],
] as [string,EdielMessageRow][]
beforeEach(()=>{state.writes=[];state.reads=[];state.events=[];state.drafts=[];state.effects=[];state.unavailable=false})
function assertDraft(m:EdielMessageRow,d:{outcome:string;applicationErrors:Parameters<typeof buildAckDraftForSource>[0]['applicationErrors']},field:string){
 expect(d.outcome).toBe('negative');const draft=buildAckDraftForSource({sourceMessage:m,ackFamily:'APERAK',outcome:'negative',applicationErrors:d.applicationErrors}),t=tokenizeEdifact(draft.rawPayload)
 expect(t.segments.filter(s=>s.tag==='FTX').map(s=>segmentComposite(s,3,t.una)[0])).toContain(field)
 expect(draft.rawPayload).not.toContain('HOSTILE');expect(draft.rawPayload).not.toContain('ERC+100')
 return draft.rawPayload
}
for(const [field,m] of fixtures())it(`actual manual and system own ${m.message_code}/${field} final P-APERAK`,async()=>{
 const manual=await backend({sourceMessage:m,actorUserId:'actor',roleCode:'supplier',fallbackOutcome:'positive'});assertDraft(m,manual,field)
 const sys=await system({sourceMessage:m,ackFamily:'APERAK',requestedOutcome:'positive',messageText:null,testCaseCode:null});assertDraft(m,sys,field)
 expect(manual.applicationErrors).toContainEqual(expect.objectContaining({fieldCode:field,prodatFieldDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field})}))
 expect(state.writes.filter(w=>w.body.free_text_code===field).every(w=>w.body.source_message_id===m.id)).toBe(true)
})
for(const a of alphabets)it(`escaped323 rendered complete text and own refs ${a.join('')}`,async()=>{
 const m=reporting('323',"bad:+?'",a),d=await resolveAndStoreProdatAperakErrors({message:m});const selected=d.errors.filter(e=>e.fieldCode==='323');expect(selected).toHaveLength(1)
 const t=tokenizeEdifact(assertDraft(m,{outcome:'negative',applicationErrors:d.errors},'323'))
 expect(t.segments.filter(s=>s.tag==='FTX').map(s=>segmentComposite(s,4,t.una))).toContainEqual(["Felaktigt Tillståndets syfte bad:+?'"])
 expect(selected[0]).toMatchObject({lineItemReference:'CASE:A+B?C',referenceNumber:'735123456789012345'})
})
for(const a of alphabets)it(`repeated reporting physical refs retain two keys ${a.join('')}`,async()=>{
 const first=permissionAckObject('Z14','S17'),second=permissionAckObject('Z14','S17','A74',null,'2');second[0]=[first[0][0],'2',...first[0].slice(2)]
 for(const body of [first,second]){const i=body.findIndex(t=>t[0]==='CCI'&&t[2]==='Z24');body[i+1]=['CAV','BAD']}
 const m=permissionAckMessage('Z14','S17','A74',null,a,[...first,...second]);const d=await resolveAndStoreProdatAperakErrors({message:m});expect(d.errors.filter(e=>e.fieldCode==='323').map(e=>e.prodatOccurrence?.lineIndex)).toEqual([0,1])
 for(const table of ['ediel_message_validation_issues','ediel_aperak_error_details']){const writes=state.writes.filter(w=>w.table===table);expect(writes).toHaveLength(2);expect(new Set(writes.map(w=>w.body.rule_key)).size).toBe(2)}
})
it('populated reporting C829 and genuine meter register holds precede registry I/O',async()=>{
 const m=reporting();m.raw_payload=m.raw_payload!.replace('LIN+1++735123456789012345:::9','LIN+1++735123456789012345:::9+1:1')
 await expect(resolveAndStoreProdatAperakErrors({message:m})).rejects.toThrow(/ACK_REVIEW_REQUIRED/);expect(state.reads).toEqual([])
 const bad=source(changeRaw([...changeBody(changeFields('BAD','L639Q'),'735123456789012345'),...changeBody(changeFields(),'735123456789012345','2')]),'Z10')
 await expect(resolveAndStoreProdatAperakErrors({message:bad})).rejects.toThrow('PRODAT_REGISTER_ACK_REVIEW_REQUIRED');expect(state.reads).toEqual([])
})
it('own optional LI absent stays absent and second object cannot lend LI',async()=>{
 const a=permissionAckObject('Z14','S17').filter(t=>!(t[0]==='RFF'&&Array.isArray(t[1])&&t[1][0]==='LI')),b=permissionAckObject('Z14','S17','A74',null,'2','OTHER-LI')
 const i=a.findIndex(t=>t[0]==='CCI'&&t[2]==='Z24');a[i+1]=['CAV','BAD'];const m={...permissionAckMessage('Z14','S17','A74',null,alphabets[0],[...a,...b]),transaction_reference:'CACHED'}
 const d=await resolveAndStoreProdatAperakErrors({message:m});expect(d.errors.filter(e=>e.fieldCode==='323')).toMatchObject([{lineItemReference:null,referenceNumber:'735123456789012345',prodatOccurrence:{lineIndex:0}}]);expect(state.writes.filter(w=>w.body.free_text_code==='323').map(w=>w.body.transaction_reference)).toEqual([null])
})
for(const qualifier of ['1131','3055','overflow','unused'])it(`323 qualifier/overflow versus unused ${qualifier}`,()=>{
 const body=permissionAckObject(),i=body.findIndex(t=>t[0]==='CCI'&&t[2]==='Z24');body[i+1]=['CAV',qualifier==='1131'?['B72','X']:qualifier==='3055'?['B72','','9']:qualifier==='overflow'?['B72','','','','','X']:['B72','','','optional','unused']]
 const a=selectedProdatAckFromPayload(permissionAckMessage('Z14','S17','A74',null,alphabets[0],body).raw_payload)
 expect(a.applicationErrors.some(e=>e.fieldCode==='323')).toBe(qualifier!=='unused')
})
for(const code of ['Z05','Z06'])for(const condition of ['death','not_death'] as const)for(const kind of ['missing','valid','invalid'] as const)it(`source310 ${code}/${condition}/${kind}`,()=>{
 const m=deathRaw(code,deathBody(code==='Z05'?'Z23':'E34',kind==='missing'?[]:characteristic('Z17',kind==='valid'?'Z41':'BAD'))),a=selectedProdatAckFromPayload(m,{deathStatus:deathSelection(condition,code as 'Z05'|'Z06')})
 expect(a.applicationErrors.map(e=>[e.ercCode,e.fieldCode])).toEqual(condition==='not_death'||kind==='valid'?[]:[[kind==='missing'?'41':'42','310']])
})
for(const condition of [false,true])for(const kind of ['missing','valid','invalid'] as const)it(`source254242 ${condition}/${kind}`,()=>{
 const a=selectedProdatAckFromPayload(changeRaw(changeBody(kind==='missing'?[]:kind==='valid'?changeFields():changeFields('BAD','BAD'))),{meterChange:meterChange(condition)})
 expect(new Set(a.applicationErrors.map(e=>e.fieldCode))).toEqual(new Set(!condition||kind==='valid'?[]:['254','242']))
 if(condition&&kind==='missing')expect(a.applicationErrors.every(e=>e.ercCode==='41')).toBe(true)
})
it('mixed321 F and323 I remains before manual context/events and direct wrapper cannot fabricate105',async()=>{
 const m=reporting('321','202602300000');m.raw_payload=m.raw_payload!.replace('B72','X'.repeat(80))
 await expect(backend({sourceMessage:m,actorUserId:'actor',roleCode:'supplier'})).rejects.toMatchObject({assessment:{applicationErrors:[expect.objectContaining({fieldCode:'321'})],disposition:{kind:'internal_review'}}})
 expect(state.reads).toEqual([]);expect(state.events).toEqual([]);expect(state.effects).toEqual([])
 expect(decideProdatAperak({rawPayload:m.raw_payload})).toMatchObject({kind:'manual_review',applicationErrors:expect.arrayContaining([expect.objectContaining({fieldCode:'321'})])})
 expect(()=>decideProdatAperakOutcome(m.raw_payload!)).toThrow('PRODAT_SELECTED_ACK_REVIEW_REQUIRED')
 expect(()=>prodatIssuesToAperakErrors(m.raw_payload!)).toThrow('PRODAT_SELECTED_ACK_REVIEW_REQUIRED')
})
it('unavailable prior context retains known323 and prevents persistence or event',async()=>{
 state.unavailable=true;await expect(backend({sourceMessage:reporting(),actorUserId:'actor',roleCode:'supplier'})).rejects.toMatchObject({message:'PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED',selectedFieldAssessment:{applicationErrors:[expect.objectContaining({fieldCode:'323'})]}})
 expect(state.writes).toEqual([]);expect(state.events).toEqual([])
})
function action(entry:string,m:EdielMessageRow){return extract('app/admin/ediel/actions.part-3.ts',[entry],{
 requireEdielWriteActionAccess:async()=>({userId:'actor',isPlatformAdmin:true}),requireEdielSendActionAccess:async()=>({userId:'actor',isPlatformAdmin:true}),formString:(v:unknown)=>v?String(v):null,collectAperakApplicationErrors:()=>[],parseEdielTestSuite:()=> 'PRODAT',parseEdielTestRoleCode:()=> 'energy_service_company',requireScopedEdielMessageForAction:async()=>m,resolveBackendAperakDecision:backend,validateProdatPermissionMessage,
 listAckMessagesForSource:async()=>{state.effects.push('ack-read');return []},resolveTgtTestDataForAckAction:async()=>{state.effects.push('tgt-read');return {testData:null}},resolveRecommendedAckForInboundMessage:()=>({action:{ackFamily:'APERAK',outcome:'positive'},title:'synthetic'}),shouldUseTransactionScopedPositiveAperak:()=>false,removeReplaceableAckMessagesForSource:async()=>{},createAckDraftForMessage:async(p:Record<string,unknown>)=>{const draft=buildAckDraftForSource({...p,sourceMessage:m} as Parameters<typeof buildAckDraftForSource>[0]);state.drafts.push(draft.rawPayload!);return {id:'ack',raw_payload:draft.rawPayload}},attachAperakErrorDetailsToMessage:async()=>{},validateAckPreflight:()=>({ok:true,summary:'synthetic',issues:[]}),createEdielMessageEvent:async(e:Record<string,unknown>)=>state.events.push(e),revalidateEdiel:()=>{},revalidateRelatedMessage:async()=>{},sendEdielMessage:()=>{throw Error('UNEXPECTED_SEND')},
})}
for(const entry of ['createAckDraftAction','createAndSendAckAction','createAndSendRecommendedAckAction'])for(const ready of [true,false])it(`actual ${entry} ready=${ready} reaches final draft or zero effects`,async()=>{
 const m=reporting('323',ready?'BAD':'X'.repeat(80)),f=new FormData();f.set('sourceMessageId',m.id);f.set('ackType','APERAK');f.set('outcome','positive')
 if(ready){await action(entry,m)(f);expect(state.drafts).toHaveLength(1);expect(state.drafts[0]).toContain('FTX+AAO++323::260');expect(state.drafts[0]).not.toContain('ERC+100')}
 else {await expect(action(entry,m)(f)).rejects.toThrow('PRODAT_SELECTED_ACK_REVIEW_REQUIRED');expect(state.drafts).toEqual([]);expect(state.events).toEqual([]);expect(state.writes).toEqual([]);expect(state.effects).toEqual([])}
})
for(const ready of [true,false])it(`actual system-test manual draft readiness=${ready}`,async()=>{
 const m=reporting('323',ready?'BAD':'X'.repeat(80))
 const run=extract('app/admin/ediel/system-tests/actions.part-2.ts',['createAndSendSystemTestAckAction'],{
 requirePlatformAdminActionAccess:async()=>({userId:'actor'}),formString:(v:unknown)=>v?String(v):null,formNumber:()=>null,normalizeAckFamily:()=> 'APERAK',normalizeAckOutcome:()=> 'positive',getEdielMessageById:async()=>m,
 findBestActiveRunForMessage:async()=>{state.effects.push('run-read');return null},resolveSystemTestAckDecision:system,validateProdatPermissionMessage,
 listAckMessagesForSource:async()=>[],createAckDraftForMessage:async(p:Record<string,unknown>)=>{const d=buildAckDraftForSource({...p,sourceMessage:m} as Parameters<typeof buildAckDraftForSource>[0]);state.drafts.push(d.rawPayload!);return {id:'ack',status:'draft',raw_payload:d.rawPayload}},auditSystemTestMaintenance:async()=>{},updateEdielMessageStatus:async()=>({id:'ack',status:'draft'}),revalidateSystemTests:()=>{},redirectToSystemTestAckResult:()=>{},createEdielMessageEvent:async(e:Record<string,unknown>)=>state.events.push(e),
 })
 const f=new FormData();f.set('sourceMessageId',m.id);f.set('ackFamily','APERAK');f.set('outcome','positive');f.set('sendNow','false')
 if(ready){await run(f);expect(state.drafts).toHaveLength(1);expect(state.drafts[0]).toContain('FTX+AAO++323::260')}
 else{await expect(run(f)).rejects.toThrow('PRODAT_SELECTED_ACK_REVIEW_REQUIRED');expect(state.writes).toEqual([]);expect(state.events).toEqual([]);expect(state.drafts).toEqual([]);expect(state.effects).toEqual([])}
})
it('ambiguous own LI carries known323 plus internal disposition before all reads',async()=>{
 const m=reporting();m.raw_payload=m.raw_payload!.replace("RFF+LI:CASE?:A?+B??C'","RFF+LI:CASE?:A?+B??C'RFF+LI:OTHER'")
 expect(selectedProdatAckFromPayload(m.raw_payload)).toMatchObject({disposition:{kind:'internal_review'},applicationErrors:[expect.objectContaining({fieldCode:'323'})]})
 await expect(resolveAndStoreProdatAperakErrors({message:m})).rejects.toThrow('PRODAT_SELECTED_ACK_REVIEW_REQUIRED');expect(state.reads).toEqual([])
})
it('ready323 survives independent permission322 text hold and506 manual hold',async()=>{
 const m=reporting();m.raw_payload=m.raw_payload!.replace('CAV+A74','CAV+'+'X'.repeat(80))
 await expect(backend({sourceMessage:m,actorUserId:'actor',roleCode:'supplier'})).rejects.toMatchObject({selectedFieldAssessment:{applicationErrors:[expect.objectContaining({fieldCode:'323'})]}})
 const n=reporting();n.raw_payload=n.raw_payload!.replace('8716867000030','BAD')
 await expect(backend({sourceMessage:n,actorUserId:'actor',roleCode:'supplier'})).rejects.toMatchObject({message:'PRODAT_ENERGY_PRODUCT_ACK_REVIEW_REQUIRED',selectedFieldAssessment:{applicationErrors:[expect.objectContaining({fieldCode:'323'})]}})
 expect(state.writes).toEqual([]);expect(state.events).toEqual([])
})
import {evaluateIncomingSelectedProdatAck} from '@/lib/ediel/prodat/prodatIncomingSelectedAck'
it('partial field policy does not leak unselected323 internal hold into321 or322',()=>{
 const m=reporting();m.raw_payload=m.raw_payload!.replace("CAV+BAD'","CAV+BAD'CAV+OTHER'")
 const wire=tokenizeEdifact(m.raw_payload!);for(const field of ['321','322'])expect(evaluateIncomingSelectedProdatAck({rawSegments:wire.segments.map(s=>s.raw),una:wire.una,selectedFields:[field]}).issues).toEqual([])
 expect(evaluateIncomingSelectedProdatAck({rawSegments:wire.segments.map(s=>s.raw),una:wire.una,selectedFields:['323']}).disposition.kind).toBe('internal_review')
})
it('unknown local323 blank scalar is absent, not a missing/private inference',()=>{
 const m=reporting('323','');expect(selectedProdatAckFromPayload(m.raw_payload)).toMatchObject({applicationErrors:[],disposition:{kind:'continue'}})
})
it('manual reporting negative retains backend rule keys and issue count for draft detail linking',async()=>{
 const d=await backend({sourceMessage:reporting(),actorUserId:'actor',roleCode:'supplier'});expect(d.backendIssueCount).toBeGreaterThan(0);expect(d.backendRuleKeys).toContainEqual(expect.stringContaining('selected_323'))
})
it('unready323 retains independently ready322 through both guarded consumers',async()=>{
 const m=reporting('323','X'.repeat(80));m.raw_payload=m.raw_payload!.replace('CAV+A74','CAV+BAD')
 await expect(backend({sourceMessage:m,actorUserId:'actor',roleCode:'supplier'})).rejects.toMatchObject({permissionFieldAssessment:{applicationErrors:[expect.objectContaining({fieldCode:'322'})]}})
 await expect(resolveAndStoreProdatAperakErrors({message:m})).rejects.toMatchObject({permissionFieldAssessment:{applicationErrors:[expect.objectContaining({fieldCode:'322'})]}})
 expect(state.writes).toEqual([]);expect(state.reads).toEqual([])
})
