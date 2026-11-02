// Finite driver/oracle controls only. No native service, admitted actor, real
// customer, email delivery or whole TERM01.05 scenario PASS is claimed here.
import {createHash} from 'node:crypto'
import {describe,expect,it,vi} from 'vitest'
vi.mock('@/scripts/simulation/track2/lib/env',()=>({sim:{appUrl:'http://127.0.0.1:54399'}}))
vi.mock('@/scripts/simulation/track2/lib/db',()=>({psqlRows:vi.fn()}))
vi.mock('@/scripts/simulation/track2/lib/session',()=>({loginSession:vi.fn()}))
vi.mock('@/scripts/simulation/track2/lib/server-action',()=>({callServerAction:vi.fn()}))
import {assertAmendmentHistoryPreserved,assertAmendmentProposalResult,readSignedAmendmentInput,runSignedAmendmentScenario,
 type AmendmentPreservedState,type SignedAmendmentScenarioInput,type SignedAmendmentScenarioPorts} from '@/scripts/simulation/track2/lib/term-amendment'
import type {AppSession} from '@/scripts/simulation/track2/lib/session'
import type {ServerActionResult} from '@/scripts/simulation/track2/lib/server-action'
const id=(n:number)=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const input:SignedAmendmentScenarioInput={schema:'gridex-t2-term0105-input-v1',environmentId:'finite-component-only',sourceCommit:'a'.repeat(40),assignmentSha256:'b'.repeat(64),
 companyId:id(1),customerId:id(2),siteId:id(3),meteringPointId:id(4),physicalContractId:id(5),supplyPeriodId:id(6),successorOfferId:id(7),priceOptionReference:'indefinite-new',effectiveFrom:'2026-12-01',
 predecessorMonthlyFeeSek:59,successorMonthlyFeeSek:69,admin:{userId:id(8),email:'synthetic@example.invalid',password:'finite-not-real'},recipientEmail:'customer@example.invalid'}
const state:AmendmentPreservedState={rootHash:'a'.repeat(64),rootPriceHash:'b'.repeat(64),supplyHash:'c'.repeat(64),allSupplyHash:'d'.repeat(64),sourceBasisHash:'e'.repeat(64),switchesHash:'f'.repeat(64)}
const result=(value:unknown,patch:Partial<ServerActionResult>={}):ServerActionResult=>({httpStatus:200,redirect:null,value,threw:false,errorRows:[],excerpt:'',...patch})
const expected={requestId:id(9),predecessorId:id(5),successorId:id(10),effectiveFrom:input.effectiveFrom}
function proposal(){return {status:'proposed',receipt:{state:'PROPOSED_NOT_ACCEPTED',proposalId:id(9),predecessorContractId:id(5),successorContractId:id(10),effectiveFrom:input.effectiveFrom,proposalSHA256:'a'.repeat(64)}}}
it('requires a real distinct positive commercial change and bounded synthetic scope',()=>{
 expect(readSignedAmendmentInput(input)).toEqual(input)
 for(const patch of [{successorMonthlyFeeSek:59},{companyId:'not-a-uuid'},{effectiveFrom:'2026-12-02'},{recipientEmail:'real@example.com'},{sourceCommit:'unknown'}]) {
  expect(()=>readSignedAmendmentInput({...input,...patch})).toThrow(/term0105_/)
 }
})
it.each(['rootHash','rootPriceHash','supplyHash','allSupplyHash','sourceBasisHash','switchesHash'] as const)('a changed original %s is never a successful amendment',key=>{
 expect(()=>assertAmendmentHistoryPreserved(state,{...state,[key]:'0'.repeat(64)})).toThrow('term0105_original_history_changed:'+key)
})
it('does not confuse a staff proposal, transport success or unsigned edit with a new signed version',()=>{
 expect(assertAmendmentProposalResult(result(proposal()),expected)).toEqual(proposal().receipt)
 for(const actual of [result({status:'saved'}),result(proposal(),{httpStatus:500}),result(proposal(),{threw:true}),result(proposal(),{redirect:'/login'}),result({...proposal(),receipt:{...proposal().receipt,successorContractId:id(11)}})]) {
  expect(()=>assertAmendmentProposalResult(actual,expected)).toThrow(/term0105_/)
 }
})
function fixture(options:{historyChanged?:boolean;acceptanceInvalid?:boolean;proposalUnconfirmed?:boolean;unsignedOnly?:boolean}={}) {
 let accepted=false,requestId=''
 const token='1'.repeat(64),contextSha='2'.repeat(64),successorId=id(10),priceId=id(11)
 const steps:string[]=[],sqlReads:string[]=[]
 const session={userId:id(8),cookieHeader:'finite-cookie',actorProof:{intent:'authorized',userId:id(8),companyId:id(1),environmentId:input.environmentId,
  sourceCommit:input.sourceCommit,assignmentSha256:input.assignmentSha256,authVerified:true,tenantRoleVerified:true,selectedCompanyVerified:true}} as AppSession
 const context={predecessorContractId:id(5),successorContractId:successorId,effectiveFrom:input.effectiveFrom,predecessorReference:'OLD-001'}
 const ports:SignedAmendmentScenarioPorts={
  read<T>(sql:string):T[] {
   sqlReads.push(sql);expect(/^select\s/i.test(sql.trim())).toBe(true)
   let rows:unknown[]
   if(sql.includes('as "rootHash"')) rows=[{...state,rootHash:accepted&&options.historyChanged?'0'.repeat(64):state.rootHash,qualified:true,scope:true}]
   else if(sql.includes('gridex_read_contract_commercial_segments_v1')) {
    const old=!accepted||sql.includes("-interval '1 day'")
    rows=[{assignment:{schema:'gridex-contract-commercial-segments-v1',physicalContractId:id(5),assignmentSHA256:'3'.repeat(64),segments:[{contractId:old?id(5):successorId,priceSnapshotId:old?null:priceId}]}}]
   } else if(sql.includes('rendered_snapshot')) rows=[{request_id:id(12),token_hash:createHash('sha256').update(token).digest('hex'),context_sha:contextSha,context,
    html:`<a href="http://127.0.0.1:54399/sign/contract/${token}">Signera</a>`}]
   else if(sql.includes('join gridex_contract_amendment.acceptances')) rows=[{id:successorId,price_id:priceId,predecessor_price_id:id(13),signature_sha:'4'.repeat(64),acceptance_sha:'5'.repeat(64),valid:!options.acceptanceInvalid,monthly_fee:'69'}]
   else if(sql.includes('select id,status,signed_at')) rows=[{id:id(5),status:'signed',signed_at:'old'},{id:successorId,status:'draft',signed_at:null}]
   else rows=[{id:id(5)}]
   return rows as T[]
  },
  async action(actor,action) {
   steps.push(action.exportedName)
   const form=action.args[0] as FormData
   if(action.exportedName==='createContractFromOfferAction') {
    expect(form.get('signing_method')).toBe('draft');expect(form.get('customer_id')).toBe(input.customerId)
    return result(null,{httpStatus:303,redirect:`/admin/customers/${input.customerId}/contracts/${successorId}/signature;push`})
   }
   if(action.exportedName==='proposeSignedContractAmendmentAction') {
    requestId=String(form.get('request_id'))
    return result(options.proposalUnconfirmed?{status:'unconfirmed'}:{status:'proposed',receipt:{...proposal().receipt,proposalId:requestId}})
   }
   if(action.exportedName==='sendContractSignatureLinkAction') return result(null,{httpStatus:303,redirect:`/admin/customers/${input.customerId}/contracts/${successorId}/signature?sent=1&delivery=queued;push`})
   expect(action.route).toBe('/sign/contract/REDACTED');expect(actor.cookieHeader).toBe('')
   expect(form.get('amendment_accepted')).toBe('yes');expect(form.get('amendment_context_sha256')).toBe(contextSha)
   expect(form.get('power_of_attorney_accepted')).toBe('yes')
   accepted=!options.unsignedOnly
   return result(null,{httpStatus:303,redirect:`/sign/contract/${token}?signed=1;push`})
  },
  async publicFetch(route) {
   expect(route).toBe(`/sign/contract/${token}`)
   return new Response(`<form><input name="amendment_context_sha256" value="${contextSha}"><input name="amendment_accepted" required>
    <input name="power_of_attorney_accepted"><input name="power_of_attorney_terms_version" value="ops_online_poa_v1"><button type="submit">Signera</button>
    <p>OLD-001 1 december 2026</p></form>`,{status:200})
  },
 }
 return {run:()=>runSignedAmendmentScenario(input,session,ports),steps,sqlReads}
}
describe('finite actual driver sequence',()=>{
 it('uses ordinary draft, amendment, signing-link and public customer actions, then independently reads accepted state/history',async()=>{
  const f=fixture(),evidence=await f.run()
  expect(f.steps).toEqual(['createContractFromOfferAction','proposeSignedContractAmendmentAction','sendContractSignatureLinkAction','signContractAction'])
  expect(evidence).toMatchObject({coverage:'POSITIVE_SIGNED_AMENDMENT_ONLY',predecessorPreserved:true,physicalSupplyPreserved:true,
   emailDelivery:'NOT_ASSERTED_CONTROLLED_SYNTHETIC_CUSTOMER_OBSERVES_NORMAL_QUEUED_LINK'})
  expect(f.sqlReads.length).toBeGreaterThan(5)
 })
 it('stops after an unconfirmed proposal without repeating it or sending a new link',async()=>{
  const f=fixture({proposalUnconfirmed:true})
  await expect(f.run()).rejects.toThrow('term0105_proposal_receipt_mismatch')
  expect(f.steps).toHaveLength(2)
 })
 it('refuses a success-looking public redirect with missing actual acceptance evidence',async()=>{
  await expect(fixture({acceptanceInvalid:true}).run()).rejects.toThrow('term0105_actual_version_evidence_invalid')
 })
 it('an unsigned-only mutation cannot replace the actual effective commercial assignment',async()=>{
  await expect(fixture({unsignedOnly:true}).run()).rejects.toThrow('term0105_effective_version_mismatch')
 })
 it('rejects any silent predecessor/source rewrite after successful customer consent',async()=>{
  await expect(fixture({historyChanged:true}).run()).rejects.toThrow('term0105_original_history_changed:rootHash')
 })
})
