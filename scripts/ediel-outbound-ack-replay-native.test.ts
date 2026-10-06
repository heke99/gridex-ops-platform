import {execFileSync,spawn} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordEdielTechnicalSyntaxDecision,captureEdielTechnicalSyntaxAckEvidence} from '@/lib/ediel/ack/technicalSyntaxAuthority'
import {createCanonicalAckMessage} from '@/lib/ediel/core/kernel'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {seedOriginalMailboxNative,recordOriginalMailboxNativeReception} from './helpers/originalMailboxNative'
import {decisionUser} from './helpers/ediel-decision-original-native-fixture'

// Disposable native Supabase only. No parser, owner, database, gateway or
// permission mock and no provider entry/traffic. Source/ACK are synthetic.
const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const literal=(v:unknown)=>"'"+String(v).replaceAll("'","''")+"'"
function sql<T>(input:string):T {
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_native_local_only')
 const output=execFileSync('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:10000}).trim()
 return output?JSON.parse(output) as T:undefined as T
}
// Inbound tenant PRODAT must carry rule-pack evidence. The source code stays
// deliberately unlisted (Z99), so the evidence of one actual enabled inbound PRODAT
// profile is pinned explicitly (the binder keeps pinned evidence as is).
// The stored own CONTRL row carries the tenant route it was persisted for;
// replay later reads that stored fact, never a current route selection.
const contrlRoute=(company:string,endpoint:string)=>{const route=randomUUID(),profile=randomUUID();sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email) VALUES(${literal(route)},${literal(company)},'Native own CONTRL','ediel_ack','bilateral_test',true,'remote@example.invalid');INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,message_family,business_code,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,mailbox,smtp_host,smtp_port) VALUES(${literal(profile)},${literal(company)},${literal(route)},'Native own CONTRL','test','edifact','edifact','CONTRL','CONTRL',${literal(endpoint)},'12345','23-DDQ-PRODAT',true,true,'local@example.invalid','smtp.example.invalid',587)`);return {communication_route_id:route,route_profile_id:profile,application_reference:'23-DDQ-PRODAT'}}
const unlistedProdatRulePin=()=>sql<Record<string,unknown>>(`SELECT jsonb_build_object('canonical_rule_pack_id',pack.id,'rule_profile_key',profile.profile_key,'rule_profile_version_id',profile.id,'rule_profile_version',pack.guide_version||':r'||pack.guide_revision,'rule_pack_checksum',pack.source_hash,'rule_pack_snapshot',profile.profile) FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.is_enabled AND profile.profile->>'family'='PRODAT' AND profile.direction IN('inbound','both') AND pack.status IN('active','future') ORDER BY profile.profile_key LIMIT 1`)

it('replays a genuine native own CONTRL without current route selection and holds current grant/membership/endpoint revocation without effects',async()=>{
 const company=randomUUID(),actor=randomUUID(),sourceId=randomUUID(),ackId=randomUUID(),identifierId=randomUUID()
 const endpoint=sql<string>(`SELECT to_jsonb(min(n)::text) FROM generate_series(80000,89999)n WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.environment='test' AND i.identifier_type='EdielId' AND i.identifier_value=n::text AND (i.valid_to IS NULL OR now()<i.valid_to))`)
 const sourceReference='S'+sourceId.replaceAll('-','').slice(0,13),ackReference='A'+ackId.replaceAll('-','').slice(0,13),sourceUnh='S'+sourceId.slice(0,8),ackUnh='A'+ackId.slice(0,8)
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'Disposable ACK replay native','active');
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${literal(actor)},'authenticated','authenticated',${literal(actor+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);
  INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actor)},${literal(actor+'@example.invalid')},'Disposable ACK operator','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
  INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(company)},${literal(actor)},'operations','active',now(),'{}','member',true,now(),'operations');
  INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(actor)},${literal(company)},id,key FROM public.permissions WHERE key='communication.write';
  INSERT INTO public.tenant_actor_identifiers(id,company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES(${literal(identifierId)},${literal(company)},'test',${literal(actor)},'EdielId',${literal(endpoint)},now()-interval '1 day');`)
 const raw=`UNB+UNOC:3+12345:14+${endpoint}:14+260930:1200+${sourceReference}++23-DDQ-PRODAT++++1'UNH+${sourceUnh}+PRODAT:D:97A:UN:E2SE6A'BGM+Z99+SOURCE+9+AB'DTM+137:202609301200:203'DTM+ZZZ:1:805'NAD+FR+12345:160:SVK+++++++SE'NAD+DO+${endpoint}:160:SVK+++++++SE'LIN+1'UNT+8+${sourceUnh}'UNZ+1+${sourceReference}'`
 const stored=await supabaseService.from('ediel_messages').insert({id:sourceId,company_id:company,...unlistedProdatRulePin(),environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z99',status:'received',raw_payload:raw,message_received_at:new Date().toISOString()}).select('*').single()
 expect(stored.error).toBeNull();const source=stored.data as EdielMessageRow
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
 expect(['accepted','rejected']).toContain(decision.syntaxDecision)
 await recordEdielTechnicalSyntaxDecision({companyId:company,sourceMessageId:sourceId,sourceHash:createHash('sha256').update(raw).digest('hex'),syntaxDecision:decision.syntaxDecision as 'accepted'|'rejected',reasonCodes:decision.issues.map(issue=>issue.code),execution:{actorUserId:actor,phase:'prepare'}})
 const evidence=await captureEdielTechnicalSyntaxAckEvidence(company,sourceId,{actorUserId:actor,phase:'prepare'})
 const outcome=evidence.syntaxDecision==='accepted'?'positive':'negative'
 const ownRaw=`UNB+UNOC:3+${endpoint}:14+12345:14+260930:1201+${ackReference}++23-DDQ-PRODAT++++1'UNH+${ackUnh}+CONTRL:2:2:UN:EDIEL2'UCI+${sourceReference}+12345:14+${endpoint}:14+${outcome==='positive'?'1':'4'}'UNT+3+${ackUnh}'UNZ+1+${ackReference}'`
 // Actual INSERT triggers qualify reversed own wire against the already
 // committed technical facet/guide and reserve its immutable namespace.
 const persisted=await supabaseService.from('ediel_messages').insert({id:ackId,company_id:company,...contrlRoute(company,endpoint),environment:'test',direction:'outbound',message_standard:'edifact',message_family:'CONTRL',message_code:'CONTRL',status:'draft',related_message_id:sourceId,raw_payload:ownRaw,ack_outcome:outcome,source_operation_id:`ediel_ack:${sourceId}:CONTRL:message`}).select('*').single()
 expect(persisted.error).toBeNull()
 const effects=()=>sql(`SELECT jsonb_build_object('messages',(SELECT count(*) FROM public.ediel_messages WHERE id IN(${literal(sourceId)},${literal(ackId)}) OR related_message_id=${literal(sourceId)}),'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE source_message_id=${literal(sourceId)}),'witnesses',(SELECT count(*) FROM gridex_ediel_outbound_owner.witnesses WHERE company_id=${literal(company)}),'events',(SELECT count(*) FROM public.ediel_message_events WHERE ediel_message_id IN(${literal(sourceId)},${literal(ackId)})))`)
 const before=effects(),draft={actorUserId:actor,companyId:company,environment:'test' as const,direction:'outbound' as const,messageStandard:'edifact' as const,messageFamily:'CONTRL' as const,messageCode:'CONTRL',rawPayload:ownRaw}
 const nativeRead=()=>{const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string}|null}>;return rpc('ediel_read_outbound_ack_replay_v1',{p_company_id:company,p_environment:'test',p_source_message_id:sourceId,p_actor_user_id:actor,p_ack_family:'CONTRL',p_sequence_field:null,p_sequence_value:null})}
 const replay=()=>createCanonicalAckMessage({actorUserId:actor,sourceMessage:source,ackFamily:'CONTRL',outcome,draft})
 // No configured route/profile exists: established replay must avoid any
 // current route/profile read, new witness, message, event or outbox row.
 expect((await nativeRead()).error).toBeNull();expect((await replay()).id).toBe(ackId);expect((await replay()).raw_payload).toBe(ownRaw);expect(effects()).toEqual(before)
 await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:source,ackFamily:'CONTRL',outcome:outcome==='positive'?'negative':'positive',draft})).rejects.toThrow(/conflicting_ack_draft_exists|canonical_ack_draft_physical_outcome_mismatch/);expect(effects()).toEqual(before)
 await expect(createCanonicalAckMessage({actorUserId:actor,sourceMessage:{...source,raw_payload:raw+'altered'},ackFamily:'CONTRL',outcome,draft})).rejects.toThrow('actual_original_mismatch')
 sql(`UPDATE public.user_permissions SET is_active=false WHERE user_id=${literal(actor)} AND company_id=${literal(company)}`);expect((await nativeRead()).error?.message).toMatch(/actor_not_authorized|ediel_business_ack_current_actor_required/);await expect(replay()).rejects.toThrow();sql(`UPDATE public.user_permissions SET is_active=true WHERE user_id=${literal(actor)} AND company_id=${literal(company)}`)
 sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${literal(company)} AND user_id=${literal(actor)}`);expect((await nativeRead()).error?.message).toMatch(/actor_not_authorized|ediel_business_ack_current_actor_required/);await expect(replay()).rejects.toThrow();sql(`UPDATE public.company_memberships SET is_active=true WHERE company_id=${literal(company)} AND user_id=${literal(actor)}`)
 sql(`UPDATE public.tenant_actor_identifiers SET valid_to=now() WHERE id=${literal(identifierId)}`);expect((await nativeRead()).error?.message).toContain('endpoint_unqualified');await expect(replay()).rejects.toThrow();sql(`UPDATE public.tenant_actor_identifiers SET valid_to=null WHERE id=${literal(identifierId)}`)
 expect((await replay()).id).toBe(ackId);expect(effects()).toEqual(before)
})


// Actual HTTP/PostgREST calls execute the full source-generated native owner,
// guide, immutable namespace and witness triggers. Disposable synthetics only.
it('atomically mints common negative ACK, rolls back the last event write, serializes same/opposite races and holds prewrite/replay grant revocation',async()=>{
 const company=randomUUID(),actor=randomUUID(),sourceId=randomUUID(),routeId=randomUUID(),profileId=randomUUID(),roleId=randomUUID()
 const nonce=sourceId.replaceAll('-',''),fn='ediel_atomic_ack_fail_'+nonce
 const endpoint=sql<string>(`SELECT to_jsonb(min(n)::text) FROM generate_series(80000,89999)n WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.environment='test' AND i.identifier_type='EdielId' AND i.identifier_value=n::text AND (i.valid_to IS NULL OR now()<i.valid_to))`)
 const sourceRef='SRC'+nonce.slice(0,11),ownRef='ACK'+nonce.slice(0,11),unh='A'+nonce.slice(0,8)
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'Disposable atomic common native','active');
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${literal(actor)},'authenticated','authenticated',${literal(actor+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actor)},${literal(actor+'@example.invalid')},'Atomic native operator','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(company)},${literal(actor)},'operations','active',now(),'{}','member',true,now(),'operations');
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(actor)},${literal(company)},id,key FROM public.permissions WHERE key='communication.write';
 INSERT INTO public.tenant_actor_identifiers(id,company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES(${literal(roleId)},${literal(company)},'test',${literal(actor)},'EdielId',${literal(endpoint)},now()-interval '1 day');
 INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email) VALUES(${literal(routeId)},${literal(company)},'Native atomic reply','ediel_ack','bilateral_test',true,'remote@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,message_family,business_code,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,mailbox,smtp_host,smtp_port) VALUES(${literal(profileId)},${literal(company)},${literal(routeId)},'Native atomic common','test','edifact','edifact','APERAK','APERAK',${literal(endpoint)},'12345','23-DDQ-PRODAT',true,true,'local@example.invalid','smtp.example.invalid',587);`)
 const raw=`UNB+UNOC:3+12345:14+${endpoint}:14+260930:1200+${sourceRef}++23-DDQ-PRODAT++++1'UNH+S${nonce.slice(0,8)}+PRODAT:D:97A:UN:E2SE6A'BGM+Z99+SOURCE+9+AB'DTM+137:202609301200:203'DTM+ZZZ:1:805'NAD+FR+12345:160:SVK+++++++SE'NAD+DO+${endpoint}:160:SVK+++++++SE'LIN+1'UNT+8+S${nonce.slice(0,8)}'UNZ+1+${sourceRef}'`
 const receivedAt=new Date().toISOString(),parsed=parseEdifactPayload(raw)
 const retained=await seedOriginalMailboxNative(sql,literal,{companyId:company,environment:'test',raw,receivedAt,smtpFrom:'local@example.invalid',parsed})
 const stored=await supabaseService.from('ediel_messages').insert({id:sourceId,company_id:company,...unlistedProdatRulePin(),environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z99',status:'received',raw_payload:raw,message_received_at:receivedAt,mailbox_message_id:retained.inboundEmailMessageId,inbound_email_message_id:retained.inboundEmailMessageId,sender_ediel_id:parsed.senderEdielId,receiver_ediel_id:parsed.receiverEdielId,application_reference:parsed.applicationReference,interchange_reference:parsed.interchangeReference}).select('*').single()
 expect(stored.error).toBeNull();const source=stored.data as EdielMessageRow
 // Reception uses a distinct canonical SEND actor; ACK creation and all
 // revocation/race controls keep the original WRITE-only actor unchanged.
 const receptionActor=await decisionUser(company,['communication.send'],randomUUID()+'Aa1!')
 await recordOriginalMailboxNativeReception({companyId:company,sourceMessageId:sourceId,actorUserId:receptionActor.id,inboundEmailMessageId:retained.inboundEmailMessageId,parseResultId:retained.parseResultId})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source);expect(decision.syntaxDecision,JSON.stringify(decision.issues)).toBe('accepted')
 await recordEdielTechnicalSyntaxDecision({companyId:company,sourceMessageId:sourceId,sourceHash:createHash('sha256').update(raw).digest('hex'),syntaxDecision:'accepted',reasonCodes:decision.issues.map(issue=>issue.code),execution:{actorUserId:actor,phase:'prepare'}})
 await captureEdielTechnicalSyntaxAckEvidence(company,sourceId,{actorUserId:actor,phase:'prepare'})
 const ownRaw=`UNB+UNOC:3+${endpoint}:14+12345:14+260930:1201+${ownRef}++23-DDQ-PRODAT++++1'UNH+${unh}+APERAK:D:96A:UN:E2SE6A'BGM+++27'DTM+137:202609301201:203'RFF+ACW:SOURCE'NAD+FR+${endpoint}:160:SVK+++++++SE'NAD+DO+12345:160:SVK+++++++SE'ERC+42::260'FTX+AAO++202::260+Felaktigt Meddelandenamn Z99'UNT+9+${unh}'UNZ+1+${ownRef}'`
 const args={p_company_id:company,p_environment:'test',p_source_message_id:sourceId,p_source_payload_hash:createHash('sha256').update(raw).digest('hex'),p_actor_user_id:actor,p_ack_family:'APERAK',p_sequence_field:null,p_sequence_value:null,p_outcome:'negative',p_draft:{rawPayload:ownRaw,communicationRouteId:routeId,routeProfileId:profileId,senderEmail:'local@example.invalid',receiverEmail:'remote@example.invalid',mailbox:'local@example.invalid',parsedPayload:{display:'native atomic fixture'},validationReport:{}},p_common_smtp:{from:'local@example.invalid',host:'smtp.example.invalid',port:587}}
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:{replayed:boolean;ackMessage:EdielMessageRow}|null;error:{message:string}|null}>
 const create=(patch:Record<string,unknown>={})=>rpc('ediel_create_outbound_ack_atomic_v1',{...args,...patch})
 const effects=()=>sql<Record<string,number>>(`SELECT jsonb_build_object('messages',(SELECT count(*) FROM public.ediel_messages WHERE related_message_id=${literal(sourceId)}),'witnesses',(SELECT count(*) FROM gridex_ediel_common_header.negative_witnesses WHERE company_id=${literal(company)}),'consumptions',(SELECT count(*) FROM gridex_ediel_common_header.negative_consumptions WHERE company_id=${literal(company)}),'routeBindings',(SELECT count(*) FROM gridex_ediel_common_header.negative_route_bindings b JOIN gridex_ediel_common_header.negative_witnesses w ON w.id=b.witness_id WHERE w.company_id=${literal(company)}),'events',(SELECT count(*) FROM public.ediel_message_events WHERE company_id=${literal(company)}),'receipts',(SELECT count(*) FROM gridex_ediel_ack_replay.creation_receipts WHERE company_id=${literal(company)}),'namespace',(SELECT count(*) FROM gridex_ediel_wire_namespace.coverage WHERE company_id=${literal(company)}),'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(company)}),'attempts',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id=${literal(company)}))`)
 const before=effects()
 sql(`CREATE FUNCTION public.${fn}()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.company_id=${literal(company)}::uuid THEN RAISE EXCEPTION 'atomic_last_event_failure';END IF;RETURN NEW;END$$;CREATE TRIGGER ${fn} BEFORE INSERT ON public.ediel_message_events FOR EACH ROW EXECUTE FUNCTION public.${fn}()`)
 try{expect((await create()).error?.message).toContain('atomic_last_event_failure');expect(effects()).toEqual(before)}finally{sql(`DROP TRIGGER ${fn} ON public.ediel_message_events;DROP FUNCTION public.${fn}()`)}
 // A genuine concurrent revocation commits while the command waits for the
 // grant universe. It cannot mint a witness using an earlier permission read.
 const blocker=spawn('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']})
 const ready=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('native_grant_lock_timeout')),10000);blocker.stdout.on('data',chunk=>{if(String(chunk).includes('grant-locked')){clearTimeout(timeout);resolve()}});blocker.on('error',reject);blocker.on('exit',code=>{if(code)reject(Error('native_grant_lock_exit:'+code))})})
 blocker.stdin.write(`BEGIN;LOCK TABLE public.user_permissions IN SHARE ROW EXCLUSIVE MODE;UPDATE public.user_permissions SET is_active=false WHERE user_id=${literal(actor)} AND company_id=${literal(company)};SELECT 'grant-locked';\n`)
 await ready;const waiting=Promise.resolve(create())
 try{
  let observed=false
  for(let step=0;step<100;step++){
   observed=sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%ediel_create_outbound_ack_atomic_v1%' AND pid<>pg_backend_pid()))`)
   if(observed)break
   await new Promise(resolve=>setTimeout(resolve,25))
  }
  expect(observed,'actual atomic HTTP transaction waits behind the pending grant revocation').toBe(true)
 }finally{blocker.stdin.end('COMMIT;\n')}
 // The revoked grant is refused by the current business-ACK actor gate.
 expect((await waiting).error?.message).toMatch(/actor_not_authorized|ediel_business_ack_current_actor_required/);expect(effects()).toEqual(before)
 sql(`UPDATE public.user_permissions SET is_active=true WHERE user_id=${literal(actor)} AND company_id=${literal(company)}`)
 // Independent native transactions race under one actual DB lock. Two same
 // outcomes reuse one physical response; an opposite attempted outcome holds.
 const raced=await Promise.all([create(),create(),create({p_outcome:'positive'})]);const positives=raced.filter(x=>!x.error);expect(positives).toHaveLength(2);expect(new Set(positives.map(x=>x.data?.ackMessage.id)).size).toBe(1);expect(raced[2].error?.message).toMatch(/conflicting_ack_draft_exists|canonical_common_header_negative_only/)
 const own=positives[0].data!.ackMessage;expect(own.raw_payload).toBe(ownRaw);expect(own.ack_outcome).toBe('negative');expect(positives.filter(x=>x.data?.replayed===false)).toHaveLength(1)
 const after=effects();expect(after.messages).toBe(before.messages+1);expect(after.witnesses).toBe(before.witnesses+1);expect(after.consumptions).toBe(before.consumptions+1);expect(after.routeBindings).toBe(before.routeBindings+1);expect(after.events).toBe(before.events+1);expect(after.receipts).toBe(before.receipts+1);expect(after.outbox).toBe(before.outbox);expect(after.attempts).toBe(before.attempts)
 sql(`UPDATE public.communication_routes SET is_active=false,target_email='changed@example.invalid' WHERE id=${literal(routeId)};UPDATE public.ediel_route_profiles SET is_enabled=false,smtp_host='changed.example.invalid' WHERE id=${literal(profileId)}`)
 expect((await create({p_draft:{callerSource:'ignored-established'}})).data?.ackMessage.id).toBe(own.id);expect(effects()).toEqual(after)
 sql(`UPDATE public.user_permissions SET is_active=false WHERE user_id=${literal(actor)} AND company_id=${literal(company)}`);expect((await create()).error?.message).toMatch(/actor_not_authorized|ediel_business_ack_current_actor_required/);expect(effects()).toEqual(after)
 sql(`UPDATE public.user_permissions SET is_active=true WHERE user_id=${literal(actor)} AND company_id=${literal(company)};UPDATE public.tenant_actor_identifiers SET valid_to=now() WHERE id=${literal(roleId)}`);expect((await create()).error?.message).toContain('current_identity_unavailable');expect(effects()).toEqual(after)
})

// 20261001134600/142520: every executing technical port names its actual
// current actor and phase natively; actorless V1 ports are closed to service.
it('qualifies persisted CONTRL and source-ACK reads only for the actual current actor in the requested phase',async()=>{
 const {readPersistedEdielTechnicalContrlBasis,readEdielTechnicalSourceEndpoint}=await import('@/lib/ediel/ack/technicalSyntaxAuthority')
 const {findExistingAckForSource}=await import('@/lib/ediel/core/ackPolicy')
 const company=randomUUID(),actor=randomUUID(),stranger=randomUUID(),sourceId=randomUUID(),ackId=randomUUID(),identifierId=randomUUID()
 const endpoint=sql<string>(`SELECT to_jsonb(min(n)::text) FROM generate_series(80000,89999)n WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.environment='test' AND i.identifier_type='EdielId' AND i.identifier_value=n::text AND (i.valid_to IS NULL OR now()<i.valid_to))`)
 const sourceReference='S'+sourceId.replaceAll('-','').slice(0,13),ackReference='A'+ackId.replaceAll('-','').slice(0,13),sourceUnh='S'+sourceId.slice(0,8),ackUnh='A'+ackId.slice(0,8)
 const person=(id:string)=>`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${literal(id)},'authenticated','authenticated',${literal(id+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);
  INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(id)},${literal(id+'@example.invalid')},'Disposable phase operator','active') ON CONFLICT(id) DO UPDATE SET user_status='active';`
 const grant=(id:string,key:string)=>sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(id)},${literal(company)},id,key FROM public.permissions WHERE key=${literal(key)}`)
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'Disposable technical phase native','active');${person(actor)}${person(stranger)}
  INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(company)},${literal(actor)},'operations','active',now(),'{}','member',true,now(),'operations');
  INSERT INTO public.tenant_actor_identifiers(id,company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES(${literal(identifierId)},${literal(company)},'test',${literal(actor)},'EdielId',${literal(endpoint)},now()-interval '1 day');`)
 grant(actor,'communication.write')
 const raw=`UNB+UNOC:3+12345:14+${endpoint}:14+260930:1200+${sourceReference}++23-DDQ-PRODAT++++1'UNH+${sourceUnh}+PRODAT:D:97A:UN:E2SE6A'BGM+Z99+SOURCE+9+AB'DTM+137:202609301200:203'DTM+ZZZ:1:805'NAD+FR+12345:160:SVK+++++++SE'NAD+DO+${endpoint}:160:SVK+++++++SE'LIN+1'UNT+8+${sourceUnh}'UNZ+1+${sourceReference}'`
 const stored=await supabaseService.from('ediel_messages').insert({id:sourceId,company_id:company,...unlistedProdatRulePin(),environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z99',status:'received',raw_payload:raw,message_received_at:new Date().toISOString()}).select('*').single()
 expect(stored.error).toBeNull();const source=stored.data as EdielMessageRow
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
 const prepare={actorUserId:actor,phase:'prepare' as const}
 // Actorless V1 technical ports are no longer executable by the service role.
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string;code?:string}|null}>
 for(const [name,args] of [['ediel_read_technical_source_endpoint_v1',{p_source_message_id:sourceId}],['ediel_capture_technical_syntax_ack_basis_v1',{p_company_id:company,p_message_id:sourceId}],['ediel_require_technical_syntax_ack_basis_v1',{p_company_id:company,p_message_id:sourceId}]] as const)
  expect((await rpc(name,args)).error?.message).toMatch(/permission denied/)
 // A non-member never receives the technical endpoint, even read-only.
 await expect(readEdielTechnicalSourceEndpoint(sourceId,{actorUserId:stranger,phase:'read'})).rejects.toThrow('ediel_technical_endpoint_unqualified')
 expect((await readEdielTechnicalSourceEndpoint(sourceId,prepare))?.companyId).toBe(company)
 await recordEdielTechnicalSyntaxDecision({companyId:company,sourceMessageId:sourceId,sourceHash:createHash('sha256').update(raw).digest('hex'),syntaxDecision:decision.syntaxDecision as 'accepted'|'rejected',reasonCodes:decision.issues.map(issue=>issue.code),execution:prepare})
 const evidence=await captureEdielTechnicalSyntaxAckEvidence(company,sourceId,prepare)
 const outcome=evidence.syntaxDecision==='accepted'?'positive':'negative'
 const ownRaw=`UNB+UNOC:3+${endpoint}:14+12345:14+260930:1201+${ackReference}++23-DDQ-PRODAT++++1'UNH+${ackUnh}+CONTRL:2:2:UN:EDIEL2'UCI+${sourceReference}+12345:14+${endpoint}:14+${outcome==='positive'?'1':'4'}'UNT+3+${ackUnh}'UNZ+1+${ackReference}'`
 const persisted=await supabaseService.from('ediel_messages').insert({id:ackId,company_id:company,...contrlRoute(company,endpoint),environment:'test',direction:'outbound',message_standard:'edifact',message_family:'CONTRL',message_code:'CONTRL',status:'draft',related_message_id:sourceId,raw_payload:ownRaw,ack_outcome:outcome,source_operation_id:`ediel_ack:${sourceId}:CONTRL:message`}).select('*').single()
 expect(persisted.error).toBeNull()
 const persistedRead=(phase:'prepare'|'read'|'send',who=actor)=>readPersistedEdielTechnicalContrlBasis({companyId:company,environment:'test',ackMessageId:ackId,expectedRawPayload:ownRaw,actorUserId:who,phase})
 const sourceRead=(phase:'prepare'|'read'|'send',who=actor)=>findExistingAckForSource({actorUserId:who,phase,sourceMessageId:sourceId,ackFamily:'CONTRL',expectedSource:source})
 // WRITE prepares; it never authorizes SEND or READ.
 expect((await persistedRead('prepare')).ackMessage.id).toBe(ackId)
 expect((await sourceRead('prepare'))?.id).toBe(ackId)
 await expect(persistedRead('send')).rejects.toThrow('ediel_technical_ack_basis_required')
 await expect(persistedRead('read')).rejects.toThrow('ediel_technical_ack_basis_required')
 grant(actor,'ediel.send');expect((await persistedRead('send')).evidence.sourceMessageId).toBe(sourceId)
 grant(actor,'communication.read');expect((await sourceRead('read'))?.id).toBe(ackId)
 // A historical creator/actor that is no longer current gets nothing.
 await expect(persistedRead('send',stranger)).rejects.toThrow('ediel_technical_ack_basis_required')
 await expect(sourceRead('read',stranger)).rejects.toThrow('ediel_existing_ack_original_read_unavailable')
 sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${literal(company)} AND user_id=${literal(actor)}`)
 await expect(persistedRead('send')).rejects.toThrow('ediel_technical_ack_basis_required')
 await expect(sourceRead('prepare')).rejects.toThrow()
 await expect(readEdielTechnicalSourceEndpoint(sourceId,prepare)).rejects.toThrow('ediel_technical_endpoint_unqualified')
 sql(`UPDATE public.company_memberships SET is_active=true WHERE company_id=${literal(company)} AND user_id=${literal(actor)}`)
 expect((await persistedRead('send')).ackMessage.raw_payload).toBe(ownRaw)
})
