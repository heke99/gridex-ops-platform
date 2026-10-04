// Actual source lineage/neutral wire/fresh outer wrapper. Negative ACK,
// independent event current source and journal delegates are declared fixtures;
// they are not authenticated originals/native replay or acceptance evidence.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const fn=(file,name)=>{const s=readFileSync(new URL(file,import.meta.url),'utf8');const a=s.indexOf(`CREATE FUNCTION ${name}`);assert(a>=0,name);return s.slice(a,s.indexOf('$$;',a)+3)}
const raw=(reference,points=['A','B'])=>[`UNB+UNOC:3+12345:14+54321:14+261001:1200+${reference}++23-DDQ-PRODAT`,`UNH+${reference}+PRODAT:D:97A:UN:E2SE6A`,`BGM+Z09+${reference}+9`,'NAD+FR+12345:160:SVK','NAD+DO+54321:160:SVK',...points.flatMap((point,index)=>[`LIN+${index+1}++${point}:::9`,'CCI++Z13','CAV+E34','CCI++Z17','CAV+Z41',`RFF+LI:LI-${point}`,'RFF+Z05:TES','DTM+157:202610010000:203','NAD+Z02+BRP:160:SVK','NAD+UD+5566778899:SE1:260++Own name+Own street+Own city++12345+SE']),'UNT+30+1','UNZ+1+I'].join("'")+"'"
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_customer_life_events;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_transport;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,immutable_payload_hash text,immutable_rendered_at timestamptz,original_message_id uuid,source_operation_id text);
 CREATE TABLE gridex_received_sources.prodat_recovery_operations(id uuid PRIMARY KEY,company_id uuid,environment text,original_message_id uuid,original_payload_hash text,kind text,source_ack_message_id uuid,corrected_raw_payload text,corrected_payload_hash text);
 CREATE TABLE gridex_received_sources.prodat_recovery_messages(operation_id uuid PRIMARY KEY,message_id uuid UNIQUE);
 CREATE TABLE gridex_customer_life_events.originals(message_id uuid PRIMARY KEY,event_id uuid,company_id uuid,payload_hash text);
 CREATE TABLE public.declared_operation_owner(operation uuid PRIMARY KEY,qualified bool);CREATE TABLE public.declared_event_owner(message_id uuid PRIMARY KEY,basis jsonb,qualified bool);
 CREATE TABLE public.named_phase_boundary(actor_id uuid,prepare bool,send bool);INSERT INTO public.named_phase_boundary VALUES('${id(2)}',true,true);
 CREATE TABLE public.named_transport_boundary(result jsonb,accepted bool,actor_qualified bool);INSERT INTO public.named_transport_boundary VALUES('{"proceed":true}',false,true);
 CREATE TABLE gridex_ediel_transport.reservations(message_id uuid PRIMARY KEY,state text);
 CREATE FUNCTION public.ediel_prodat_recovery_operation_basis_v1(c uuid,operation uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;BEGIN
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=operation AND company_id=c;
 IF op.id IS NULL OR NOT EXISTS(SELECT FROM public.declared_operation_owner q WHERE q.operation=op.id AND q.qualified) THEN RAISE EXCEPTION 'declared_negative_ack_operation_held';END IF;
 RETURN jsonb_build_object('operationId',op.id,'originalMessageId',op.original_message_id,'correctedPayloadHash',op.corrected_payload_hash);END$$;
 CREATE FUNCTION public.ediel_prodat_recovery_original_basis_v1(c uuid,message uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE op uuid;BEGIN SELECT operation_id INTO op FROM gridex_received_sources.prodat_recovery_messages WHERE message_id=message;RETURN public.ediel_prodat_recovery_operation_basis_v1(c,op,actor);END$$;
 CREATE FUNCTION gridex_customer_life_events.require_current_v1(c uuid,message uuid,actor uuid,phase text) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE b jsonb;BEGIN
 IF NOT EXISTS(SELECT FROM public.named_phase_boundary a WHERE a.actor_id=actor AND CASE phase WHEN 'prepare' THEN a.prepare WHEN 'send' THEN a.send ELSE false END) THEN RAISE EXCEPTION 'declared_current_execution_actor_held';END IF;
 SELECT basis INTO b FROM public.declared_event_owner q WHERE q.message_id=message AND q.qualified AND q.basis->>'companyId'=c::text;
 IF b IS NULL THEN RAISE EXCEPTION 'declared_independent_classification_source_held';END IF;RETURN jsonb_build_object('basis',b);END$$;
 CREATE FUNCTION gridex_ediel_transport.accepted_source_basis_v1(m public.ediel_messages) RETURNS jsonb LANGUAGE SQL AS $$SELECT CASE WHEN accepted THEN '{"frozenProviderTruth":true}'::jsonb ELSE NULL END FROM public.named_transport_boundary$$;
 CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF NOT(SELECT actor_qualified FROM public.named_transport_boundary) THEN RAISE EXCEPTION 'declared_transport_current_actor_held';END IF;RETURN(SELECT result FROM public.named_transport_boundary);END$$;`)
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2'])await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',name))
 await db.exec(fn('../supabase/migrations/20260930164804_ediel_prodat_retry_correction_authority.sql','gridex_received_sources.prodat_recovery_wire_v1'))
 await db.exec(fn('../supabase/migrations/20260930233247_ediel_customer_life_event_source_authority.sql','gridex_customer_life_events.wire_v1'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001041631_ediel_customer_event_recovery_source_lineage.sql',import.meta.url),'utf8'));checks++
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001055807_ediel_customer_event_recovery_fresh_transport_cohort.sql',import.meta.url),'utf8'));checks++
 const message=async(n,payload,original=null,operation=null)=>db.query("INSERT INTO public.ediel_messages VALUES($1,$2,'test','outbound','PRODAT','Z09',$3,encode(sha256(convert_to($3,'UTF8')),'hex'),now(),$4,$5)",[id(n),id(1),payload,original&&id(original),operation&&id(operation)])
 const operation=async(n,original,corrected,ack)=>{await db.query("INSERT INTO gridex_received_sources.prodat_recovery_operations VALUES($1,$2,'test',$3,(SELECT immutable_payload_hash FROM public.ediel_messages WHERE id=$3),'aperak_correction',$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'))",[id(n),id(1),id(original),id(ack),corrected]);await db.query('INSERT INTO public.declared_operation_owner VALUES($1,true)',[id(n)])}
 await message(10,raw('BASE'));await message(11,raw('FIRST',['A']),10,20);await message(12,raw('SECOND',['A']),11,21)
 await message(30,raw('ACK-BOUNDARY'));await message(31,raw('ACK-BOUNDARY-2'))
 await operation(20,10,raw('FIRST',['A']),30);await operation(21,11,raw('SECOND',['A']),31)
 await db.query('INSERT INTO gridex_received_sources.prodat_recovery_messages VALUES($1,$2),($3,$4)',[id(20),id(11),id(21),id(12)])
 await db.query("INSERT INTO gridex_customer_life_events.originals SELECT id,$2,company_id,immutable_payload_hash FROM public.ediel_messages WHERE id=$1",[id(10),id(40)])
 const basis={status:'authorized',companyId:id(1),environment:'test',eventId:id(40),classification:'death',selection:{objects:['A','B'].map(point=>({installation:{id:point,agency:'9'},lineItemReference:`LI-${point}`,customerStatus:'Z41'}))}}
 await db.query('INSERT INTO public.declared_event_owner VALUES($1,$2,true)',[id(10),basis])
 const read=(op=21,phase='prepare',company=1,actor=2)=>db.query('SELECT gridex_customer_life_events.recovery_basis_v1($1,$2,$3,$4)b',[id(company),id(op),id(actor),phase])
 assert.equal((await read(20)).rows[0].b.originalMessageId,id(10));checks++
 const second=(await read()).rows[0].b
 assert.equal(second.originalMessageId,id(11));assert.equal(second.classifiedOriginalMessageId,id(10));assert.equal(second.rawPayload,raw('SECOND',['A']));checks++
 assert.equal(second.selection.objects.length,1);assert.equal(second.selection.objects[0].installation.id,'A');checks++
 assert.equal((await read(21,'send')).rows[0].b.eventId,id(40));checks++
 assert.equal((await read(21,'prepare',99)).rows[0].b,null);checks++
 await assert.rejects(read(21,'invented'),/phase_required/);checks++
 await db.exec(`UPDATE public.declared_event_owner SET qualified=false`);await assert.rejects(read(),/independent_classification_source_held/);checks++;await db.exec('UPDATE public.declared_event_owner SET qualified=true')
 await db.exec(`UPDATE public.declared_operation_owner SET qualified=false WHERE operation='${id(20)}'`);await assert.rejects(read(),/negative_ack_operation_held/);checks++;await db.exec('UPDATE public.declared_operation_owner SET qualified=true')
 await operation(22,11,raw('REINTRODUCE',['A','B']),31);await assert.rejects(read(22),/approved_tuple_changed/);checks++
 await db.query('UPDATE public.ediel_messages SET original_message_id=$2 WHERE id=$1',[id(11),id(12)]);await assert.rejects(read(),/alias_source_changed/);checks++;await db.query('UPDATE public.ediel_messages SET original_message_id=$2 WHERE id=$1',[id(11),id(10)])
 await db.query('UPDATE public.ediel_messages SET raw_payload=$2 WHERE id=$1',[id(11),raw('EDITED',['A'])]);await assert.rejects(read(),/original_source_changed/);checks++;await db.query('UPDATE public.ediel_messages SET raw_payload=$2 WHERE id=$1',[id(11),raw('FIRST',['A'])])
 await db.query('UPDATE gridex_received_sources.prodat_recovery_operations SET original_message_id=$2 WHERE id=$1',[id(20),id(11)]);await assert.rejects(read(),/lineage_cycle/);checks++;await db.query('UPDATE gridex_received_sources.prodat_recovery_operations SET original_message_id=$2 WHERE id=$1',[id(20),id(10)])

 await db.query("UPDATE gridex_received_sources.prodat_recovery_operations SET corrected_payload_hash=repeat('f',64) WHERE id=$1",[id(21)]);await assert.rejects(read(),/current_source_required/);checks++;await db.query("UPDATE gridex_received_sources.prodat_recovery_operations SET corrected_payload_hash=encode(sha256(convert_to(corrected_raw_payload,'UTF8')),'hex') WHERE id=$1",[id(21)])
 await db.query("UPDATE public.ediel_messages SET environment='production' WHERE id=$1",[id(11)]);await assert.rejects(read(),/original_source_changed/);checks++;await db.query("UPDATE public.ediel_messages SET environment='test' WHERE id=$1",[id(11)])
 await message(100,raw('UNRELATED',['A']));await operation(101,100,raw('UNRELATED-CORRECTION',['A']),31);assert.equal((await read(101)).rows[0].b,null);checks++
 let previous=10
 for(let n=200;n<233;n++){await message(n,raw(`BOUND-${n}`,['A']),previous,n+1000);await operation(n+1000,previous,raw(`BOUND-${n}`,['A']),31);await db.query('INSERT INTO gridex_received_sources.prodat_recovery_messages VALUES($1,$2)',[id(n+1000),id(n)]);previous=n}
 await assert.rejects(db.query('SELECT gridex_customer_life_events.recovery_lineage_v1($1,$2)',[id(1),id(1232)]),/bound_exceeded/);checks++
 // Outer boundary: only a genuinely fresh attempt runs lineage before delegate.
 const native=()=>db.query('SELECT gridex_ediel_transport.mutate_v1($1)b',[{action:'prepare',companyId:id(1),messageId:id(12),environment:'test',actorUserId:id(2)}])
 assert.equal((await native()).rows[0].b.proceed,true);checks++
 // Corrupt only the declared mechanical chain; frozen replay must delegate
 // first rather than require a new source/classification after old truth.
 await db.query('UPDATE gridex_received_sources.prodat_recovery_operations SET original_message_id=$2 WHERE id=$1',[id(20),id(11)])
 await db.exec(`INSERT INTO gridex_ediel_transport.reservations VALUES('${id(12)}','observed');UPDATE public.named_transport_boundary SET result='{"proceed":false,"classification":"accepted","providerReceipt":{"frozen":true}}'`)
 assert.equal((await native()).rows[0].b.providerReceipt.frozen,true);checks++
 await db.exec('UPDATE public.named_transport_boundary SET actor_qualified=false');await assert.rejects(native(),/current_actor_held/);checks++;await db.exec('UPDATE public.named_transport_boundary SET actor_qualified=true')
 await db.exec('DELETE FROM gridex_ediel_transport.reservations;UPDATE public.named_transport_boundary SET accepted=true')
 assert.equal((await native()).rows[0].b.providerReceipt.frozen,true);checks++
 await db.exec('UPDATE public.named_transport_boundary SET accepted=false');await assert.rejects(native(),/lineage_cycle/);checks++
 await db.exec('SET ROLE service_role');await assert.rejects(read(),/permission denied/);checks++;await db.exec('RESET ROLE')
 console.log(JSON.stringify({checks,status:'PASS',scope:'actual bounded lineage, same event/current phase, immediate failed subset and real fresh outer; named external owner boundaries synthetic'}))
}catch(error){console.error(error.message,error.code,error.where,error.detail);process.exitCode=1}finally{await db.close()}
