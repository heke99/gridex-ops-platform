import {createHash} from 'node:crypto'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type {EdielProviderEntry,SendEdielEmailInput} from '@/lib/email/sendEdielEmail'

/** Explicit private-journal unit fixture. Production wrappers/callback ordering
 * remain real; this does not replace native journal/archive proof or seed it. */
export function transportJournalFixture(options:{repairFailure?:()=>Error|null}={}){
 const attempts=new Map<string,{identity:Record<string,unknown>;binding:Record<string,unknown>;entered:boolean;result?:Record<string,unknown>}>()
 const actions:string[]=[],observedAt='2026-09-30T12:34:56.789Z'
 const packId='00000000-0000-4000-8000-000000000081',profileId='00000000-0000-4000-8000-000000000082',sourceHash='a'.repeat(64)
 let selectedSnapshot={profileKey:'PRODAT:Z01:L:26.A:r3',profileVersionId:profileId,version:'26.A:r3',checksum:sourceHash}
 const sourceEvidence=()=>({rulePackId:packId,messageProfileId:profileId,profileKey:selectedSnapshot.profileKey,version:selectedSnapshot.version,sourceHash,snapshot:{...selectedSnapshot}})
 const key=(scope:Record<string,unknown>)=>[scope.companyId??scope.p_company_id,scope.environment??scope.p_environment,scope.messageId??scope.p_message_id].join(':')
 async function rpc(name:string,args:Record<string,unknown>){
  // These ordinary test messages have no negative-test or production-source
  // registration. Absence grants no bypass; existing independent TGT guards run.
  if(['gridex_ediel_negative_fixture_read_v1','gridex_ediel_positive_fixture_read_v1','ediel_production_contract_message_basis_v1','ediel_brp_change_message_basis_v1','ediel_metering_method_change_message_basis_v1','ediel_prodat_recovery_original_basis_v1'].includes(name))return{data:null,error:null}
  if(['ediel_require_brp_change_source_current_v1','ediel_require_metering_method_change_source_current_v1'].includes(name))return{data:null,error:null}
  // Named original/activation ports are declared synthetic for this unit only.
  if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1'){
   const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:String(args.p_message_code),subtypeOrReasonCode:String(args.p_transaction_subtype),direction:'outbound',referenceDate:String(args.p_business_date),applicationReference:'23-DDQ-PRODAT',mode:'catalog_evidence'})
   const key=`PRODAT:${policy.code}:${policy.subtype}:26.A:r3`,profile={family:'PRODAT',messageCode:policy.code,transactionSubtype:policy.subtype,canonicalDirection:'outbound',reasonForTransaction:policy.transactionReasonCode,guideVersion:'26.A',guideRevision:'3'}
   selectedSnapshot={profileKey:key,profileVersionId:profileId,version:'26.A:r3',checksum:sourceHash}
   const row={rule_pack_id:packId,message_profile_id:profileId,market:'electricity',family:'PRODAT',guide_version:'26.A',guide_revision:'3',unh_association_code:policy.associationAssignedCode,valid_from:'2026-04-01',valid_to:null,source_document:'DECLARED SYNTHETIC UNIT REGISTRY PORT',source_hash:sourceHash,field_matrix_version:'26A-r3',profile_key:key,business_process:policy.processGroup,phase:null,profile,parser_ready:true,builder_ready:true,validator_ready:true,ack_ready:true,state_machine_ready:true}
   return{data:{...row,original_version:'26.A:r3',original_snapshot:{rulePack:{id:packId,source_hash:sourceHash,guide_version:'26.A',guide_revision:'3'},messageProfile:{id:profileId,rule_pack_id:packId,profile_key:key,profile},guideSources:[]}},error:null}
  }
  if(name==='ediel_prepare_outbound_owner_witness_v1'){
   const input=args.p_input as {rawPayload?:string;rulePackEvidence?:{profileKey:string;messageProfileId:string;version:string;sourceHash:string;snapshot:Record<string,unknown>}}
   if(!input.rawPayload||input.rulePackEvidence?.profileKey!==selectedSnapshot.profileKey||input.rulePackEvidence.messageProfileId!==selectedSnapshot.profileVersionId||input.rulePackEvidence.version!==selectedSnapshot.version||input.rulePackEvidence.sourceHash!==selectedSnapshot.checksum)throw Error('fixture_named_original_scope_required')
   return{data:{version:1,witnessId:'00000000-0000-4000-8000-000000000083',evidence:input.rulePackEvidence},error:null}
  }
  if(name==='ediel_capture_source_rule_pack_basis_v1'||name==='ediel_require_source_rule_pack_basis_v1')return{data:sourceEvidence(),error:null}
  if(name==='ediel_reserve_wire_reference_namespace_v1')return{data:null,error:null}
  if(name==='gridex_actor_has_company_permission')return{data:true,error:null}
  if(name==='gridex_ediel_accepted_transport_projection_v1'||name==='gridex_ediel_repair_accepted_transport_projection_v1'){
   const record=attempts.get(key(args))
   if(name==='gridex_ediel_repair_accepted_transport_projection_v1'){
    const failure=options.repairFailure?.();if(failure)return{data:null,error:failure}
    if(record?.result){actions.push('repair');if(record.binding.businessExpectationPlan)actions.push('register')}
   }
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
 return{rpc,beforeProvider,actions,observedAt,get rulePackSnapshot(){return{...selectedSnapshot}}}
}
