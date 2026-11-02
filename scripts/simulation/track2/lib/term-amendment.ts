// TERM01.05 positive path. Executed ONLY inside T4's admitted existing producer.
// No trust/supply/metering SQL writes, runtime allocation or clock replacement.
import {createHash,randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {psqlRows} from './db'
import {sim} from './env'
import {loginSession,type AppSession} from './session'
import {callServerAction,type ServerActionResult} from './server-action'

type Row=Record<string,unknown>
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const sha=/^[0-9a-f]{64}$/
const lit=(value:string)=>`'${value.replaceAll("'","''")}'`
const record=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{}
const hash=(raw:Buffer|string)=>createHash('sha256').update(raw).digest('hex')
function requireCondition(condition:unknown,code:string):asserts condition {if(!condition) throw Error(code)}
function privateBytes(filename:string):Buffer {
 requireCondition(path.isAbsolute(filename)&&fs.realpathSync(filename)===filename,'term0105_private_path_invalid')
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW)
 try {
  const info=fs.fstatSync(fd)
  requireCondition(info.isFile()&&info.uid===process.getuid?.()&&(info.mode&0o777)===0o600&&info.size<=65536,'term0105_input_not_private')
  return fs.readFileSync(fd)
 } finally {fs.closeSync(fd)}
}
export type SignedAmendmentScenarioInput={
 schema:'gridex-t2-term0105-input-v1';environmentId:string;sourceCommit:string;assignmentSha256:string
 companyId:string;customerId:string;siteId:string;meteringPointId:string;physicalContractId:string;supplyPeriodId:string
 successorOfferId:string;priceOptionReference:string;effectiveFrom:string;predecessorMonthlyFeeSek:number;successorMonthlyFeeSek:number
 admin:{userId:string;email:string;password:string};recipientEmail:string
}
export function readSignedAmendmentInput(value:unknown):SignedAmendmentScenarioInput {
 const v=record(value),admin=record(v.admin)
 requireCondition(v.schema==='gridex-t2-term0105-input-v1'&&typeof v.environmentId==='string'&&v.environmentId.length>0
  &&typeof v.sourceCommit==='string'&&/^[0-9a-f]{40}$/.test(v.sourceCommit)&&typeof v.assignmentSha256==='string'&&sha.test(v.assignmentSha256),'term0105_input_binding_invalid')
 for(const key of ['companyId','customerId','siteId','meteringPointId','physicalContractId','supplyPeriodId','successorOfferId']) {
  requireCondition(typeof v[key]==='string'&&uuid.test(v[key] as string)&&v[key]!=='00000000-0000-0000-0000-000000000000','term0105_input_scope_invalid')
 }
 requireCondition(typeof v.effectiveFrom==='string'&&/^\d{4}-\d{2}-01$/.test(v.effectiveFrom)
  &&!v.effectiveFrom.startsWith('0000-')&&new Date(v.effectiveFrom+'T00:00:00Z').toISOString().slice(0,10)===v.effectiveFrom,'term0105_effective_month_invalid')
 requireCondition(typeof v.priceOptionReference==='string'&&v.priceOptionReference.length>0&&v.priceOptionReference.length<=128
  &&Number.isFinite(v.predecessorMonthlyFeeSek)&&Number.isFinite(v.successorMonthlyFeeSek)
  &&v.predecessorMonthlyFeeSek!==v.successorMonthlyFeeSek,'term0105_positive_terms_change_required')
 requireCondition(typeof admin.userId==='string'&&uuid.test(admin.userId)&&typeof admin.email==='string'&&admin.email.endsWith('.invalid')
  &&typeof admin.password==='string'&&admin.password.length>0&&typeof v.recipientEmail==='string'&&v.recipientEmail.endsWith('.invalid'),'term0105_synthetic_actor_required')
 return v as SignedAmendmentScenarioInput
}
export function assertAmendmentProposalResult(result:ServerActionResult,expected:{requestId:string;predecessorId:string;successorId:string;effectiveFrom:string}):Row {
 requireCondition(result.httpStatus===200&&!result.threw&&result.errorRows.length===0&&result.redirect===null,'term0105_proposal_transport_unconfirmed')
 const outcome=record(result.value),receipt=record(outcome.receipt)
 requireCondition(outcome.status==='proposed'&&receipt.state==='PROPOSED_NOT_ACCEPTED'&&receipt.proposalId===expected.requestId
  &&receipt.predecessorContractId===expected.predecessorId&&receipt.successorContractId===expected.successorId
  &&receipt.effectiveFrom===expected.effectiveFrom&&typeof receipt.proposalSHA256==='string'&&sha.test(receipt.proposalSHA256),'term0105_proposal_receipt_mismatch')
 return receipt
}
export type AmendmentPreservedState={rootHash:string;rootPriceHash:string;supplyHash:string;allSupplyHash:string;sourceBasisHash:string;switchesHash:string}
export function assertAmendmentHistoryPreserved(before:AmendmentPreservedState,after:AmendmentPreservedState) {
 for(const key of ['rootHash','rootPriceHash','supplyHash','allSupplyHash','sourceBasisHash','switchesHash'] as const) {
  requireCondition(sha.test(before[key])&&before[key]===after[key],'term0105_original_history_changed:'+key)
 }
}
type Action=Parameters<typeof callServerAction>[1]
export type SignedAmendmentScenarioPorts={
 read<T>(sql:string):T[]
 action(session:AppSession,input:Action):Promise<ServerActionResult>
 publicFetch(route:string,init?:RequestInit):Promise<Response>
}
const actualPorts:SignedAmendmentScenarioPorts={read:psqlRows,action:callServerAction,
 publicFetch:async(route,init={})=>fetch(new URL(route,sim.appUrl),{...init,redirect:'manual'})}
function exactlyOne<T>(rows:T[],code:string):T {requireCondition(rows.length===1,code);return rows[0]}
function state(input:SignedAmendmentScenarioInput,ports:SignedAmendmentScenarioPorts):AmendmentPreservedState {
 const c=lit(input.companyId),root=lit(input.physicalContractId),point=lit(input.meteringPointId),period=lit(input.supplyPeriodId),day=lit(input.effectiveFrom)
 const row=exactlyOne(ports.read<AmendmentPreservedState&{qualified:boolean;scope:boolean}>(`select
  public.canonical_json_sha256(to_jsonb(ct)) as "rootHash",public.canonical_json_sha256(to_jsonb(ps)) as "rootPriceHash",
  public.canonical_json_sha256(to_jsonb(sp)) as "supplyHash",
  public.canonical_json_sha256(coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.customer_supply_periods p where p.company_id=${c} and p.metering_point_id=${point}),'[]')) as "allSupplyHash",
  public.canonical_json_sha256(b.basis) as "sourceBasisHash",(b.basis->>'qualified')::boolean qualified,
  public.canonical_json_sha256(coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.supplier_switch_requests s where s.company_id=${c} and s.metering_point_id=${point}),'[]')) as "switchesHash",
  (ct.customer_id=${lit(input.customerId)} and coalesce(ct.customer_site_id,ct.site_id)=${lit(input.siteId)} and ct.metering_point_id=${point}
   and sp.customer_id=ct.customer_id and sp.metering_point_id=ct.metering_point_id and sp.contract_id=ct.id and sp.status='active'
   and ct.signed_at is not null and ct.locked_at is not null and coalesce(ct.binding_months,0)=0 and ct.ends_at is null
   and ct.monthly_fee_sek=${input.predecessorMonthlyFeeSek}) scope
 from public.customer_contracts ct join public.contract_price_snapshots ps on ps.id=ct.contract_price_snapshot_id and ps.company_id=ct.company_id and ps.contract_id=ct.id
 join public.customer_supply_periods sp on sp.id=${period} and sp.company_id=ct.company_id
 cross join lateral (select gridex_received_sources.billing_supply_basis_v1(${c},${period},${day}::date::timestamp at time zone 'Europe/Stockholm',(${day}::date+interval '1 month') at time zone 'Europe/Stockholm') basis) b
 where ct.id=${root} and ct.company_id=${c}`),'term0105_original_scope_missing')
 requireCondition(row.qualified===true&&row.scope===true,'term0105_actual_qualified_supply_required')
 return row
}
function commercial(input:SignedAmendmentScenarioInput,before:boolean,ports:SignedAmendmentScenarioPorts):Row {
 const day=lit(input.effectiveFrom)
 return record(exactlyOne(ports.read<{assignment:unknown}>(`select public.gridex_read_contract_commercial_segments_v1(${lit(input.companyId)},${lit(input.supplyPeriodId)},
  (${day}::date${before?"-interval '1 day'":""})::timestamp at time zone 'Europe/Stockholm',
  (${day}::date${before?'':"+interval '1 month'"})::timestamp at time zone 'Europe/Stockholm') assignment`),'term0105_commercial_read_missing').assignment)
}
function assertSelection(assignment:Row,physicalId:string,contractId:string,priceId:string|null) {
 requireCondition(assignment.schema==='gridex-contract-commercial-segments-v1'&&assignment.physicalContractId===physicalId
  &&typeof assignment.assignmentSHA256==='string'&&sha.test(assignment.assignmentSHA256)&&Array.isArray(assignment.segments)&&assignment.segments.length===1,'term0105_commercial_assignment_invalid')
 const segment=record(assignment.segments[0])
 requireCondition(segment.contractId===contractId&&segment.priceSnapshotId===priceId,'term0105_effective_version_mismatch')
}
async function htmlDocument(html:string) {
 // Use the same installed full HTML decoder as the existing privacy harness.
 const moduleName:string='next/dist/compiled/node-html-parser/index.js'
 const imported=await import(moduleName),api=(imported.parse?imported:imported.default) as {parse:(html:string)=>{querySelectorAll:(selector:string)=>Array<{getAttribute:(name:string)=>string|undefined;hasAttribute:(name:string)=>boolean}>;text:string}}
 requireCondition(typeof api?.parse==='function','term0105_html_decoder_unqualified')
 return api.parse(html)
}

/** Ordinary app writes only. The controlled synthetic customer uses the real
 * app-generated queued link observed read-only in communication_logs; actual
 * email transport/delivery is NOT asserted by TERM01.05 and is reported below.
 * All legacy negative immutability cases remain in term01.test.ts separately. */
export async function runSignedAmendmentScenario(input:SignedAmendmentScenarioInput,session:AppSession,ports:SignedAmendmentScenarioPorts=actualPorts) {
 input=readSignedAmendmentInput(input)
 const proof=session.actorProof
 requireCondition(proof?.intent==='authorized'&&proof.userId===input.admin.userId&&proof.companyId===input.companyId
  &&proof.environmentId===input.environmentId&&proof.sourceCommit===input.sourceCommit&&proof.assignmentSha256===input.assignmentSha256
  &&proof.authVerified&&proof.tenantRoleVerified&&proof.selectedCompanyVerified,'term0105_actual_actor_binding_required')
 const before=state(input,ports)
 assertSelection(commercial(input,false,ports),input.physicalContractId,input.physicalContractId,null)
 const known=new Set(ports.read<{id:string}>(`select id from public.customer_contracts where company_id=${lit(input.companyId)} and customer_id=${lit(input.customerId)}`).map(x=>x.id))
 const createForm=new FormData()
 for(const [key,value] of Object.entries({customer_id:input.customerId,contract_offer_id:input.successorOfferId,site_id:input.siteId,
  metering_point_id:input.meteringPointId,starts_at:input.effectiveFrom,signing_method:'draft',invoice_delivery_method:'email',price_option_reference:input.priceOptionReference})) createForm.set(key,value)
 const created=await ports.action(session,{route:`/admin/customers/${input.customerId}`,filename:'components/admin/customers/contracts/actions.ts',exportedName:'createContractFromOfferAction',args:[createForm],worker:'app/admin/customers/[id]/page'})
 requireCondition([200,303].includes(created.httpStatus)&&!created.threw&&created.errorRows.length===0,'term0105_normal_draft_creation_unconfirmed')
 const successor=exactlyOne(ports.read<{id:string;status:string;signed_at:string|null}>(`select id,status,signed_at from public.customer_contracts where company_id=${lit(input.companyId)} and customer_id=${lit(input.customerId)}`).filter(x=>!known.has(x.id)),'term0105_new_version_not_unique')
 requireCondition(uuid.test(successor.id)&&successor.id!==input.physicalContractId&&successor.status==='draft'&&successor.signed_at===null,'term0105_new_unsigned_version_required')
 requireCondition(created.redirect?.startsWith(`/admin/customers/${input.customerId}/contracts/${successor.id}/signature`),'term0105_normal_draft_redirect_unconfirmed')
 const requestId=randomUUID(),form=new FormData()
 for(const [key,value] of Object.entries({customer_id:input.customerId,predecessor_contract_id:input.physicalContractId,successor_contract_id:successor.id,
  request_id:requestId,effective_from:input.effectiveFrom,reason:'Synthetic TERM01.05 explicit future commercial change',acknowledge_new_signature:'on'})) form.set(key,value)
 const proposal=assertAmendmentProposalResult(await ports.action(session,{route:`/admin/customers/${input.customerId}/contracts/${input.physicalContractId}/amend`,
  filename:'app/admin/customers/[id]/contracts/[contractId]/amend/actions.ts',exportedName:'proposeSignedContractAmendmentAction',args:[form],worker:'app/admin/customers/[id]/contracts/[contractId]/amend/page'}),
  {requestId,predecessorId:input.physicalContractId,successorId:successor.id,effectiveFrom:input.effectiveFrom})
 // A staff proposal alone has no effect on the future commercial assignment.
 assertSelection(commercial(input,false,ports),input.physicalContractId,input.physicalContractId,null)
 assertSelection(commercial(input,true,ports),input.physicalContractId,input.physicalContractId,null)
 const sendForm=new FormData();sendForm.set('customer_id',input.customerId);sendForm.set('contract_id',successor.id);sendForm.set('recipient_email',input.recipientEmail)
 const sent=await ports.action(session,{route:`/admin/customers/${input.customerId}/contracts/${successor.id}/signature`,filename:'app/admin/customers/[id]/contracts/[contractId]/signature/actions.ts',exportedName:'sendContractSignatureLinkAction',args:[sendForm],worker:'app/admin/customers/[id]/contracts/[contractId]/signature/page'})
 requireCondition([200,303].includes(sent.httpStatus)&&!sent.threw&&sent.errorRows.length===0&&sent.redirect?.includes(`/contracts/${successor.id}/signature?sent=1`),'term0105_normal_signing_preparation_unconfirmed')
 const queued=exactlyOne(ports.read<{request_id:string;token_hash:string;context_sha:string;html:string;context:Row}>(`select r.id request_id,r.token_hash,r.metadata->>'amendment_context_sha256' context_sha,
  r.metadata->'amendment_context' context,l.metadata#>>'{rendered_snapshot,html}' html from public.customer_contract_signature_requests r
  join public.communication_logs l on l.company_id=r.company_id and l.customer_id=r.customer_id and l.contract_id=r.customer_contract_id and l.metadata->>'signature_request_id'=r.id::text
  where r.company_id=${lit(input.companyId)} and r.customer_contract_id=${lit(successor.id)} and r.used_at is null and r.revoked_at is null
  and l.event_key='contract.signature_requested' and l.recipient_email=${lit(input.recipientEmail)}`),'term0105_normal_queued_link_missing')
 requireCondition(sha.test(queued.context_sha)&&queued.context.predecessorContractId===input.physicalContractId&&queued.context.successorContractId===successor.id
  &&queued.context.effectiveFrom===input.effectiveFrom,'term0105_customer_context_missing')
 const document=await htmlDocument(queued.html)
 const links=document.querySelectorAll('a[href]').map(a=>a.getAttribute('href')).filter((url):url is string=>Boolean(url))
 const candidates=links.map(url=>new URL(url,sim.appUrl)).filter(url=>url.origin===new URL(sim.appUrl).origin&&/^\/sign\/contract\/[a-f0-9]{64}$/.test(url.pathname))
 const unique=[...new Set(candidates.map(url=>url.pathname))]
 requireCondition(unique.length===1,'term0105_queued_link_ambiguous')
 const route=unique[0],token=route.slice(route.lastIndexOf('/')+1)
 requireCondition(hash(token)===queued.token_hash,'term0105_link_not_original_request')
 const response=await ports.publicFetch(route)
 requireCondition(response.status===200,'term0105_customer_page_unavailable')
 const page=await htmlDocument(await response.text()),inputs=page.querySelectorAll('input')
 const named=(name:string)=>inputs.filter(x=>x.getAttribute('name')===name)
 requireCondition(named('amendment_context_sha256').length===1&&named('amendment_context_sha256')[0].getAttribute('value')===queued.context_sha
  &&named('amendment_accepted').length===1&&named('amendment_accepted')[0].hasAttribute('required')
  &&page.text.includes(String(queued.context.predecessorReference))
  &&page.text.includes(new Intl.DateTimeFormat('sv-SE',{dateStyle:'long',timeZone:'Europe/Stockholm'}).format(new Date(input.effectiveFrom+'T12:00:00Z')))
  &&page.querySelectorAll('button[type="submit"]').some(button=>!button.hasAttribute('disabled')),'term0105_customer_visible_change_unqualified')
 const signing=new FormData();signing.set('token',token);signing.set('amendment_context_sha256',queued.context_sha);signing.set('amendment_accepted','yes')
 if(named('power_of_attorney_accepted').length) {
  requireCondition(named('power_of_attorney_terms_version').length===1,'term0105_normal_poa_terms_missing')
  signing.set('power_of_attorney_accepted','yes');signing.set('power_of_attorney_terms_version',named('power_of_attorney_terms_version')[0].getAttribute('value')??'')
 }
 // Redact the generic action logger's route. The public transport supplies no
 // admin cookies; only this exact fixed placeholder is mapped to the real URL.
 const publicSession:AppSession={userId:'synthetic-public-customer',cookieHeader:'',fetch:(request,init)=>{
  requireCondition(request==='/sign/contract/REDACTED','term0105_public_route_mismatch');return ports.publicFetch(route,init)
 }}
 const signed=await ports.action(publicSession,{route:'/sign/contract/REDACTED',filename:'app/sign/contract/[token]/actions.ts',exportedName:'signContractAction',args:[signing],worker:'app/sign/contract/[token]/page'})
 requireCondition([200,303].includes(signed.httpStatus)&&!signed.threw&&signed.errorRows.length===0&&signed.redirect?.startsWith(route+'?signed=1'),'term0105_customer_signature_unconfirmed')
 const accepted=exactlyOne(ports.read<{id:string;price_id:string;predecessor_price_id:string;signature_sha:string;acceptance_sha:string;valid:boolean;monthly_fee:string}>(`select ct.id,ps.id price_id,p.predecessor_price_snapshot_id predecessor_price_id,ct.signature_snapshot_sha256 signature_sha,a.acceptance_sha256 acceptance_sha,ct.monthly_fee_sek::text monthly_fee,
  (ct.signed_at=a.accepted_at and ct.signed_at is not null and ct.locked_at is not null and ct.status='signed'
   and ct.signature_snapshot=a.signature_snapshot and ct.signature_snapshot_sha256=a.signature_sha256
   and ct.signature_snapshot_sha256=public.canonical_json_sha256(ct.signature_snapshot)
   and ps.snapshot_hash=public.canonical_json_sha256(ps.snapshot_json) and ps.snapshot_hash=p.successor_price_sha256
   and ct.signature_snapshot->'amendment_context'=a.acceptance_context and a.acceptance_context=gridex_contract_amendment.context_v1(p.id)
   and not exists(select from public.customer_operation_jobs j where j.company_id=ct.company_id and j.job_type in('start_supplier_switch','recheck_switch_readiness') and j.payload->>'contract_id'=ct.id::text)) valid
  from gridex_contract_amendment.proposals p join gridex_contract_amendment.acceptances a on a.proposal_id=p.id
  join public.customer_contracts ct on ct.id=p.successor_contract_id and ct.company_id=p.company_id
  join public.contract_price_snapshots ps on ps.id=ct.contract_price_snapshot_id and ps.company_id=ct.company_id and ps.contract_id=ct.id
  where p.id=${lit(requestId)} and p.company_id=${lit(input.companyId)} and p.predecessor_contract_id=${lit(input.physicalContractId)} and ct.id=${lit(successor.id)}`),'term0105_actual_acceptance_missing')
 requireCondition(accepted.valid===true&&Number(accepted.monthly_fee)===input.successorMonthlyFeeSek&&accepted.price_id!==accepted.predecessor_price_id
  &&sha.test(accepted.signature_sha)&&sha.test(accepted.acceptance_sha),'term0105_actual_version_evidence_invalid')
 assertSelection(commercial(input,true,ports),input.physicalContractId,input.physicalContractId,null)
 assertSelection(commercial(input,false,ports),input.physicalContractId,successor.id,accepted.price_id)
 assertAmendmentHistoryPreserved(before,state(input,ports))
 return {scenario:'TERM01.05',coverage:'POSITIVE_SIGNED_AMENDMENT_ONLY',proposalId:proposal.proposalId,successorContractId:successor.id,
  priceSnapshotId:accepted.price_id,acceptanceSHA256:accepted.acceptance_sha,signatureSHA256:accepted.signature_sha,
  effectiveFrom:input.effectiveFrom,physicalSupplyPreserved:true,predecessorPreserved:true,
  emailDelivery:'NOT_ASSERTED_CONTROLLED_SYNTHETIC_CUSTOMER_OBSERVES_NORMAL_QUEUED_LINK'}
}

export async function runPreparedSignedAmendmentScenario() {
 requireCondition(process.env.SIM_REQUIRE_ACTOR_RECEIPT==='1'&&process.env.SIM_RUNTIME_ASSIGNMENT_FILE&&process.env.RUN_DIR&&process.env.SIM_TERM0105_INPUT_FILE,
  'TERM01.05 HOLD: T4-admitted source/actor/qualified existing physical fixture and private amendment input are required')
 const assignmentRaw=privateBytes(process.env.SIM_RUNTIME_ASSIGNMENT_FILE),assignment=record(JSON.parse(assignmentRaw.toString()))
 const input=readSignedAmendmentInput(JSON.parse(privateBytes(process.env.SIM_TERM0105_INPUT_FILE).toString()))
 const current=execFileSync('git',['-C',process.env.RUN_DIR,'rev-parse','HEAD'],{encoding:'utf8'}).trim()
 requireCondition(input.assignmentSha256===hash(assignmentRaw)&&input.environmentId===assignment.environmentId&&input.sourceCommit===assignment.sourceCommit
  &&input.sourceCommit===current,'term0105_current_admission_binding_required')
 const session=await loginSession(input.admin.email,input.admin.password,{companyId:input.companyId})
 return runSignedAmendmentScenario(input,session)
}
