import {supabaseService} from '@/lib/supabase/service'
import type {AmendmentProposal} from './amendmentInput'

export type AmendmentProposalReceipt = {
  state:'PROPOSED_NOT_ACCEPTED'
  proposalId:string
  predecessorContractId:string
  successorContractId:string
  effectiveFrom:string
  proposalSHA256:string
}
export type AmendmentProposalOutcome =
  | {status:'proposed';receipt:AmendmentProposalReceipt}
  | {status:'invalid';field?:string;message:string}
const expectedRefusals:Record<string,{field?:string;message:string}>={
  signed_amendment_future_boundary_required:{field:'effective_from',message:'Välj ett framtida månadsskifte som motsvarar det nya avtalsförslagets startdatum.'},
  signed_amendment_permission_denied:{message:'Du saknar aktuell behörighet för ändringsförslaget i detta bolag.'},
  signed_amendment_explicit_proposal_required:{message:'Bekräftelse och en giltig orsak krävs.'},
  signed_amendment_scope_invalid:{message:'Ändringsförslagets avtalskoppling är ogiltig.'},
  signed_amendment_company_inactive:{message:'Bolaget kan inte ta emot ändringsförslag.'},
  signed_amendment_exact_contracts_required:{message:'Välj ett signerat ursprungsavtal och ett nytt osignerat förslag för samma kund och anläggning.'},
  signed_amendment_term_shape_unsupported:{message:'Dessa villkor stöds ännu inte av ändringsflödet.'},
  signed_amendment_preparation_recipient_required:{message:'Kundens e-postadress behövs för att förbereda det nya avtalets frysta underlag.'},
  signed_amendment_snapshot_binding_invalid:{message:'Avtalens frysta prisunderlag kunde inte verifieras.'},
  signed_amendment_finalized_billing_overlap:{message:'Ett låst faktureringsunderlag överlappar ändringsdatumet.'},
  signed_amendment_active_proposal_exists:{message:'Ett annat aktivt eller accepterat ändringsförslag finns redan för det tidigare avtalet. Kontrollera historiken innan du fortsätter.'},
  signed_amendment_request_conflict:{message:'Begäran har redan använts med andra uppgifter. Läs det befintliga förslaget innan du fortsätter.'},
}
export async function submitAmendmentProposal(input:AmendmentProposal,authority:{companyId:string;actorUserId:string}):Promise<AmendmentProposalOutcome> {
  const {data,error}=await supabaseService.rpc('gridex_propose_signed_contract_amendment_v1',{
    p_company_id:authority.companyId,p_customer_id:input.customerId,p_predecessor_id:input.predecessorContractId,
    p_successor_id:input.successorContractId,p_effective_from:input.effectiveFrom,p_actor_user_id:authority.actorUserId,
    p_request_id:input.requestId,p_reason:input.reason,p_acknowledge_new_signature:input.acknowledgeNewSignature,
  })
  if(error) {
    const refusal=expectedRefusals[error.message]
    if(refusal&&['22023','23514','42501'].includes(error.code)) return {status:'invalid',...refusal}
    throw error
  }
  const result=data as Record<string,unknown>|null
  if(!result||result.state!=='PROPOSED_NOT_ACCEPTED'||result.proposalId!==input.requestId
    ||result.predecessorContractId!==input.predecessorContractId||result.successorContractId!==input.successorContractId
    ||result.effectiveFrom!==input.effectiveFrom||typeof result.proposalSHA256!=='string'||!/^[0-9a-f]{64}$/.test(result.proposalSHA256)) {
    throw new Error('amendment_proposal_receipt_mismatch')
  }
  return {status:'proposed',receipt:{state:'PROPOSED_NOT_ACCEPTED',proposalId:input.requestId,
    predecessorContractId:input.predecessorContractId,successorContractId:input.successorContractId,
    effectiveFrom:input.effectiveFrom,proposalSHA256:result.proposalSHA256}}
}

export type ContractCommercialScope={companyId:string;customerId:string;meteringPointId:string;supplyPeriodId:string;physicalContractId:string;start:string;end:string}
export type ContractCommercialAssignment=ContractCommercialScope&{
  schema:'gridex-contract-commercial-segments-v1'
  assignmentSHA256:string
  segments:Array<{start:string;end:string;contractId:string;priceSnapshotId:string|null;acceptanceSHA256:string|null}>
}
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const hashPattern=/^[0-9a-f]{64}$/
function record(value:unknown):Record<string,unknown>|null {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null
}
function utcInstant(value:unknown):number|null {
  if(typeof value!=='string'||value.startsWith('0000-')||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.0{1,6})?(?:Z|\+00:00)$/.test(value)) return null
  const instant=Date.parse(value)
  const canonical=value.replace('+00:00','Z').replace(/\.0+Z$/,'Z')
  return Number.isFinite(instant)&&new Date(instant).toISOString().replace('.000Z','Z')===canonical?instant:null
}
/** Reads commercial segmentation; never rewrites the original physical supply
 * assignment or falls back on an absent native qualification function. Native
 * store/lock gates must independently validate the same assignment. */
export async function loadContractCommercialSegments(scope:ContractCommercialScope):Promise<ContractCommercialAssignment> {
  const invalid=():never=>{throw new Error('amendment_commercial_assignment_invalid')}
  const start=utcInstant(scope.start),end=utcInstant(scope.end)
  if(start===null||end===null||end<=start||Object.entries(scope).some(([k,v])=>k.endsWith('Id')&&!idPattern.test(v))) invalid()
  const {data,error}=await supabaseService.rpc('gridex_read_contract_commercial_segments_v1',{
    p_company_id:scope.companyId,p_supply_period_id:scope.supplyPeriodId,p_start:scope.start,p_end:scope.end,
  })
  if(error) throw error
  const result=record(data)
  if(!result||result.schema!=='gridex-contract-commercial-segments-v1'
    ||Object.entries(scope).some(([k,v])=>k.endsWith('Id')&&result[k]!==v)
    ||utcInstant(result.start)!==start||utcInstant(result.end)!==end
    ||typeof result.assignmentSHA256!=='string'||!hashPattern.test(result.assignmentSHA256)
    ||!Array.isArray(result.segments)||result.segments.length<1||result.segments.length>32) return invalid()
  const segments:ContractCommercialAssignment['segments']=[]
  let next=start
  for(const raw of result.segments) {
    const segment=record(raw)
    if(!segment||typeof segment.contractId!=='string'||!idPattern.test(segment.contractId)) return invalid()
    const segmentStart=utcInstant(segment.start),segmentEnd=utcInstant(segment.end)
    if(segmentStart!==next||segmentEnd===null||segmentStart===null||segmentEnd<=segmentStart||segmentEnd>end!) return invalid()
    if(segment.contractId===scope.physicalContractId) {
      if(segment.priceSnapshotId!==null||segment.acceptanceSHA256!==null) return invalid()
    } else if(typeof segment.priceSnapshotId!=='string'||!idPattern.test(segment.priceSnapshotId)
      ||typeof segment.acceptanceSHA256!=='string'||!hashPattern.test(segment.acceptanceSHA256)) return invalid()
    segments.push({start:segment.start as string,end:segment.end as string,contractId:segment.contractId,
      priceSnapshotId:segment.priceSnapshotId as string|null,acceptanceSHA256:segment.acceptanceSHA256 as string|null})
    next=segmentEnd
  }
  if(next!==end) return invalid()
  return {...scope,start:result.start as string,end:result.end as string,schema:'gridex-contract-commercial-segments-v1',assignmentSHA256:result.assignmentSHA256,segments}
}
