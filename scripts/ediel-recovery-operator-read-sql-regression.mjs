// Compose the unchanged current catalog regression, then the actual operator
// read RPC. Catalog grants and private source-qualifier dependencies are bounded
// declared fixtures. This does not claim native Supabase or authentic sources.
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const baseUrl=new URL('./ediel-recovery-current-catalog-sql-regression.mjs',import.meta.url)
const migrationUrl=new URL('../supabase/migrations/20261001141500_ediel_prodat_recovery_operator_read_port.sql',import.meta.url)
const readSql=readFileSync(migrationUrl,'utf8')
let base=readFileSync(baseUrl,'utf8')
const catalogSql=readFileSync(new URL('../supabase/migrations/20261001103438_ediel_recovery_current_execution_catalog_and_lock_order.sql',import.meta.url),'utf8')
const provenance={catalogProbeSha256:createHash('sha256').update(base).digest('hex'),catalogMigrationSha256:createHash('sha256').update(catalogSql).digest('hex'),readMigrationSha256:createHash('sha256').update(readSql).digest('hex')}
base=base.replace("new URL('../supabase/migrations/'+migration,import.meta.url)",`new URL(migration,${JSON.stringify(new URL('../supabase/migrations/',import.meta.url).href)})`)
const marker=' console.log(`PASS ${checks} bounded current-phase/catalog/'
const start=base.indexOf(marker),stop=base.indexOf('\n}finally{',start)
if(start<0||stop<0)throw Error('Existing catalog regression boundary changed')
const stage=String.raw`
 {
 const catalogChecks=checks,reader=id(4),foreign=id(9);
 const helperMetadata=()=>db.query("SELECT oid,to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid='gridex_received_sources.require_recovery_execution_actor_v1(uuid,uuid,text)'::regprocedure");
 const delegateMetadata=()=>db.query(\`SELECT oid::regprocedure::text signature,to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid=ANY(ARRAY[\${targets.map(n=>\`'\${n}(jsonb)'::regprocedure\`).join(',')}]) ORDER BY oid\`);
 const oldHelper=(await helperMetadata()).rows,oldDelegates=(await delegateMetadata()).rows;
 await db.exec(\`ALTER TABLE public.ediel_messages ADD company_id uuid,ADD environment text,ADD direction text,ADD message_family text,ADD message_code text,ADD status text,ADD raw_payload text,ADD immutable_payload_hash text,ADD source_operation_id text,ADD original_message_id uuid,ADD contrl_status text,ADD aperak_status text,ADD external_reference text,ADD created_at timestamptz;
 CREATE TABLE gridex_received_sources.prodat_recovery_operations(id uuid PRIMARY KEY,company_id uuid,environment text,original_message_id uuid,corrected_raw_payload text,corrected_payload_hash text);
 CREATE TABLE gridex_received_sources.prodat_recovery_messages(message_id uuid PRIMARY KEY,operation_id uuid);
 CREATE TABLE gridex_ediel_transport.attempts(id uuid PRIMARY KEY,message_id uuid,company_id uuid,environment text,classification text,created_at timestamptz);
 CREATE TABLE public.declared_read_source_qualification(message_id uuid PRIMARY KEY,current boolean);
 REVOKE ALL ON gridex_received_sources.prodat_recovery_operations,gridex_received_sources.prodat_recovery_messages,gridex_ediel_transport.attempts,public.declared_read_source_qualification FROM PUBLIC,anon,authenticated,service_role;
 CREATE FUNCTION public.ediel_require_prodat_recovery_current_v1(c uuid,m_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
 DECLARE m public.ediel_messages%rowtype;op gridex_received_sources.prodat_recovery_operations%rowtype;source public.ediel_messages%rowtype;
 BEGIN
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=m_id AND company_id=c;
 SELECT o.* INTO STRICT op FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations o ON o.id=link.operation_id WHERE link.message_id=m.id AND o.company_id=c AND o.environment=m.environment;
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE id=op.original_message_id AND company_id=c AND environment=op.environment;
 IF m.source_operation_id IS DISTINCT FROM op.id::text OR m.original_message_id IS DISTINCT FROM op.original_message_id OR m.raw_payload IS DISTINCT FROM op.corrected_raw_payload OR m.immutable_payload_hash IS DISTINCT FROM op.corrected_payload_hash OR source.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') OR NOT EXISTS(SELECT FROM public.declared_read_source_qualification WHERE message_id=source.id AND current) THEN RAISE EXCEPTION 'declared_current_recovery_source_held';END IF;
 END$$;
 REVOKE ALL ON FUNCTION public.ediel_require_prodat_recovery_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;\`);
 await db.exec(__READ_SQL__);equal((await helperMetadata()).rows,oldHelper);equal((await delegateMetadata()).rows,oldDelegates);
 await db.query("INSERT INTO public.companies VALUES($1,'active')",[foreign]);await db.query('INSERT INTO auth.users(id) VALUES($1)',[reader]);await db.query("INSERT INTO public.user_profiles VALUES($1,'active',NULL)",[reader]);await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,clock_timestamp())",[c,reader]);await db.exec("INSERT INTO public.permissions VALUES('communication.read',true)");await db.query("INSERT INTO public.synthetic_grants VALUES($1,$2,'communication.read',true)",[c,reader]);
 const rpc=async(actor=reader,messageId=null,company=c)=>{await db.exec('SET ROLE service_role');try{return(await db.query('SELECT public.ediel_prodat_recovery_workspace_v1($1,$2,$3)b',[company,actor,messageId])).rows[0].b}finally{await db.exec('RESET ROLE').catch(error=>{if(error.code!=='25P02')throw error})}};
 const rejected=async(fn,re)=>{await assert.rejects(fn(),re);checks++};
 await rejected(()=>rpc(writer),/execution_actor_forbidden/);await rejected(()=>rpc(sender),/execution_actor_forbidden/);await denied(reader,'prepare');await denied(reader,'send');
 const insertMessage=async(n,{company=c,env='test',direction='outbound',family='PRODAT',raw='DECLARED WIRE '+n,operation=null,original=null}={})=>db.query("INSERT INTO public.ediel_messages VALUES($1,$2,$3,$4,$5,$6,'queued',$7,encode(sha256(convert_to($7,'UTF8')),'hex'),$8,$9,'accepted','negative',$10,clock_timestamp()+($11||' seconds')::interval)",[id(n),company,env,direction,family,family==='PRODAT'?'Z13':family,raw,operation&&id(operation),original&&id(original),'DECLARED-'+n,n]);
 await insertMessage(10);await insertMessage(11,{direction:'inbound',family:'APERAK'});await insertMessage(12,{direction:'inbound',family:'CONTRL'});await insertMessage(13,{direction:'inbound',family:'PRODAT'});await insertMessage(14,{family:'UTILTS'});await insertMessage(15,{company:foreign});await insertMessage(16,{env:'production'});
 const discovery=await rpc();equal(discovery.record,null);equal(discovery.originals.map(x=>x.id).sort(),[id(10),id(16)].sort());equal(discovery.acks.map(x=>x.id).sort(),[id(11),id(12)].sort());equal(discovery.corrections,[]);equal(discovery.attempts,[]);
 const original=await rpc(reader,id(10));equal(original.record.contentCurrent,true);equal(original.record.rawPayload,'DECLARED WIRE 10');equal(original.record.sourceCurrent,'not_applicable');
 await rejected(()=>rpc(reader,id(15)),/message_unavailable/);await rejected(()=>rpc(reader,id(13)),/message_unavailable/);await rejected(()=>rpc(reader,id(14)),/message_unavailable/);
 await db.query("UPDATE public.ediel_messages SET raw_payload=raw_payload||' DRIFT' WHERE id=$1",[id(10)]);const drift=await rpc(reader,id(10));equal([drift.record.contentCurrent,drift.record.rawPayload],[false,null]);await db.query('UPDATE public.ediel_messages SET raw_payload=$2 WHERE id=$1',[id(10),'DECLARED WIRE 10']);
 await insertMessage(20,{operation:30,original:10});await insertMessage(21,{env:'production',operation:31,original:10});await insertMessage(22,{operation:32,original:10});
 await db.query("INSERT INTO gridex_received_sources.prodat_recovery_operations SELECT $1,company_id,environment,$2,raw_payload,immutable_payload_hash FROM public.ediel_messages WHERE id=$3",[id(30),id(10),id(20)]);
 await db.query("INSERT INTO gridex_received_sources.prodat_recovery_operations SELECT $1,company_id,'test',$2,raw_payload,immutable_payload_hash FROM public.ediel_messages WHERE id=$3",[id(31),id(10),id(21)]);
 await db.query("INSERT INTO gridex_received_sources.prodat_recovery_operations SELECT $1,$2,environment,$3,raw_payload,immutable_payload_hash FROM public.ediel_messages WHERE id=$4",[id(32),foreign,id(10),id(22)]);
 for(const [m,op] of [[20,30],[21,31],[22,32]])await db.query('INSERT INTO gridex_received_sources.prodat_recovery_messages VALUES($1,$2)',[id(m),id(op)]);await db.query('INSERT INTO public.declared_read_source_qualification VALUES($1,true)',[id(10)]);
 equal((await rpc()).corrections.map(x=>x.id),[id(20)]);equal((await rpc(reader,id(20))).record.sourceCurrent,'qualified');equal((await rpc(reader,id(21))).record.sourceCurrent,'held');
 await db.query('UPDATE public.declared_read_source_qualification SET current=false');equal((await rpc(reader,id(20))).record.sourceCurrent,'held');await db.query('UPDATE public.declared_read_source_qualification SET current=true');await db.query('UPDATE public.ediel_messages SET original_message_id=$2 WHERE id=$1',[id(20),id(16)]);equal((await rpc(reader,id(20))).record.sourceCurrent,'held');await db.query('UPDATE public.ediel_messages SET original_message_id=$2 WHERE id=$1',[id(20),id(10)]);
 for(const [n,messageId,company,env] of [[40,10,c,'test'],[41,10,c,'production'],[42,15,c,'test'],[43,15,foreign,'test'],[44,14,c,'test'],[45,11,c,'test'],[46,16,c,'production']])await db.query("INSERT INTO gridex_ediel_transport.attempts VALUES($1,$2,$3,$4,'all_rejected',clock_timestamp())",[id(n),id(messageId),company,env]);equal((await rpc()).attempts.map(x=>x.id).sort(),[id(40),id(46)].sort());
 for(const mutation of [
  \`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id='\${reader}'\`,
  \`UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id='\${reader}'\`,
  \`UPDATE public.user_profiles SET disabled_at=clock_timestamp() WHERE id='\${reader}'\`,
  \`UPDATE public.user_profiles SET user_status='inactive' WHERE id='\${reader}'\`,
  \`UPDATE public.company_memberships SET accepted_at=NULL WHERE user_id='\${reader}'\`,
  \`UPDATE public.company_memberships SET status='inactive' WHERE user_id='\${reader}'\`,
  \`UPDATE public.companies SET status='suspended' WHERE id='\${c}'\`,
  \`UPDATE public.permissions SET is_active=false WHERE key='communication.read'\`,
  \`UPDATE public.synthetic_grants SET allowed=false WHERE user_id='\${reader}'\`,
 ]){await db.exec('BEGIN;'+mutation);await rejected(()=>rpc(reader,id(20)),/execution_actor_forbidden/);await db.exec('ROLLBACK')}
 // A declared private graph-port mutation injects revocation precisely at
 // the second (after selected row lock) or third (before return) native gate.
 // This verifies actual current-read rechecks, not concurrent native locking.
 await db.exec(\`CREATE TABLE public.declared_read_gate_injection(call_count int,fail_at int);INSERT INTO public.declared_read_gate_injection VALUES(0,0);
 CREATE OR REPLACE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE plpgsql AS $$DECLARE n int;f int;BEGIN LOCK TABLE auth.users,public.user_profiles,public.companies,public.company_memberships,public.permissions,public.synthetic_grants IN SHARE MODE;UPDATE public.declared_read_gate_injection SET call_count=call_count+1 RETURNING call_count,fail_at INTO n,f;IF n=f THEN UPDATE public.synthetic_grants SET allowed=false WHERE key='communication.read';END IF;END$$;\`);
 for(const gate of [2,3]){await db.exec('BEGIN');await db.query('UPDATE public.declared_read_gate_injection SET call_count=0,fail_at=$1',[gate]);await rejected(()=>rpc(reader,id(20)),/execution_actor_forbidden/);await db.exec('ROLLBACK')}
 await rejected(()=>rpc(null),/execution_scope_required/);await rejected(()=>rpc(reader,null,foreign),/execution_actor_forbidden/);
 for(const role of ['anon','authenticated'])equal((await db.query("SELECT has_function_privilege($1,'public.ediel_prodat_recovery_workspace_v1(uuid,uuid,uuid)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 equal((await db.query("SELECT has_function_privilege('service_role','public.ediel_prodat_recovery_workspace_v1(uuid,uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,true);
 await rejected(()=>db.query('SELECT public.ediel_prodat_recovery_workspace_v1($1,$2,NULL)',[c,reader]),/workspace_service_required/);
 equal((await db.query("SELECT has_function_privilege('service_role','gridex_received_sources.require_recovery_execution_actor_v1(uuid,uuid,text)','EXECUTE') OR has_table_privilege('service_role','gridex_ediel_transport.attempts','SELECT') OR has_table_privilege('service_role','gridex_received_sources.prodat_recovery_operations','SELECT') allowed")).rows[0].allowed,false);
 const generated=(await db.query("SELECT pg_get_functiondef('public.ediel_prodat_recovery_workspace_v1(uuid,uuid,uuid)'::regprocedure)d")).rows[0].d;assert.equal(generated.match(/require_recovery_execution_actor_v1/g).length,3);assert(generated.indexOf('FOR SHARE')<generated.indexOf("require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'read')",generated.indexOf('FOR SHARE')));checks++;
 console.log(JSON.stringify({status:'PASS',checks,catalogChecks,operatorReadChecks:checks-catalogChecks,provenance:__PROVENANCE__,scope:'actual current catalog read/write/send and actual operator discovery, own selected content custody, private correction/current-source and attempt company/environment filtering, current revocation and service/private ACL',authority:'Bounded synthetic grants, message/private relation rows and source qualifier delegate. Actual catalog and read migration bodies; native Supabase/concurrency/authentic issuer/final-candidate qualification NOT_RUN.'}));
 }
`
const emittedStage=stage.replaceAll('\\`','`').replaceAll('\\${','${')
const composed=base.slice(0,start)+emittedStage.replace('__READ_SQL__',()=>JSON.stringify(readSql)).replace('__PROVENANCE__',()=>JSON.stringify(provenance))+base.slice(stop)
try{await import('data:text/javascript;base64,'+Buffer.from(composed).toString('base64'))}catch(error){console.error(JSON.stringify({status:'FAIL',message:error.message,code:error.code,where:error.where,stack:error.stack?.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'composed-read-test').split('\n').slice(0,4).join('\n')}));process.exitCode=1}
