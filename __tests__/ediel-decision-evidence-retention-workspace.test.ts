import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {isValidElement,type ReactNode} from 'react'
const fixture=vi.hoisted(()=>({cursor:0,state:[] as unknown[],confirm:vi.fn(),fetch:vi.fn()}))
// Declared synthetic React hook state. Invoke the actual component's actual
// click handler and fetch orchestration; no DOM/browser/native proof is claimed.
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:(initial:unknown)=>{
 const index=fixture.cursor++
 if(!(index in fixture.state))fixture.state[index]=initial
 return [fixture.state[index],(value:unknown)=>{fixture.state[index]=value}]
},useRef:(initial:unknown)=>{const index=fixture.cursor++;if(!(index in fixture.state))fixture.state[index]={current:initial};return fixture.state[index]}}))
import Workspace from '@/app/retention/decision-evidence/workspace'
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',policyId='00000000-0000-4000-8000-000000000004'
const retentionClass='completed_decision_review_reason',permissions=['ediel.retention.purge','ediel.retention.completed_review_reason']
const policy={companyId:company,policyId,retentionClass,targetId:actor,sourceHash:'a'.repeat(64),documentHash:'b'.repeat(64),bytesAvailable:true,issuerQualified:true,currentQualified:true,submittedBy:actor,reviews:[],purge:null,revoked:false}
function text(node:ReactNode):string{
 if(typeof node==='string'||typeof node==='number')return String(node)
 if(Array.isArray(node))return node.map(text).join('')
 if(isValidElement<{children?:ReactNode}>(node))return text(node.props.children)
 return ''
}
function buttons(node:ReactNode):{onClick:()=>Promise<void>;children?:ReactNode}[]{
 if(Array.isArray(node))return node.flatMap(buttons)
 if(!isValidElement<{children?:ReactNode;onClick:()=>Promise<void>}>(node))return []
 return [...(node.type==='button'?[node.props]:[]),...buttons(node.props.children)]
}
async function purge(){
 fixture.cursor=0
 const view=Workspace({companyId:company,userId:actor,permissions})
 const button=buttons(view).find(b=>text(b.children)==='Gallra beslutad motivering')
 expect(button).toBeDefined();await button!.onClick()
}
beforeEach(()=>{
 vi.resetAllMocks();fixture.cursor=0
 fixture.state=[retentionClass,actor,{documentHash:'c'.repeat(64),targetMetadataHash:'d'.repeat(64),bytesAvailable:true,documentByteLength:20},null,null,policyId,policy,'',false,'']
 vi.stubGlobal('fetch',fixture.fetch);fixture.confirm.mockReturnValue(true);vi.stubGlobal('confirm',fixture.confirm)
})
afterEach(()=>{vi.unstubAllGlobals()})
it.each([false,true])('retains the successful purge receipt when a following GET would deny, replay=%s',async replay=>{
 fixture.fetch.mockImplementation(async(_url:string,options?:RequestInit)=>options?.method==='POST'
  ?{ok:true,json:async()=>({status:'purged',replay,authority:'none'})}
  :{ok:false,json:async()=>({error:'EXPIRED_DISCLOSURE_DENIED'})})
 await purge()
 expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith(`/api/ediel/decision-evidence-retention/${policyId}/purge`,expect.objectContaining({method:'POST',body:'{}',cache:'no-store'}))
 expect(fixture.state[6]).toBeNull();expect(fixture.state[2]).toBeNull();expect(fixture.state[8]).toBe(false)
 expect(fixture.state[9]).toContain('bekräftad');expect(fixture.state[9]).not.toContain('EXPIRED_DISCLOSURE_DENIED')
 if(replay)expect(fixture.state[9]).toContain('Tidigare')
})
it('keeps a held result distinct from completed purge without an obligatory disclosure read',async()=>{
 fixture.fetch.mockResolvedValue({ok:true,json:async()=>({status:'held',authority:'none'})})
 await purge();expect(fixture.fetch).toHaveBeenCalledTimes(1);expect(fixture.state[6]).toBeNull();expect(fixture.state[2]).toBeNull()
 expect(fixture.state[9]).toContain('hålls');expect(fixture.state[9]).not.toContain('bekräftad')
})
it('does not display success when the purge POST itself is denied',async()=>{
 fixture.fetch.mockResolvedValue({ok:false,json:async()=>({error:'CURRENT_NATIVE_CLASS_DENIED'})})
 await purge();expect(fixture.fetch).toHaveBeenCalledTimes(1);expect(fixture.state[9]).toBe('CURRENT_NATIVE_CLASS_DENIED');expect(fixture.state[9]).not.toContain('bekräftad');expect(fixture.state[8]).toBe(false)
})

it.each([{status:'disposed',replay:false,text:'har gallrats'},{status:'disposed',replay:true,text:'Tidigare gallring'},{status:'expired',text:'har avslutats'},{status:'unavailable',text:'Ingen ny gallring har bekräftats'}])('keeps the actual UI handler outcome $status distinct from held',async outcome=>{
 fixture.fetch.mockResolvedValue({ok:true,json:async()=>({status:outcome.status,...('replay'in outcome?{replay:outcome.replay}:{}),authority:'none'})});await purge();expect(fixture.state[9]).toContain(outcome.text);expect(fixture.state[9]).not.toContain('hålls');expect(fixture.fetch).toHaveBeenCalledTimes(1);expect(fixture.state[6]).toBeNull();expect(fixture.state[2]).toBeNull()
})
it('does not interpret an unknown successful HTTP status as a held or completed decision',async()=>{fixture.fetch.mockResolvedValue({ok:true,json:async()=>({status:'unrecognized',authority:'none'})});await purge();expect(fixture.state[9]).toBe('Oväntat svar på gallringsbegäran.');expect(fixture.state[9]).not.toContain('hålls')})

it.each([{status:'purged',replay:true,text:'enbart granskningsmotiveringen'},{status:'disposed',replay:false,text:'har gallrats'},{status:'unavailable',text:'nytt behörigt beslut'}])('new physical-disposition command works by selected ID after disclosure ended and reports $status honestly',async outcome=>{
 fixture.state[6]=null;fixture.fetch.mockResolvedValue({ok:true,json:async()=>({...outcome,authority:'none'})});fixture.cursor=0
 const view=Workspace({companyId:company,userId:actor,permissions});const button=buttons(view).find(b=>text(b.children)==='Verkställ gallring av avslutade granskningsuppgifter');expect(button).toBeDefined();await button!.onClick();expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith(`/api/ediel/decision-evidence-retention/${policyId}/purge`,expect.objectContaining({body:'{}'}));expect(fixture.state[9]).toContain(outcome.text);expect(fixture.state[6]).toBeNull()
})
it('phase review sends the explicit signed receipt and does not confuse approval with physical completion',async()=>{
 const envelope={issuerId:actor,payloadBase64:'SYNTHETIC',signatureHex:'a'.repeat(64)};fixture.state[6]=null;fixture.state[10]={envelope,preview:{companyId:company,policyId,reviewerId:actor,W:'2026-10-18T00:00:00Z',R:'2026-10-19T00:00:00Z',approvalUntil:'2026-10-20T00:00:00Z',fields:[{field:'source_review.reason',purposeReference:'SYNTHETIC purpose',basisReference:'SYNTHETIC basis',min:'2026-10-17',max:'2026-10-18',reviewBy:'2026-10-19'}],terminalFields:[]}};fixture.fetch.mockResolvedValue({ok:true,json:async()=>({status:'approved',authority:'none'})});fixture.cursor=0
 const view=Workspace({companyId:company,userId:actor,permissions:[...permissions,'ediel.retention.review']});const button=buttons(view).find(b=>text(b.children)==='Godkänn separat gallring av uppgifterna');expect(button).toBeDefined();await button!.onClick();expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith(`/api/ediel/decision-evidence-retention/${policyId}/review`,expect.objectContaining({body:JSON.stringify({phase:'completed-witness-disposition',outcome:'approve',issuerReceipt:envelope})}));expect(fixture.state[9]).toContain('ännu inte bekräftad');expect(fixture.state[10]).toBeNull()
})

// Real component/file/click handlers; synthetic React state, File text and HTTP
// are transport fixtures, not verified issuer, browser, SQL or legal evidence.
const parentPermissions=[...permissions,'ediel.retention.read','ediel.retention.review','ediel.retention.blob_decision_evidence']
const purposePayload={format:'ediel_completed_source_parent_purpose_policy_v1',purpose:'ordinary_retention_evidence_use',scope:'ordinary_metadata_and_original_disclosure',companyId:company,policyId,reviewerId:actor,issuerLegalReference:'SYNTHETIC qualified external reference',D:'2026-10-20T00:00:00Z',E:'2026-10-21T00:00:00Z',version:1,fields:[{purposeReference:'SYNTHETIC defined purpose',basisReference:'SYNTHETIC external basis'}]}
const approvalPayload={format:'ediel_completed_source_parent_disposition_bundle_v1',replayScope:'no_parent_replay',companyId:company,policyId,reviewerId:actor,issuerLegalReference:'SYNTHETIC qualified external reference',W:'2026-10-20T00:00:00Z',R:'2026-10-20T00:00:00Z',approvalUntil:'2026-10-21T00:00:00Z',executionActorId:'00000000-0000-4000-8000-000000000003',executionMode:'interactive',replayFields:[],terminalFields:[],fields:[{purposeReference:'SYNTHETIC physical purpose',basisReference:'SYNTHETIC external basis'}]}
function parentEnvelopeFor(payload:unknown){return{issuerId:actor,payloadBase64:Buffer.from(JSON.stringify(payload)).toString('base64'),signatureHex:'a'.repeat(64)}}
function parentView(grants=parentPermissions){fixture.cursor=0;return Workspace({companyId:company,userId:actor,permissions:grants})}
type ParentNode={children?:ReactNode;'aria-label'?:string;disabled?:boolean;onClick?:()=>Promise<void>;onChange?:(e:{target:{files?:File[];value?:string}})=>Promise<void>|void}
function parentNodes(node:ReactNode):ParentNode[]{if(Array.isArray(node))return node.flatMap(parentNodes);if(!isValidElement<ParentNode>(node))return[];return[node.props,...parentNodes(node.props.children)]}
function parentAction(label:string,grants=parentPermissions){const b=parentNodes(parentView(grants)).find(p=>p.onClick&&text(p.children)===label);expect(b).toBeDefined();return b!}
async function chooseParentFile(label:string,payload:unknown){
 fixture.state[11]=policyId
 const envelope=parentEnvelopeFor(payload),content=JSON.stringify(envelope),input=parentNodes(parentView()).find(p=>p['aria-label']===label)
 expect(input?.onChange).toBeDefined();await input!.onChange!({target:{files:[{size:content.length,text:async()=>content} as File]}})
 return envelope
}
it('selects and previews signed parent purpose without POST, fabricated facts or signature-validation claim',async()=>{
 await chooseParentFile('Signerat bevarandebeslut',purposePayload)
 expect(fixture.fetch).not.toHaveBeenCalled();expect(fixture.state[13]).toMatchObject({preview:{policyId,D:purposePayload.D}})
 const view=text(parentView());expect(view).toContain('SYNTHETIC defined purpose');expect(view).toContain('bekräftar inte en verifierad signatur');expect(view).not.toContain('parent_policy.');expect(view).not.toContain('prosrc')
})
it('parent admission sends the unchanged external envelope only on explicit confirmation and preserves ack without a generic GET',async()=>{
 const envelope=await chooseParentFile('Signerat bevarandebeslut',purposePayload)
 fixture.fetch.mockImplementation(async(_url:string,options?:RequestInit)=>options?.method==='POST'?{ok:true,json:async()=>({status:'purpose_admitted',version:1,authority:'none'})}:{ok:false,json:async()=>({error:'DISCLOSURE_ENDED'})})
 await parentAction('Registrera granskat bevarandebeslut').onClick!()
 expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith(`/api/ediel/decision-evidence-retention/${policyId}/review`,expect.objectContaining({body:JSON.stringify({phase:'completed-parent-purpose',issuerReceipt:envelope})}))
 expect(fixture.state[6]).toBeNull();expect(fixture.state[2]).toBeNull();expect(fixture.state[13]).toBeNull();expect(fixture.state[9]).toContain('Gallring har inte bekräftats');expect(fixture.state[9]).not.toContain('DISCLOSURE_ENDED')
})
it.each(['companyId','policyId','reviewerId'])('foreign selected parent purpose %s cannot submit even if handler is invoked directly',async key=>{
 await chooseParentFile('Signerat bevarandebeslut',{...purposePayload,[key]:'00000000-0000-4000-8000-000000000099'})
 const action=parentAction('Registrera granskat bevarandebeslut');expect(action.disabled).toBe(true);await action.onClick!();expect(fixture.fetch).not.toHaveBeenCalled();expect(fixture.state[9]).toContain('måste stämma')
})
it('separate parent approval is not a physical-disposal acknowledgement and uses its own unchanged signed file',async()=>{
 const envelope=await chooseParentFile('Signerat separat gallringsbeslut',approvalPayload)
 expect(fixture.fetch).not.toHaveBeenCalled();fixture.fetch.mockResolvedValue({ok:true,json:async()=>({status:'approved',authority:'none'})})
 await parentAction('Godkänn separat gallring av källunderlaget').onClick!()
 expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith(`/api/ediel/decision-evidence-retention/${policyId}/review`,expect.objectContaining({body:JSON.stringify({phase:'completed-parent-disposition',issuerReceipt:envelope})}))
 expect(fixture.state[9]).toContain('Fysisk gallring har ännu inte bekräftats');expect(fixture.state[14]).toBeNull();expect(fixture.state[6]).toBeNull()
})
it.each([{status:'ordinary_use_ended',want:'läsåtkomsten har upphört'},{status:'POLICY_REVIEW_OVERDUE',want:'granskas på nytt'},{status:'POLICY_OVERDUE',want:'lagringsslut har passerat'},{status:'unavailable',want:'bekräftar inte'}])('minimal $status status stays honest, clears cached disclosure and never auto-renews',async ({status,want})=>{
 fixture.state[11]=policyId;fixture.fetch.mockResolvedValue({ok:true,json:async()=>status==='unavailable'?{status,authority:'none'}:{status,disposed:false,authority:'none'}})
 await parentAction('Visa bevarandestatus').onClick!()
 expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith(`/api/ediel/decision-evidence-retention/${policyId}/parent-purpose`,expect.objectContaining({method:'GET'}));expect(fixture.state[9]).toContain(want);expect(fixture.state[6]).toBeNull();expect(fixture.state[2]).toBeNull();expect(fixture.state[12]).toEqual(status==='unavailable'?{status,authority:'none'}:{status,disposed:false,authority:'none'})
})
it.each([{status:'disposed',replay:false,authority:'none',want:'har gallrats'},{status:'held',authority:'none',want:'har inte verkställts'},{status:'unavailable',authority:'none',want:'Ingen gallring'}])('parent effect $status is distinct, clears cached data and has no mandatory disclosure read',async ({want,...result})=>{
 fixture.state[11]=policyId;fixture.state[6]=null;fixture.fetch.mockResolvedValue({ok:true,json:async()=>result})
 await parentAction('Verkställ beslutad gallring av källunderlaget').onClick!();expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith(`/api/ediel/decision-evidence-retention/${policyId}/purge`,expect.objectContaining({body:JSON.stringify({phase:'completed-parent-disposition'})}));expect(fixture.state[9]).toContain(want);expect(fixture.state[2]).toBeNull()
})
it.each([{status:'disposed',replay:true,authority:'none'},{status:'expired',authority:'none'},{status:'purged',replay:true,authority:'none'},{status:'unavailable',authority:'none',disposed:true}])('parent handler refuses legacy replay/expiry/extra native output $status',async result=>{
 fixture.state[11]=policyId;fixture.fetch.mockResolvedValue({ok:true,json:async()=>result});await parentAction('Verkställ beslutad gallring av källunderlaget').onClick!();expect(fixture.state[9]).toBe('Oväntat svar för källunderlaget.');expect(fixture.state[9]).not.toContain('hålls')
})
it('parent HTTP403 remains a refusal and cannot become held or a physical success',async()=>{
 fixture.state[11]=policyId;fixture.fetch.mockResolvedValue({ok:false,json:async()=>({error:'Aktuell bolags-, klass- eller källbehörighet saknas.'})});await parentAction('Verkställ beslutad gallring av källunderlaget').onClick!();expect(fixture.state[9]).toBe('Aktuell bolags-, klass- eller källbehörighet saknas.');expect(fixture.state[9]).not.toContain('hålls')
})
it('missing either parent mutation class prevents an actual handler effect despite legacy operation permission',async()=>{
 fixture.state[11]=policyId;const action=parentAction('Verkställ beslutad gallring av källunderlaget',parentPermissions.filter(key=>key!=='ediel.retention.completed_review_reason'));expect(action.disabled).toBe(true);await action.onClick!();expect(fixture.fetch).not.toHaveBeenCalled()
})
it('changing parent target clears both signed files, status and previous disclosure without a network call',async()=>{
 await chooseParentFile('Signerat bevarandebeslut',purposePayload);await chooseParentFile('Signerat separat gallringsbeslut',approvalPayload);fixture.state[12]={status:'active',disposed:false,authority:'none'}
 const input=parentNodes(parentView()).find(p=>p['aria-label']==='Det tidigare källunderlagets ID');await input!.onChange!({target:{value:'different'}});expect(fixture.state[13]).toBeNull();expect(fixture.state[14]).toBeNull();expect(fixture.state[12]).toBeNull();expect(fixture.state[6]).toBeNull();expect(fixture.fetch).not.toHaveBeenCalled()
})

it('invalid signed preview neither posts nor exposes internal validation fields as a workflow',async()=>{
 fixture.state[11]=policyId;const input=parentNodes(parentView()).find(p=>p['aria-label']==='Signerat bevarandebeslut');await input!.onChange!({target:{files:[{size:2,text:async()=>'{invalid'} as File]}});expect(fixture.fetch).not.toHaveBeenCalled();expect(fixture.state[13]).toBeNull();expect(fixture.state[9]).toBe('Det signerade underlaget kunde inte läsas. Välj rätt underlag för denna åtgärd.');expect(fixture.state[9]).not.toContain('payloadBase64')
})

it('cancelled destructive confirmation sends no parent command and reports no physical effect',async()=>{fixture.state[11]=policyId;fixture.confirm.mockReturnValue(false);await parentAction('Verkställ beslutad gallring av källunderlaget').onClick!();expect(fixture.confirm).toHaveBeenCalledOnce();expect(fixture.fetch).not.toHaveBeenCalled();expect(fixture.state[9]).toBe('Gallringen avbröts. Ingen åtgärd har skickats.');expect(fixture.state[2]).not.toBeNull()})

// Deferred responses exercise the real captured handler and real target-change
// handler. Changing even A→B→A retires the old request, rather than relabelling it.
const otherParent='00000000-0000-4000-8000-000000000099'
function deferredParentResponse(){let release!:(value:unknown)=>void;const pending=new Promise<unknown>(resolve=>{release=resolve});return{pending,release}}
async function changeParentDuringRequest(){const input=parentNodes(parentView()).find(p=>p['aria-label']==='Det tidigare källunderlagets ID');await input!.onChange!({target:{value:otherParent}})}
it('deferred status for parent A cannot repopulate active under selected parent B',async()=>{
 fixture.state[11]=policyId;const response=deferredParentResponse();fixture.fetch.mockReturnValue(response.pending)
 const pending=parentAction('Visa bevarandestatus').onClick!();await changeParentDuringRequest()
 response.release({ok:true,json:async()=>({status:'active',disposed:false,authority:'none'})});await pending
 expect(fixture.state[11]).toBe(otherParent);expect(fixture.state[12]).toBeNull();expect(fixture.state[9]).not.toContain('är aktuellt')
 expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith(`/api/ediel/decision-evidence-retention/${policyId}/parent-purpose`,expect.objectContaining({method:'GET'}))
})
it.each([
 {caseName:'purpose admission',action:'Registrera granskat bevarandebeslut',file:'Signerat bevarandebeslut',payload:purposePayload,result:{status:'purpose_admitted',version:1,authority:'none'},phase:'completed-parent-purpose',endpoint:'review'},
 {caseName:'separate approval',action:'Godkänn separat gallring av källunderlaget',file:'Signerat separat gallringsbeslut',payload:approvalPayload,result:{status:'approved',authority:'none'},phase:'completed-parent-disposition',endpoint:'review'},
 {caseName:'physical disposition',action:'Verkställ beslutad gallring av källunderlaget',file:null,payload:null,result:{status:'disposed',replay:false,authority:'none'},phase:'completed-parent-disposition',endpoint:'purge'},
])('deferred successful $caseName for parent A cannot acknowledge under selected B',async ({action,file,payload,result,phase,endpoint})=>{
 fixture.state[11]=policyId;const envelope=file?await chooseParentFile(file,payload):null,response=deferredParentResponse();fixture.fetch.mockReturnValue(response.pending)
 const pending=parentAction(action).onClick!();await changeParentDuringRequest();response.release({ok:true,json:async()=>result});await pending
 expect(fixture.state[11]).toBe(otherParent);expect(fixture.state[12]).toBeNull();expect(fixture.state[9]).toBe('')
 expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith(`/api/ediel/decision-evidence-retention/${policyId}/${endpoint}`,expect.objectContaining({method:'POST',body:JSON.stringify(envelope?{phase,issuerReceipt:envelope}:{phase})}))
})

it('deferred status cannot survive an A to B to A target roundtrip',async()=>{
 fixture.state[11]=policyId;const response=deferredParentResponse();fixture.fetch.mockReturnValue(response.pending);const pending=parentAction('Visa bevarandestatus').onClick!();await changeParentDuringRequest();const input=parentNodes(parentView()).find(p=>p['aria-label']==='Det tidigare källunderlagets ID');await input!.onChange!({target:{value:policyId}});response.release({ok:true,json:async()=>({status:'active',disposed:false,authority:'none'})});await pending;expect(fixture.state[11]).toBe(policyId);expect(fixture.state[12]).toBeNull();expect(fixture.state[9]).toBe('')
})
it('deferred error for retired A neither replaces B feedback nor ends the newer B request',async()=>{
 fixture.state[11]=policyId;const first=deferredParentResponse(),second=deferredParentResponse();fixture.fetch.mockReturnValueOnce(first.pending).mockReturnValueOnce(second.pending);const a=parentAction('Visa bevarandestatus').onClick!();await changeParentDuringRequest();const b=parentAction('Visa bevarandestatus').onClick!();first.release({ok:false,json:async()=>({error:'RETIRED_A_CURRENT_SCOPE_DENIED'})});await a;expect(fixture.state[8]).toBe(true);expect(fixture.state[9]).toBe('');second.release({ok:true,json:async()=>({status:'ordinary_use_ended',disposed:false,authority:'none'})});await b;expect(fixture.state[11]).toBe(otherParent);expect(fixture.state[12]).toEqual({status:'ordinary_use_ended',disposed:false,authority:'none'});expect(fixture.state[8]).toBe(false);expect(fixture.state[9]).toContain('läsåtkomsten har upphört');expect(fixture.state[9]).not.toContain('RETIRED_A')
})
it.each([
 {caseName:'purpose file',label:'Signerat bevarandebeslut',payload:purposePayload,stateIndex:13},
 {caseName:'disposition file',label:'Signerat separat gallringsbeslut',payload:approvalPayload,stateIndex:14},
])('deferred signed $caseName preview for A cannot reinstall after selecting B',async ({label,payload,stateIndex})=>{
 fixture.state[11]=policyId;const response=deferredParentResponse(),content=JSON.stringify(parentEnvelopeFor(payload)),input=parentNodes(parentView()).find(p=>p['aria-label']===label)
 const pending=input!.onChange!({target:{files:[{size:content.length,text:async()=>String(await response.pending)} as File]}});await changeParentDuringRequest();response.release(content);await pending
 expect(fixture.state[11]).toBe(otherParent);expect(fixture.state[stateIndex]).toBeNull();expect(fixture.state[9]).toBe('');expect(fixture.fetch).not.toHaveBeenCalled()
})
