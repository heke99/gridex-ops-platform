/** Shape validation for staff proposals only. Authentication, future-date
 * policy and customer acceptance belong to the authoritative command/signing
 * transaction. An acknowledgement here grants none of those authorities. */
export type AmendmentProposal = {
  customerId: string
  predecessorContractId: string
  successorContractId: string
  requestId: string
  effectiveFrom: string
  reason: string
  acknowledgeNewSignature: true
}
export type AmendmentProposalInput = {ok:true;value:AmendmentProposal} | {ok:false;field:string;message:string}
const fields=['customer_id','predecessor_contract_id','successor_contract_id','request_id','effective_from','reason','acknowledge_new_signature'] as const
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const nil='00000000-0000-0000-0000-000000000000'
function gregorianDay(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year,month,day]=value.split('-').map(Number)
  if(year<1||month<1||month>12||day<1) return false
  const leap=year%4===0&&(year%100!==0||year%400===0)
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31]
  return day<=days[month-1]
}
export function parseAmendmentProposal(form:FormData):AmendmentProposalInput {
  const invalid=(field:string,message='Kontrollera uppgiften och försök igen.'):AmendmentProposalInput=>({ok:false,field,message})
  for(const key of form.keys()) {
    if(key.startsWith('$ACTION_')) continue // Framework metadata never becomes domain input.
    if(!fields.some(field=>field===key)) return invalid(key,'Fältet ingår inte i ändringsförslaget.')
  }
  const values:Record<string,string>={}
  for(const field of fields) {
    const entries=form.getAll(field)
    if(entries.length!==1||typeof entries[0]!=='string') return invalid(field)
    values[field]=entries[0].trim()
  }
  for(const field of fields.slice(0,4)) {
    const value=values[field].toLowerCase()
    if(!uuid.test(value)||value===nil) return invalid(field,'Ett giltigt ID krävs.')
    values[field]=value
  }
  if(values.predecessor_contract_id===values.successor_contract_id) return invalid('successor_contract_id','Välj ett nytt avtalsförslag.')
  if(!gregorianDay(values.effective_from)) return invalid('effective_from','Ange ett giltigt kalenderdatum.')
  if(!values.reason||values.reason.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(values.reason)) return invalid('reason','Ange en orsak med högst 1000 tecken.')
  if(values.acknowledge_new_signature!=='on') return invalid('acknowledge_new_signature','Bekräfta att kunden behöver granska och signera den nya avtalsversionen.')
  return {ok:true,value:{customerId:values.customer_id,predecessorContractId:values.predecessor_contract_id,
    successorContractId:values.successor_contract_id,requestId:values.request_id,effectiveFrom:values.effective_from,
    reason:values.reason,acknowledgeNewSignature:true}}
}

/** Display/consent DTO only. Its SHA is supplied by the authoritative native
 * receipt; this parser never grants acceptance or recomputes domain authority. */
export type AmendmentSigningContext={
  schema:'gridex_signed_contract_amendment_v1';proposalId:string;proposalSHA256:string
  predecessorContractId:string;successorContractId:string;effectiveFrom:string;predecessorReference:string
  predecessorSignatureSHA256:string;predecessorPriceSnapshotId:string;successorPriceSnapshotId:string
  predecessorPriceSHA256:string;successorPriceSHA256:string;predecessorTermsSHA256:string;successorTermsSHA256:string
}
export type AmendmentSigningDisplay={context:AmendmentSigningContext;sha256:string}
export function readAmendmentSigningContext(value:unknown,sha256:unknown,expected:{contractId:string;pricingSnapshotSHA256:string}):AmendmentSigningDisplay|null {
  if(value==null&&sha256==null) return null
  const invalid=():never=>{throw new Error('amendment_signing_context_invalid')}
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof sha256!=='string'||!/^[0-9a-f]{64}$/.test(sha256)) return invalid()
  const c=value as Record<string,unknown>
  const ids=['proposalId','predecessorContractId','successorContractId','predecessorPriceSnapshotId','successorPriceSnapshotId']
  const hashes=['proposalSHA256','predecessorSignatureSHA256','predecessorPriceSHA256','successorPriceSHA256','predecessorTermsSHA256','successorTermsSHA256']
  const keys=['schema','effectiveFrom','predecessorReference',...ids,...hashes]
  if(Object.keys(c).length!==keys.length||Object.keys(c).some(k=>!keys.includes(k))||c.schema!=='gridex_signed_contract_amendment_v1'
    ||ids.some(k=>typeof c[k]!=='string'||!uuid.test(c[k] as string)||(c[k] as string).toLowerCase()===nil)
    ||hashes.some(k=>typeof c[k]!=='string'||!/^[0-9a-f]{64}$/.test(c[k] as string))
    ||c.predecessorContractId===c.successorContractId||c.predecessorPriceSnapshotId===c.successorPriceSnapshotId
    ||c.successorContractId!==expected.contractId||c.successorPriceSHA256!==expected.pricingSnapshotSHA256
    ||typeof c.effectiveFrom!=='string'||!gregorianDay(c.effectiveFrom)
    ||typeof c.predecessorReference!=='string'||!c.predecessorReference.trim()||c.predecessorReference.length>128||/[\u0000-\u001f\u007f]/.test(c.predecessorReference)) return invalid()
  return {context:value as AmendmentSigningContext,sha256}
}
