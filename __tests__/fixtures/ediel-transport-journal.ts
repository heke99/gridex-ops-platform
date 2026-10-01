import {createHash} from 'node:crypto'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type {EdielProviderEntry,SendEdielEmailInput} from '@/lib/email/sendEdielEmail'

/** Explicit private-journal unit fixture. Production wrappers/callback ordering
 * remain real; this does not replace native journal/archive proof or seed it. */
export function transportJournalFixture(options:{repairFailure?:()=>Error|null;original?:Readonly<{companyId:string;actorUserId:string;messageId:string;rawPayload:string;rulePackSnapshot:Readonly<{profileKey:string;profileVersionId:string;version:string;checksum:string}>}>}={}){
 const attempts=new Map<string,{identity:Record<string,unknown>;binding:Record<string,unknown>;entered:boolean;result?:Record<string,unknown>}>()
 const actions:string[]=[],observedAt='2026-09-30T12:34:56.789Z'
 const sourceEvidence=()=>{const original=options.original;if(!original)throw Error('fixture_predeclared_original_required');const snapshot=original.rulePackSnapshot;return{rulePackId:'00000000-0000-4000-8000-000000000098',messageProfileId:snapshot.profileVersionId,profileKey:snapshot.profileKey,version:snapshot.version,sourceHash:snapshot.checksum,snapshot:{...snapshot}}}
 const key=(scope:Record<string,unknown>)=>[scope.companyId??scope.p_company_id,scope.environment??scope.p_environment,scope.messageId??scope.p_message_id].join(':')
 async function rpc(name:string,args:Record<string,unknown>){
  // These ordinary test messages have no negative-test or production-source
  // registration. Absence grants no bypass; existing independent TGT guards run.
  if(name==='gridex_ediel_negative_fixture_read_v1'||name==='gridex_ediel_positive_fixture_read_v1'){
   const context=args.p_context as Record<string,unknown>|undefined
   if(!context?.companyId||!context.actorUserId||!(context.messageId||context.runId&&context.stepNo&&context.rawPayload))throw Error('fixture_absent_registration_scope_required')
   return{data:null,error:null}
  }
  if(['ediel_customer_masterdata_message_basis_v1','ediel_customer_life_event_message_basis_v1','ediel_production_contract_message_basis_v1','ediel_brp_change_message_basis_v1','ediel_metering_method_change_message_basis_v1','ediel_prodat_recovery_original_basis_v1'].includes(name)){
   if(!args.p_company_id||!args.p_message_id||!args.p_actor_user_id)throw Error('fixture_absent_source_scope_required')
   return{data:null,error:null}
  }
  if(['ediel_require_brp_change_source_current_v1','ediel_require_metering_method_change_source_current_v1'].includes(name)){
   if(!args.p_company_id||!args.p_message_id)throw Error('fixture_current_source_scope_required')
   // Ordinary reporting/date-D fixtures are neither BRP B nor method F/G.
   // NULL models a successful void guard for a non-applicable native class.
   return{data:null,error:null}
  }
  // A predeclared persistence-only original is a finite mechanical read port.
  // It never supplies a general active canonical registry or caller-witness mint.
  if(name==='ediel_capture_source_rule_pack_basis_v1'||name==='ediel_require_source_rule_pack_basis_v1'){
   const original=options.original
   if(!original||args.p_company_id!==original.companyId||args.p_message_id!==original.messageId)throw Error('fixture_predeclared_original_scope_required')
   return{data:sourceEvidence(),error:null}
  }
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
  if(name==='ediel_project_accepted_source_state_v1'){
   const record=attempts.get(key(args))
   if(!record?.result||!args.p_actor_user_id||record.identity.actorUserId!==args.p_actor_user_id||record.binding.originalHash!==args.p_expected_original_hash)throw Error('fixture_source_projection_requires_exact_accepted_receipt')
   return{data:{status:'source_projection',companyId:record.identity.companyId,environment:record.identity.environment,messageId:record.identity.messageId,originalHash:record.binding.originalHash,observedAt,authorizesProviderEntry:false},error:null}
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
   attempts.set(k,{identity:{companyId:scope.companyId,environment:scope.environment,messageId:scope.messageId,attemptId:scope.attemptId,actorUserId:scope.actorUserId},binding,entered:false});return{data:{proceed:true},error:null}
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
  const from=('raw'in input?input.envelopeFrom:input.from)??null
  const bytes='raw'in input?Buffer.from(input.raw):Buffer.from(`From: ${from}\r\nTo: ${input.to}\r\nMessage-ID: <synthetic-exact@example.invalid>\r\n\r\nSYNTHETIC MIME BYTES`, 'utf8')
  await entry.beforeProviderCall({mode:'raw'in input?'raw':'attachment',from,to:input.to,rfcMessageId:'<synthetic-exact@example.invalid>',mimeArchiveRef:`private-unit-fixture/${entry.archiveContext.companyId}/${entry.archiveContext.messageId}`,mimeSha256:createHash('sha256').update(bytes).digest('hex'),mimeLength:bytes.length,mimePayloadSnapshotId:'00000000-0000-4000-8000-000000000099',rawBase64:bytes.toString('base64')})
 }
 return{rpc,beforeProvider,actions,observedAt,get rulePackSnapshot(){if(!options.original)throw Error('fixture_predeclared_original_required');return{...options.original.rulePackSnapshot}}}
}
