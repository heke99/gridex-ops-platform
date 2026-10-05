// Actual source qualifier, retry queue/consume and actual journal replay cursor.
// Canonical ACK admission/correlation, service origin and archive/capability ports
// are declared synthetic boundaries. No authentic originals/native proof here.
import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';import assert from'node:assert/strict'
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
const file=name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8')
const fn=(name,f)=>{const s=file(f),a=s.indexOf(`CREATE FUNCTION ${name}`),b=s.indexOf('$$;',a)+3;assert(a>=0&&b>a);return s.slice(a,b)}
const raw=(ref,points=['A','B'],code='Z13',family='PRODAT',func='9')=>[`UNB+UNOC:3+12345:14+54321:14+261001:1200+${ref}++23-DDQ-PRODAT`,`UNH+1+${family}:D:97A:UN:E2SE6A`,`BGM+${code}+${ref}+${func}`,'NAD+FR+12345:160:SVK','NAD+DO+54321:160:SVK',...points.flatMap((p,i)=>[`LIN+${i+1}++${p}:::9`,`RFF+LI:LI-${p}`,'NAD+UD+5566778899:SE1:260','CCI++Z13','CAV+S17']),'UNT+20+1','UNZ+1+I'].join("'")+"'"
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE public.companies(id uuid PRIMARY KEY);
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,message_standard text,raw_payload text,immutable_payload_hash text,immutable_rendered_at timestamptz,original_message_id text,source_operation_id text,intent_id uuid,communication_route_id uuid,receiver_email text,route_profile_id uuid,contrl_status text,aperak_status text,ack_outcome text,execution_context_snapshot jsonb);
 CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);CREATE TABLE public.user_profiles(id uuid,user_status text);
 CREATE TABLE public.declared_current_permissions(actor uuid,permission text);CREATE FUNCTION public.gridex_actor_has_company_permission(a uuid,c uuid,p text)RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM public.declared_current_permissions WHERE actor=a AND permission=p)$$;
 CREATE FUNCTION public.canonical_tenant_operation_decision(uuid,text)RETURNS TABLE(allowed boolean)LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION public.ediel_require_scoped_capability_for_message_v1(uuid,uuid)RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
 CREATE TABLE public.ediel_message_payloads(company_id uuid,ediel_message_id uuid,encrypted_payload_ref text,payload_kind text,metadata jsonb);
 CREATE TABLE public.ediel_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ediel_message_id uuid,company_id uuid,environment text,status text,current_send_attempt_id uuid,locked_by text,locked_at timestamptz,priority int,lock_key text UNIQUE,message_family text,message_code text,route_profile_id uuid,payload jsonb,queued_at timestamptz,created_by uuid,updated_by uuid);
 CREATE TABLE public.ediel_mailboxes(id uuid,company_id uuid,environment text,is_active boolean,is_shared_platform_mailbox boolean);
 CREATE SCHEMA gridex_outbound_dispatch;CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(i jsonb)RETURNS jsonb LANGUAGE sql AS $$SELECT '{"scoped":false}'::jsonb$$;
 CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ack_authority;CREATE SCHEMA gridex_service_permission;
 CREATE TABLE gridex_received_sources.validation_assessments(id uuid,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,facts_text text,previous_assessment_id uuid);
 CREATE TABLE gridex_ack_authority.source_correlations(ack_message_id uuid,source_message_id uuid,company_id uuid,environment text,ack_family text,ack_outcome text,ack_scope text,ack_payload_hash text,source_payload_hash text,scope_outcomes jsonb);
 CREATE TABLE public.declared_service_source(message_id uuid PRIMARY KEY,current bool);
 CREATE FUNCTION gridex_service_permission.require_original_current_v1(c uuid,m uuid)RETURNS void LANGUAGE plpgsql AS $$BEGIN IF EXISTS(SELECT FROM public.declared_service_source WHERE message_id=m AND NOT current) THEN RAISE EXCEPTION 'declared_current_service_origin_held';END IF;END$$;
 CREATE FUNCTION gridex_service_permission.recovery_operation_before_current_service_v1(uuid,uuid,uuid)RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;`)
 await db.exec(file('20260930145115_ediel_generic_transport_attempts_v1.sql'))
 for(const name of['wire_tokens_bounded_v1','closure_wire_tokens_v2','permission_transition_immutable_v1'])await db.exec(fn(`gridex_received_sources.${name}`,'20260930144205_ediel_permission_source_atomic_transitions.sql'))
 await db.exec(file('20260930164804_ediel_prodat_retry_correction_authority.sql'))
 // Compose current actual journal body, same source wrapper/retry cursor names.
 await db.exec(`ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb)RENAME TO mutate_before_service_origin_v1;CREATE FUNCTION gridex_ediel_transport.dsn_sending_mailbox_v1(uuid,text,text)RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;`)
 // PGlite has no PostgreSQL LATIN1 module. Only that named byte-conversion
 // boundary uses an explicit deterministic declared Latin1 fixture adapter.
 await db.exec(`CREATE SCHEMA fixture;CREATE FUNCTION fixture.latin1_v1(v text)RETURNS bytea LANGUAGE sql IMMUTABLE AS $$SELECT decode(string_agg(lpad(to_hex(ascii(c)),2,'0'),'' ORDER BY n),'hex')FROM regexp_split_to_table(v,'')WITH ORDINALITY chars(c,n)$$;`);await db.exec(file('20260930203320_ediel_ai_shared_transport_journal.sql').replaceAll("convert_to(m.raw_payload,'LATIN1')",'fixture.latin1_v1(m.raw_payload)'))
 await db.exec(`CREATE FUNCTION gridex_ediel_transport.mutate_v1(p_input jsonb)RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN PERFORM public.ediel_require_service_permission_origin_current_v1((p_input->>'companyId')::uuid,(p_input->>'messageId')::uuid);RETURN gridex_ediel_transport.mutate_before_service_origin_v1(p_input);END$$;CREATE FUNCTION public.ediel_require_service_permission_origin_current_v1(uuid,uuid)RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;`)
 await db.exec(file('20260930175725_ediel_source_authorized_transport_retry_cursor.sql'))
 await db.exec(`ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb)RENAME TO mutate_before_original_basis_v1;CREATE SCHEMA gridex_ediel_source_rules;CREATE SCHEMA gridex_ediel_technical_ack;CREATE FUNCTION gridex_ediel_source_rules.capture_v1(uuid,uuid)RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;CREATE FUNCTION gridex_ediel_technical_ack.require_contrl_v1(public.ediel_messages)RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;`)
 const header=file('20260930205320_ediel_prodat_common_header_rejection_authority.sql'),a=header.indexOf('CREATE OR REPLACE FUNCTION gridex_ediel_transport.mutate_before_positive_storage_v1'),b=header.indexOf('$$;',a)+3
 await db.exec(header.slice(a,b));await db.exec(`CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb)RETURNS jsonb LANGUAGE sql AS $$SELECT gridex_ediel_transport.mutate_before_positive_storage_v1(i)$$;`)
 await db.exec(`CREATE FUNCTION gridex_ediel_transport.accepted_source_basis_v1(public.ediel_messages)RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;`);await db.exec(file('20261001061029_ediel_prodat_recovery_execution_phase_authority.sql'));checks++
 // Compose the new common bridge with an explicit source-only boundary. Real
 // service source factoring is tested separately in the 62832 owner harness.
 await db.exec(`CREATE FUNCTION gridex_service_permission.require_original_source_current_v1(c uuid,m uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN IF EXISTS(SELECT FROM public.declared_service_source WHERE message_id=m AND NOT current) THEN RAISE EXCEPTION 'current_service_origin_held';END IF;END$$;CREATE OR REPLACE FUNCTION gridex_service_permission.require_original_current_v1(c uuid,m uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'historical_editor_requires_write';END$$;`)
 await db.exec(file('20261001065415_ediel_recovery_current_service_source_bridge.sql'));checks++
 // Restore the authentic public service reader wrapper on new private delegate.
 await db.exec(fn('public.ediel_prodat_recovery_original_basis_v1','20260930181909_ediel_source_consumer_authority_bridges.sql'))
 // The public lineage column is TEXT, exactly as the authentic schema.
 // Finite fixture has five of the twelve current function targets. Select
 // only those installed bodies; do not invent absent upstream owners. The
 // genuine native replay applies the unchanged complete forward migration.
 if(process.env.EDIEL_RECOVERY_REFERENCE_BASELINE!=='1'){
  const alignment=file('20261004202548_ediel_recovery_text_original_reference_alignment.sql')
  const fixtureAlignment=alignment.replace(') AS patches(signature,old_fragment,new_fragment)',') AS patches(signature,old_fragment,new_fragment) WHERE to_regprocedure(signature) IS NOT NULL')
  assert.notEqual(fixtureAlignment,alignment)
  await db.exec(fixtureAlignment)
 }
 // The finite generic/retry fixture has no sealed owner; its separate
 // actual-owner lease fixture exercises that lane. Native applies all five.
 if(process.env.EDIEL_WORKER_LEASE_BASELINE!=='1') await db.exec(file('20261004204256_ediel_worker_lease_current_provider_entry.sql').replace(') AS patches(signature,old_fragment,new_fragment)',') AS patches(signature,old_fragment,new_fragment) WHERE to_regprocedure(signature) IS NOT NULL'))
 await db.query('INSERT INTO public.companies VALUES($1)',[id(1)])
 for(const actor of[2,3,4,5]){await db.query("INSERT INTO auth.users VALUES($1);",[id(actor)]);await db.query("INSERT INTO public.user_profiles VALUES($1,'active')",[id(actor)]);await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())",[id(1),id(actor)])}
 for(const [actor,p]of[[2,'communication.write'],[2,'communication.send'],[3,'ediel.send'],[4,'communication.send'],[5,'communication.write']])await db.query('INSERT INTO public.declared_current_permissions VALUES($1,$2)',[id(actor),p])
 const message=async(n,payload,family='PRODAT',original=null,op=null)=>db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,message_code,message_standard,raw_payload,immutable_payload_hash,immutable_rendered_at,original_message_id,source_operation_id,communication_route_id,receiver_email)VALUES($1,$2,'test',$3,$4,$5,'edifact',$6,encode(sha256(convert_to($6,'UTF8')),'hex'),now(),$7,$8,$9,'peer@example.invalid')",[id(n),id(1),family==='PRODAT'?'outbound':'inbound',family,family==='PRODAT'?'Z13':family,payload,original&&id(original),op&&id(op),id(90)])
 const acknowledge=async(source,ack,objects)=>{await message(ack,raw(`ACK-${ack}`,[],'APERAK','APERAK','34'),'APERAK');await db.query("INSERT INTO gridex_received_sources.validation_assessments SELECT $1,id,company_id,environment,immutable_payload_hash,$2,NULL FROM public.ediel_messages WHERE id=$3",[id(ack+1000),JSON.stringify({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'}),id(ack)]);await db.query("INSERT INTO gridex_ack_authority.source_correlations SELECT a.id,s.id,s.company_id,s.environment,'APERAK','negative','object',a.immutable_payload_hash,s.immutable_payload_hash,$3 FROM public.ediel_messages a,public.ediel_messages s WHERE a.id=$1 AND s.id=$2",[id(ack),id(source),objects.map(point=>({reference:`LI-${point}`,outcome:'negative'}))])}
 const prepare=(actor,op,source,ack,corrected,attempt=null)=>db.query('SELECT public.ediel_prepare_prodat_recovery_v1($1,$2,$3,$4,$5,$6,$7)b',[id(1),id(source),id(actor),id(op),ack&&id(ack),attempt&&id(attempt),corrected])
 const basis=(actor=3,op=20)=>db.query('SELECT public.ediel_prodat_recovery_operation_basis_v1($1,$2,$3)b',[id(1),id(op),id(actor)])
 await message(10,raw('BASE'));await acknowledge(10,30,['A']);const first=raw('FIRST',['A']);assert.equal((await prepare(2,20,10,30,first)).rows[0].b.status,'authorized');checks++
 await message(11,first,'PRODAT',10,20);await db.query('INSERT INTO public.declared_service_source VALUES($1,true)',[id(10)])
 // Real prepare creation remains WRITE; current source reads are SEND union.
 await assert.rejects(prepare(3,21,10,30,raw('SECOND',['A'])),/execution_actor_forbidden/);checks++
 await db.query("UPDATE public.user_profiles SET user_status='inactive' WHERE id=$1",[id(2)]);await db.query('DELETE FROM public.declared_current_permissions WHERE actor=$1',[id(2)])
 assert.equal((await basis()).rows[0].b.sourceOriginMessageId,id(10));checks++
 assert.equal((await basis(4)).rows[0].b.sourceOriginMessageId,id(10));checks++
 assert.equal((await basis(5)).rows[0].b.sourceOriginMessageId,id(10));checks++
 await db.query('SELECT public.ediel_require_prodat_recovery_current_v1($1,$2) IS NULL v',[id(1),id(11)]);checks++
 await db.query('SELECT public.ediel_require_service_permission_origin_current_v1($1,$2) IS NULL v',[id(1),id(11)]);checks++
 await assert.rejects(basis(2),/execution_actor_forbidden/);checks++
 await db.query("UPDATE public.company_memberships SET accepted_at=NULL WHERE user_id=$1",[id(3)]);await assert.rejects(basis(),/execution_actor_forbidden/);checks++;await db.query('UPDATE public.company_memberships SET accepted_at=now() WHERE user_id=$1',[id(3)])
 await db.exec('UPDATE public.declared_service_source SET current=false');await assert.rejects(basis(),/current_service_origin_held/);checks++;await db.exec('UPDATE public.declared_service_source SET current=true')
 await db.exec("UPDATE gridex_ack_authority.source_correlations SET ack_outcome='positive'");await assert.rejects(basis(),/source_context_held/);checks++;await db.exec("UPDATE gridex_ack_authority.source_correlations SET ack_outcome='negative'")
 await db.query("UPDATE public.ediel_messages SET raw_payload=raw_payload||'X' WHERE id=$1",[id(30)]);await assert.rejects(basis(),/source_context_held/);checks++;await db.query('UPDATE public.ediel_messages SET raw_payload=$2 WHERE id=$1',[id(30),raw('ACK-30',[],'APERAK','APERAK','34')])
 // Private read-only source adapter cannot create operations, even owner-side.
 await assert.rejects(db.query('SELECT gridex_received_sources.qualify_established_recovery_source_v1($1,$2,$3,$4,$5,NULL,$6)',[id(1),id(10),id(2),id(99),id(30),first]),/established_operation_required/);checks++
 assert.equal((await db.query('SELECT count(*)n FROM gridex_received_sources.prodat_recovery_operations')).rows[0].n,1);checks++
 // A second genuine correction keeps immediate source, terminal service origin.
 await acknowledge(11,31,['A']);const second=raw('SECOND',['A']);assert.equal((await prepare(5,21,11,31,second)).rows[0].b.status,'authorized');checks++;await message(12,second,'PRODAT',11,21)
 const own=(await basis(3,21)).rows[0].b;assert.equal(own.originalMessageId,id(11));assert.equal(own.sourceOriginMessageId,id(10));assert.equal(own.allowedObjects.length,1);checks++
 await db.query("UPDATE public.ediel_messages SET original_message_id=$2 WHERE id=$1",[id(11),id(12)]);await assert.rejects(basis(3,21),/origin_alias_changed/);checks++;await db.query('UPDATE public.ediel_messages SET original_message_id=$2 WHERE id=$1',[id(11),id(10)])
 // Historical public references need not be UUID-shaped. Deny changed lineage
 // without attempting an unsafe cast of the TEXT field.
 await db.query("UPDATE public.ediel_messages SET original_message_id='historical-not-a-uuid' WHERE id=$1",[id(11)]);await assert.rejects(basis(3,21),/origin_alias_changed/);checks++;await db.query('UPDATE public.ediel_messages SET original_message_id=$2 WHERE id=$1',[id(11),id(10)])
 // Actual journal with real MIME-byte binding/archive boundary and current actor.
 const binding=async(msg,payload)=>({originalHash:(await db.query('SELECT immutable_payload_hash h FROM public.ediel_messages WHERE id=$1',[id(msg)])).rows[0].h,routeId:id(90),to:'peer@example.invalid',from:'own@example.invalid',payloadHash:(await db.query("SELECT encode(sha256(fixture.latin1_v1($1)),'hex')h",[payload])).rows[0].h,payloadLength:Buffer.byteLength(payload,'latin1'),mimeSha256:'b'.repeat(64),mimeLength:99,mimeArchiveRef:`storage://declared/${msg}.mime`,rfcMessageId:`<declared-${msg}@example.invalid>`,mimeMode:'attachment',encoding:'latin1',sourceRulePackEvidence:{}})
 const archive=async(msg,b)=>db.query('INSERT INTO public.ediel_message_payloads VALUES($1,$2,$3,\'raw_mime\',$4)',[id(1),id(msg),b.mimeArchiveRef,{archive_verified:true,archived_mime_sha256:b.mimeSha256,archived_mime_bytes:b.mimeLength,archived_rfc_message_id:b.rfcMessageId}])
 const journal=(msg,actor,attempt,action,extra={})=>db.query('SELECT gridex_ediel_transport.mutate_v1($1)b',[{companyId:id(1),environment:'test',messageId:id(msg),actorUserId:id(actor),attemptId:id(attempt),action,...extra}])
 const correctedBinding=await binding(12,second);await archive(12,correctedBinding);
 assert.equal((await journal(12,3,40,'prepare',{owner:{kind:'direct'},binding:correctedBinding})).rows[0].b.proceed,true);checks++
 assert.equal((await journal(12,3,40,'enter')).rows[0].b.proceed,true);checks++
 assert.equal((await journal(12,3,40,'observe',{result:{accepted:['peer@example.invalid'],rejected:[],messageId:'<accepted>'}})).rows[0].b.classification,'accepted');checks++
 await db.exec('UPDATE public.declared_service_source SET current=false');const replay=(await journal(12,3,41,'prepare',{owner:{kind:'direct'},binding:correctedBinding})).rows[0].b;assert.equal(replay.providerReceipt.messageId,'<accepted>');checks++
 assert.equal((await journal(12,3,40,'enter')).rows[0].b.proceed,false);checks++
 await db.query("UPDATE public.user_profiles SET user_status='inactive' WHERE id=$1",[id(3)]);await assert.rejects(journal(12,3,40,'enter'),/replay_scope_invalid/);checks++;await db.query("UPDATE public.user_profiles SET user_status='active' WHERE id=$1",[id(3)]);await db.exec('UPDATE public.declared_service_source SET current=true')
 // Verified definite-loss retry: WRITE creator -> SEND-only new worker, no reset.
 const lostRaw=raw('LOST',['A']);await message(50,lostRaw);const lostBinding=await binding(50,lostRaw);await archive(50,lostBinding)
 assert.equal((await journal(50,4,51,'prepare',{owner:{kind:'direct'},binding:lostBinding})).rows[0].b.proceed,true);checks++
 await journal(50,4,51,'enter');assert.equal((await journal(50,4,51,'observe',{result:{accepted:[],rejected:['peer@example.invalid']}})).rows[0].b.classification,'all_rejected');checks++
 const before=(await db.query('SELECT to_jsonb(a)b FROM gridex_ediel_transport.attempts a WHERE id=$1',[id(51)])).rows[0].b
 assert.equal((await prepare(5,52,50,null,null,51)).rows[0].b.status,'authorized');checks++
 const queue=()=>db.query('SELECT public.ediel_queue_prodat_retry_v1($1,$2,$3,$4)b',[id(1),id(50),id(3),id(52)])
 const queued=(await queue()).rows[0].b;assert.equal(queued.status,'queued');checks++
 await db.query("UPDATE public.ediel_outbox SET status='sending',locked_at=now(),current_send_attempt_id=$2,locked_by='worker' WHERE id=$1",[queued.outboxId,id(54)])
 const retryBasis=(await db.query('SELECT public.ediel_prodat_retry_outbox_basis_v1($1,$2,$3)b',[id(1),queued.outboxId,id(3)])).rows[0].b;assert.equal(retryBasis.previousAttemptId,id(51));checks++
 const owner={kind:'worker',outboxId:queued.outboxId,sendAttemptId:id(54),workerId:'worker'},retryBinding={...lostBinding,recoveryAuthorization:retryBasis}
 await assert.rejects(journal(50,3,53,'prepare',{owner,binding:{...retryBinding,mimeSha256:'c'.repeat(64)}}),/archive_not_qualified/);checks++
 assert.equal((await db.query('SELECT count(*)n FROM gridex_received_sources.prodat_recovery_attempts')).rows[0].n,0);assert.equal((await db.query('SELECT state FROM gridex_ediel_transport.reservations WHERE message_id=$1',[id(50)])).rows[0].state,'observed');checks++
 assert.equal((await journal(50,3,53,'prepare',{owner,binding:retryBinding})).rows[0].b.proceed,true);checks++
 assert.deepEqual((await db.query('SELECT to_jsonb(a)b FROM gridex_ediel_transport.attempts a WHERE id=$1',[id(51)])).rows[0].b,before);checks++
 assert.equal((await queue()).rows[0].b.outboxId,queued.outboxId);checks++
 await journal(50,3,53,'enter');await journal(50,3,53,'observe',{result:{accepted:['peer@example.invalid'],rejected:[]}})
 assert.equal((await journal(50,3,55,'prepare',{owner,binding:retryBinding})).rows[0].b.classification,'accepted');checks++
 await assert.rejects(db.query('SELECT public.ediel_queue_prodat_retry_v1($1,$2,$3,$4)',[id(1),id(50),id(5),id(52)]),/execution_actor_forbidden/);checks++
 assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_received_sources.qualify_established_recovery_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)','execute')v")).rows[0].v,false);checks++
 const generated=(await db.query("SELECT pg_get_functiondef('gridex_received_sources.assess_recovery_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure)d")).rows[0].d;assert(!generated.includes('INSERT INTO'));assert(generated.includes('corrected_exact_failed_scope_required'));assert(generated.indexOf('prelock_recovery_candidate_v1')<generated.indexOf('SELECT * INTO m FROM public.ediel_messages'));checks++
 const lockedCreator=(await db.query("SELECT pg_get_functiondef('public.ediel_prepare_prodat_recovery_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure)d")).rows[0].d;assert(lockedCreator.indexOf('prelock_recovery_candidate_v1')<lockedCreator.indexOf('require_recovery_execution_actor_v1'));checks++
 console.log(JSON.stringify({checks,status:'PASS',scope:'actual current source owner/read-only qualifier, actor phase, alias source/ACK, actual journal/cursor/queue/rollback; external ports declared synthetic'}))
}catch(e){console.error(checks,e.message,e.code,e.where,e.detail,e.stack?.split("\n").slice(0,5).join("\n"));process.exitCode=1}finally{await db.close()}
