import {createHash} from 'node:crypto'
import type {EdielProviderEntry,SendEdielEmailInput} from '@/lib/email/sendEdielEmail'

/** Explicit private-journal unit fixture. Production wrappers/callback ordering
 * remain real; this does not replace native journal/archive proof or seed it. */
export function transportJournalFixture(){
 const attempts=new Map<string,{identity:Record<string,unknown>;binding:Record<string,unknown>;entered:boolean;result?:Record<string,unknown>}>()
 const actions:string[]=[],observedAt='2026-09-30T12:34:56.789Z'
 const key=(scope:Record<string,unknown>)=>[scope.companyId??scope.p_company_id,scope.environment??scope.p_environment,scope.messageId??scope.p_message_id].join(':')
 async function rpc(name:string,args:Record<string,unknown>){
  // These ordinary test messages have no negative-test or production-source
  // registration. Absence grants no bypass; existing independent TGT guards run.
  if(name==='gridex_ediel_negative_fixture_read_v1'||name==='ediel_production_contract_message_basis_v1')return{data:null,error:null}
  if(name==='ediel_reserve_wire_reference_namespace_v1')return{data:null,error:null}
  if(name==='gridex_actor_has_company_permission')return{data:true,error:null}
  if(name==='gridex_ediel_accepted_transport_projection_v1'||name==='gridex_ediel_repair_accepted_transport_projection_v1'){
   const record=attempts.get(key(args))
   if(!record?.result)return{data:null,error:null}
   const data={status:'accepted_projection',...record.identity,lane:'generic_journal',originalHash:record.binding.originalHash,observedAt,frozenRecipient:record.binding.to,providerReceipt:record.result,businessExpectationPlan:record.binding.businessExpectationPlan??null,authorizesProviderEntry:false,deliveryProven:false,projectionStatus:'sent'}
   return{data,error:null}
  }
  if(name==='gridex_ediel_business_expectations_v1'){
   const scope=args.p_input as Record<string,unknown>,record=attempts.get(key(scope))
   if(scope.action!=='register'||!record?.result||!record.binding.businessExpectationPlan)throw Error('fixture_expectation_requires_frozen_accepted_plan')
   actions.push('register');return{data:[],error:null}
  }
  if(name!=='gridex_ediel_transport_attempt_v1')throw Error(`fixture_unexpected_rpc:${name}`)
  const scope=args.p_input as Record<string,unknown>,k=key(scope),prior=attempts.get(k)
  actions.push(String(scope.action))
  if(scope.action==='prepare'){
   if(prior)return{data:{proceed:false,classification:prior.result?'accepted':'unknown',providerReceipt:prior.result,observedAt},error:null}
   const binding=scope.binding as Record<string,unknown>
   if(!binding.mimeArchiveRef||!binding.mimeSha256||!binding.mimeLength||!binding.rfcMessageId||!binding.originalHash)throw Error('fixture_exact_archive_required')
   attempts.set(k,{identity:{companyId:scope.companyId,environment:scope.environment,messageId:scope.messageId,attemptId:scope.attemptId},binding,entered:false});return{data:{proceed:true},error:null}
  }
  if(!prior||prior.identity.attemptId!==scope.attemptId)throw Error('fixture_attempt_scope_conflict')
  if(scope.action==='enter'){prior.entered=true;return{data:{proceed:true},error:null}}
  if(scope.action==='observe'){
   if(!prior.entered)throw Error('fixture_provider_not_entered')
   const result=scope.result as Record<string,unknown>,accepted=result.accepted as string[]|undefined,rejected=result.rejected as string[]|undefined
   const classification=accepted?.length&&rejected?.length===0&&accepted.every(v=>v===prior.binding.to)?'accepted':'unknown'
   if(classification==='accepted')prior.result={...result,response:result.response??null}
   return{data:{classification,observedAt},error:null}
  }
  if(scope.action==='release'&&!prior.entered){attempts.delete(k);return{data:{released:true},error:null}}
  throw Error('fixture_no_reset_after_entry')
 }
 async function beforeProvider(input:SendEdielEmailInput,entry?:EdielProviderEntry){
  if(!entry?.archiveContext)throw Error('fixture_archive_context_required')
  const bytes=Buffer.from(`From: ${input.from}\r\nTo: ${input.to}\r\nMessage-ID: <synthetic-exact@example.invalid>\r\n\r\nSYNTHETIC MIME BYTES`, 'utf8')
  await entry.beforeProviderCall({mode:input.raw?'raw':'attachment',from:input.from,to:input.to,rfcMessageId:'<synthetic-exact@example.invalid>',mimeArchiveRef:`private-unit-fixture/${entry.archiveContext.companyId}/${entry.archiveContext.messageId}`,mimeSha256:createHash('sha256').update(bytes).digest('hex'),mimeLength:bytes.length,mimePayloadSnapshotId:'00000000-0000-4000-8000-000000000099',rawBase64:bytes.toString('base64')})
 }
 return{rpc,beforeProvider,actions,observedAt}
}
