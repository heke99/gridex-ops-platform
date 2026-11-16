import type {CustomerLifeEventPatch} from '@/lib/ediel/production/customerLifeEventPatches'
import {prodatMarketMinuteToUtc,prodatNowDate203} from '@/lib/ediel/prodat/render/dates'
import {prodatPartyText} from '@/lib/ediel/prodat/prodatPartyFields'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'

export type AiListCustomerEpoch={from:string;to:string;identity:string;name:string;sourceMessageIds:string[]}
export function aiListCustomerPatchRelevant(patch:CustomerLifeEventPatch):boolean {
 return Object.hasOwn(patch.customerFields,'org_number')||Object.hasOwn(patch.customerFields,'personal_number')||Object.hasOwn(patch.endUserMasterdata,'name')
}
function patchDay(patch:CustomerLifeEventPatch):string {
 const minute=prodatNowDate203(new Date(patch.effectiveAt))
 if(minute.slice(8)!=='0000'||parseSourceReceiptInstant(prodatMarketMinuteToUtc(minute)??'')!==parseSourceReceiptInstant(patch.effectiveAt))throw Error('ai_list_history_unavailable:date_only_customer_boundary_unrepresentable')
 return minute.slice(0,8)
}
/** Compose only the SAME customer's source-approved deltas over its independently
 * qualified original NAD+UD baseline. This pure projection grants no authority. */
export function composeAiListCustomerEpochs(input:{baselineId:string;baselineName:string;baselineFrom:string;from:string;to:string;cutoff:string;patches:readonly CustomerLifeEventPatch[]}):AiListCustomerEpoch[] {
 let identity=input.baselineId,name=input.baselineName,cursor=input.from,previous:bigint|null=null,version=0
 const sources=new Set<string>(),versions=new Set<number>(),epochs:AiListCustomerEpoch[]=[]
 const cutoff=parseSourceReceiptInstant(input.cutoff)
 if(input.from>=input.to||input.baselineFrom>input.from||!identity||!name||input.patches.length>1000)throw Error('ai_list_history_unavailable:customer_epoch_scope_invalid')
 for(const patch of input.patches){
  const at=parseSourceReceiptInstant(patch.effectiveAt),applied=parseSourceReceiptInstant(patch.appliedAt),available=parseSourceReceiptInstant(patch.availableAt)
  if(at===null||applied===null||available===null||cutoff===null||previous!==null&&(at<previous||at===previous&&patch.customerVersion<=version)||!Number.isSafeInteger(patch.customerVersion)||patch.customerVersion<1||versions.has(patch.customerVersion)||applied>cutoff||available>cutoff)throw Error('ai_list_history_unavailable:customer_epoch_source_unqualified')
  previous=at;version=patch.customerVersion;versions.add(version)
  if(!aiListCustomerPatchRelevant(patch))continue
  const day=patchDay(patch)
  if(day<input.baselineFrom||day>=input.to)continue
  if(day>cursor){epochs.push({from:cursor,to:day,identity,name,sourceMessageIds:[...sources]});cursor=day}
  const organisation=Object.hasOwn(patch.customerFields,'org_number'),personal=Object.hasOwn(patch.customerFields,'personal_number')
  if(organisation&&personal)throw Error('ai_list_history_unavailable:customer_identity_patch_ambiguous')
  if(organisation||personal){
   const value=organisation?patch.customerFields.org_number:patch.customerFields.personal_number
   if(typeof value!=='string'||!value||value!==value.trim()||value.length>35||/[\x00-\x1f\x7f;]/.test(value))throw Error('ai_list_history_unavailable:customer_identity_patch_invalid')
   identity=value
  }
  if(Object.hasOwn(patch.endUserMasterdata,'name')){
   const parts=patch.endUserMasterdata.name
   if(!Array.isArray(parts)||parts.length<1||parts.length>2||parts.some(part=>typeof part!=='string'||part.length>35||/[\x00-\x1f\x7f]/.test(part)))throw Error('ai_list_history_unavailable:customer_name_patch_invalid')
   // Match the existing original NAD party projection. A literal multi-line
   // name remains unrepresentable in this CSV profile; no whitespace invention.
   const projected=prodatPartyText(parts)
   if(!projected)throw Error('ai_list_history_unavailable:customer_name_patch_invalid')
   name=projected
  }
  sources.add(patch.sourceMessageId)
 }
 epochs.push({from:cursor,to:input.to,identity,name,sourceMessageIds:[...sources]})
 return epochs
}
