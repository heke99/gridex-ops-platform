import {createHash} from 'node:crypto'
import {encodeEdifactLatin1} from '@/lib/ediel/core/edifactEncoding'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {ownerId,ownerRulePack} from '../helpers/sourceOwnerFixtures'

/** Finite synthetic native-read boundary for association mechanics ONLY.
 * Originals are installed before the subject operation. Never register the
 * first caller's wire or mint a production WeakMap capability in this fixture.
 * Actual production RPC decoders/mint/consumers remain under test; no native,
 * workbook, legal issuer, business-effect or external readiness claim follows.
 */
export function pinnedProdatReadBoundary(input:{companyId:string;actorUserId:string;runId:string;caseCode:string;revision:string;code:'Z13'|'Z09'|'Z04';subtype:'V'|'VH'|'D'|'L';reason:'S17'|'S18'|'Z70'|'Z22';rows:()=>readonly Record<string,unknown>[];run:()=>Record<string,unknown>}){
 const hash=(raw:string)=>createHash('sha256').update(encodeEdifactLatin1(raw)).digest('hex')
 const activation=ownerRulePack(),profile={...activation.profile,messageCode:input.code,transactionSubtype:input.subtype,canonicalDirection:'outbound',reasonForTransaction:input.reason}
 activation.profile_key=`PRODAT:${input.code}:${input.subtype}:26.A:r3`;activation.profile=profile
 activation.original_snapshot.messageProfile.profile_key=activation.profile_key;activation.original_snapshot.messageProfile.profile=profile
 const snapshot={...activation.original_snapshot,profileKey:activation.profile_key,profileVersionId:activation.message_profile_id,version:activation.original_version,checksum:activation.source_hash}
 const evidence={rulePackId:activation.rule_pack_id,messageProfileId:activation.message_profile_id,profileKey:activation.profile_key,version:activation.original_version,sourceHash:activation.source_hash,snapshot}
 function currentRun(){const run=input.run();if(run.id!==input.runId||run.company_id!==input.companyId||run.environment!=='test'||!['draft','running'].includes(String(run.status))||run.role_code!=='esco'||run.test_case_code!==input.caseCode||run.test_suite!=='PRODAT'||run.approval_version!==input.revision)throw Error('pinned_current_run_required')}
 const originals=new Map<string,Readonly<{id:string;raw:string;hash:string;receiver:string}>>()
 const prepared=new Map<string,{raw:string;consumed:boolean}>(),sealed=new Map<string,{raw:string;fixtureWitness:string;consumed:boolean}>()
 let sequence=1000
 function installExpectedOriginals(raws:readonly string[]){
  if(originals.size)throw Error('pinned_originals_already_installed')
  for(const raw of raws){
   const wire=tokenizeEdifact(raw),unbs=wire.segments.filter(s=>s.tag==='UNB')
   if(unbs.length!==1||segmentComposite(unbs[0],11,wire.una)[0]!=='1')throw Error('pinned_test_original_required')
   originals.set(raw,Object.freeze({id:ownerId(sequence++),raw,hash:hash(raw),receiver:segmentComposite(unbs[0],3,wire.una)[0]}))
  }
 }
 function qualification(row:Readonly<{id:string;raw:string;hash:string;receiver:string}>){return{kind:'source_qualified_positive_fixture',version:1,registrationId:row.id,companyId:input.companyId,runId:input.runId,roleCode:'esco',caseCode:input.caseCode,suite:'PRODAT',revision:input.revision,stepNo:1,wireSha256:row.hash,originalFileSha256:row.hash,expectedOutcome:'positive',expectedDiagnosticCodes:[],testReceiverEdielId:row.receiver,validUntil:'2027-01-01T00:00:00Z',sourceReference:'mechanical://independently-pinned-unit-original',ownerDecisionReference:'mechanical://synthetic-association-only',authorizesBusinessEffect:false}}
 function actualOriginal(context:Record<string,unknown>){
  currentRun()
  if(context.companyId!==input.companyId||context.actorUserId!==input.actorUserId||context.runId!==input.runId||context.stepNo!==1)throw Error('pinned_original_scope_changed')
  const row=originals.get(String(context.rawPayload));if(!row)return null
  if(hash(String(context.rawPayload))!==row.hash)throw Error('pinned_original_hash_changed')
  return row
 }
 async function rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:null}|undefined>{
  if(name==='gridex_ediel_positive_fixture_read_v1'||name==='gridex_ediel_positive_fixture_prepare_v1'){
   const context=args.p_context as Record<string,unknown>,row=actualOriginal(context)
   if(name.endsWith('read_v1'))return{data:row?qualification(row):null,error:null}
   if(!row||context.registrationId!==row.id)throw Error('pinned_prepared_original_required')
   const witnessId=ownerId(sequence++);prepared.set(witnessId,{raw:row.raw,consumed:false})
   return{data:{witnessId,qualification:qualification(row)},error:null}
  }
  if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1'){
   if(args.p_market!=='electricity'||args.p_family!=='PRODAT'||args.p_message_code!==input.code||args.p_transaction_subtype!==input.subtype||args.p_direction!=='outbound'||!['2026-08-01','2026-09-19','2026-10-01',new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Stockholm'})].includes(String(args.p_business_date)))throw Error('pinned_profile_scope_changed')
   return{data:[structuredClone(activation)],error:null}
  }
  if(name==='ediel_prepare_outbound_owner_witness_v1'){
   currentRun()
   const context=args.p_input as Record<string,unknown>,raw=String(context.rawPayload),witness=String(context.sourceQualifiedPositiveFixtureWitnessId)
   if(context.companyId!==input.companyId||context.actorUserId!==input.actorUserId||context.environment!=='test'||prepared.get(witness)?.raw!==raw||prepared.get(witness)?.consumed||JSON.stringify(context.rulePackEvidence)!==JSON.stringify(evidence))throw Error('pinned_outbound_witness_scope_changed')
   const witnessId=ownerId(sequence++);sealed.set(witnessId,{raw,fixtureWitness:witness,consumed:false});return{data:{version:1,witnessId,evidence:structuredClone(evidence)},error:null}
  }
  if(name==='ediel_capture_source_rule_pack_basis_v1'){
   currentRun()
   const row=input.rows().find(r=>r.id===args.p_message_id&&r.company_id===args.p_company_id),wire=row?.raw_payload,execution=row?.execution_context_snapshot as Record<string,unknown>|undefined
   if(args.p_company_id!==input.companyId||!row||row.environment!=='test'||row.direction!=='outbound'||typeof wire!=='string'||!originals.has(wire)||sealed.get(String(execution?.outboundOwnerWitnessId))?.raw!==wire)throw Error('pinned_original_capture_scope_changed')
   return{data:structuredClone(evidence),error:null}
  }
  if(name==='gridex_actor_has_company_permission'){
   if(args.p_company_id!==input.companyId||args.p_actor_user_id!==input.actorUserId||!['communication.write','ediel_testing.write','ediel.send','communication.send'].includes(String(args.p_permission)))throw Error('pinned_actor_permission_scope_changed')
   return{data:true,error:null}
  }
 }
 function consume(message:Record<string,unknown>){
  currentRun()
  const snapshot=message.execution_context_snapshot as Record<string,unknown>|undefined,owner=sealed.get(String(snapshot?.outboundOwnerWitnessId)),fixture=owner?prepared.get(owner.fixtureWitness):null
  if(!owner||!fixture||owner.consumed||fixture.consumed||message.company_id!==input.companyId||message.environment!=='test'||message.raw_payload!==owner.raw||fixture.raw!==owner.raw||snapshot?.sourceQualifiedPositiveFixtureWitnessId!==owner.fixtureWitness)throw Error('pinned_one_use_original_insert_required')
  owner.consumed=fixture.consumed=true
 }
 return{rpc,installExpectedOriginals,consume,clearOriginals:()=>originals.clear()}
}

/** The builder's finite 36-character interchange counter affects only these
 * independently enumerated header references. No subject RPC argument is used.
 */
export function expectedTgtCounterVariants(raw:string):readonly string[]{
 const wire=tokenizeEdifact(raw),unb=wire.segments.find(s=>s.tag==='UNB'),unh=wire.segments.find(s=>s.tag==='UNH'),bgm=wire.segments.find(s=>s.tag==='BGM')
 const interchange=segmentComposite(unb,5,wire.una)[0],message=segmentComposite(unh,1,wire.una)[0],document=segmentComposite(bgm,2,wire.una)[0]
 if(interchange.length!==14||!message||!document)throw Error('pinned_counter_template_invalid')
 return Object.freeze(Array.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',last=>raw.replaceAll(interchange,interchange.slice(0,-1)+last).replaceAll(message,message.slice(0,-1)+last).replaceAll(document,document.slice(0,-1)+last)))
}
