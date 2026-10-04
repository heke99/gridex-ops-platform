// Runs actual new source-binding SQL. The prior switch/production owners and
// protected BRP source are declared independent fixture ports; this is not
// authentic original, market responsibility, native replay or acceptance proof.
import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';import assert from'node:assert/strict'
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const fn=(file,name)=>{const s=readFileSync(new URL(file,import.meta.url),'utf8'),a=s.indexOf(`CREATE FUNCTION ${name}`),b=s.indexOf('$$;',a);if(a<0)throw Error(name);return s.slice(a,b+3)}
let checks=0
const raw=(brp='BRP',tail='')=>`UNB+UNOC:3+12345:14+54321:14+261001:1200+I++23-DDQ-PRODAT'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z03+DOC+9'NAD+FR+12345:160:SVK'NAD+DO+54321:160:SVK'LIN+1++POINT:::9'CCI++Z13'CAV+Z22'RFF+LI:LI'NAD+Z02+${brp}:160:SVK'${tail}DTM+92:202610011200:203'UNT+14+1'UNZ+1+I'`
const basis={status:'authorized',sourceKind:'signed_contract_brp_declaration',companyId:id(1),environment:'test',contractId:id(7),customerId:id(3),siteId:id(4),meteringPointId:id(5),pointId:'POINT',identityAgency:'9',gridArea:'TES',legalActorId:id(9),legalSenderId:'12345',legalReceiverId:'54321',at:'2026-10-01T11:00:00Z',supplyPeriodId:null,brpEdielId:'BRP',declarationId:id(8)}
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_brp_sources;
 CREATE TABLE companies(id uuid PRIMARY KEY);INSERT INTO companies VALUES('${id(1)}');
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,customer_id uuid,site_id uuid,metering_point_id uuid,raw_payload text,immutable_payload_hash text,immutable_rendered_at timestamptz);
 CREATE TABLE gridex_received_sources.switch_originals(message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid,contract_id uuid,contract_hash text,payload_hash text,original_object jsonb);
 CREATE TABLE gridex_received_sources.production_contract_events(id uuid PRIMARY KEY,company_id uuid,event_kind text,start_event_id uuid,contract_id uuid,contract_revision text,protected_contract_hash text,customer_id uuid,metering_point_id uuid,point_id text,identity_agency text,legal_actor_id uuid,legal_sender_id text,legal_receiver_id text,environment text,grid_area_code text);
 CREATE TABLE gridex_received_sources.production_contract_origins(event_id uuid,company_id uuid,message_id uuid,actor_user_id uuid,payload_hash text);
 CREATE TABLE gridex_received_sources.prodat_recovery_messages(message_id uuid,operation_id uuid);CREATE TABLE gridex_received_sources.prodat_recovery_operations(id uuid,company_id uuid,original_message_id uuid);
 CREATE TABLE source_port(basis jsonb,available bool);CREATE TABLE effects(message_id uuid);CREATE TABLE delegated_provider(x int);
 CREATE FUNCTION gridex_brp_sources.require_source_v1(c uuid,ct uuid,actor uuid,phase text,env text,customer uuid,site uuid,point uuid,at timestamptz,period uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE b jsonb;BEGIN SELECT basis INTO b FROM public.source_port WHERE available;IF b IS NULL THEN RETURN '{"status":"held","missing":["declared_authentic_brp_source"]}';END IF;IF phase NOT IN('prepare','send') OR c IS DISTINCT FROM (b->>'companyId')::uuid OR ct IS DISTINCT FROM (b->>'contractId')::uuid OR customer IS DISTINCT FROM (b->>'customerId')::uuid OR site IS DISTINCT FROM (b->>'siteId')::uuid OR point IS DISTINCT FROM (b->>'meteringPointId')::uuid OR env IS DISTINCT FROM b->>'environment' OR at IS DISTINCT FROM (b->>'at')::timestamptz OR period IS NOT NULL THEN RAISE EXCEPTION 'declared_brp_port_scope';END IF;RETURN b;END$$;
 CREATE FUNCTION gridex_received_sources.switch_origin_wire_v1(raw text) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"sender":"12345","receiver":"54321"}'::jsonb$$;
 CREATE FUNCTION gridex_received_sources.production_contract_source_for_execution_v1(c uuid,event uuid,actor uuid,permission text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','authorized','companyId',c,'environment','test','eventId',event,'contractId','${id(7)}','customerId','${id(3)}','siteId','${id(4)}','meteringPointId','${id(5)}','pointId','POINT','identityAgency','9','gridArea','TES','legalActorId','${id(9)}','legalSenderId','12345','legalReceiverId','54321','boundaryAt','2026-10-01T11:00:00Z','eventKind',(SELECT event_kind FROM gridex_received_sources.production_contract_events WHERE id=event))$$;
 CREATE FUNCTION gridex_received_sources.require_production_contract_source_current_v1(c uuid,m uuid,actor uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
 CREATE FUNCTION ediel_bind_switch_original_v1(c uuid,sw uuid,m uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF EXISTS(SELECT FROM public.effects WHERE message_id=m) THEN RETURN '{"status":"bound","idempotent":true}';END IF;INSERT INTO public.effects VALUES(m);RETURN '{"status":"bound","idempotent":false}';END$$;
 CREATE FUNCTION ediel_bind_switch_correction_v1(c uuid,m uuid,actor uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT public.ediel_bind_switch_original_v1(c,NULL,m,actor)$$;
 CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF i->>'frozen'='true' THEN RETURN '{"proceed":false,"providerReceipt":{"frozen":true}}';END IF;INSERT INTO public.delegated_provider VALUES(1);RETURN '{"proceed":true}';END$$;
 `)
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.permission_transition_immutable_v1','gridex_received_sources.permission_date_v1','gridex_received_sources.permission_time_v1'])await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',name))
 await db.exec(fn('../supabase/migrations/20260930164804_ediel_prodat_retry_correction_authority.sql','gridex_received_sources.prodat_recovery_wire_v1'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001011248_ediel_switch_production_brp_source_binding.sql',import.meta.url),'utf8'));checks++
 await db.query('INSERT INTO gridex_received_sources.production_contract_events VALUES($1,$2,\'signed\',NULL,$3,\'1\',repeat(\'a\',64),$4,$5,\'POINT\',\'9\',$6,\'12345\',\'54321\',\'test\',\'TES\')',[id(30),id(1),id(7),id(3),id(5),id(9)])
 await db.query('INSERT INTO source_port VALUES($1,true)',[basis])
 const add=async(n,text,code='Z03')=>{await db.query(`INSERT INTO ediel_messages VALUES($1,$2,'test','outbound','PRODAT',$3,$4,$5,$6,$7,encode(sha256(convert_to($7,'UTF8')),'hex'),now())`,[id(n),id(1),code,id(3),id(4),id(5),text]);if(code==='Z03')await db.query('INSERT INTO gridex_received_sources.switch_originals VALUES($1,$2,$3,repeat(\'a\',64),encode(sha256(convert_to($4,\'UTF8\')),\'hex\'),$5)',[id(n),id(1),id(7),text,{point:'POINT',identityAgency:'9',gridArea:'TES',start:'202610011200'}])}
 await add(20,raw());await add(21,raw('OTHER'));await add(22,raw('BRP',"NAD+Z02+BRP:160:SVK'"));await add(23,raw('BRP').replace("NAD+Z02+BRP:160:SVK'",''));
 const bind=n=>db.query('SELECT ediel_bind_switch_original_v1($1,$2,$3,$4) b',[id(1),id(10),id(n),id(2)])
 assert.equal((await bind(20)).rows[0].b.idempotent,false);assert.equal((await db.query('SELECT count(*) n FROM gridex_received_sources.switch_brp_source_bindings')).rows[0].n,1);checks++
 for(const n of [21,22,23]){await assert.rejects(bind(n),/signed_source_brp_required/);assert.equal((await db.query('SELECT count(*) n FROM effects WHERE message_id=$1',[id(n)])).rows[0].n,0);checks++}
 const mutate=(n,frozen=false)=>db.query('SELECT gridex_ediel_transport.mutate_v1($1) b',[{action:'prepare',companyId:id(1),messageId:id(n),actorUserId:id(2),frozen}])
 assert.equal((await mutate(20)).rows[0].b.proceed,true);checks++
 await db.query('UPDATE source_port SET basis=$1',[{...basis,brpEdielId:'OTHER'}]);await assert.rejects(mutate(20),/signed_source_brp_required/);assert.equal((await db.query('SELECT count(*) n FROM delegated_provider')).rows[0].n,1);checks++
 await db.exec('UPDATE source_port SET available=false');assert.equal((await bind(20)).rows[0].b.idempotent,true);assert.deepEqual((await mutate(20,true)).rows[0].b,{proceed:false,providerReceipt:{frozen:true}});checks++
 await assert.rejects(mutate(20),/signed_source_brp_required/);checks++
 await db.query('UPDATE source_port SET available=true,basis=$1',[basis]);
 const production=()=>db.query('SELECT gridex_received_sources.production_contract_source_for_execution_v1($1,$2,$3,\'communication.write\') b',[id(1),id(30),id(2)])
 assert.equal((await production()).rows[0].b.brpEdielId,'BRP');checks++
 await db.query('UPDATE source_port SET basis=$1',[{...basis,legalReceiverId:'other'}]);await assert.rejects(production(),/brp_scope_required/);checks++;await db.query('UPDATE source_port SET basis=$1',[basis]);
 await db.exec('UPDATE source_port SET available=false');assert.equal((await production()).rows[0].b.status,'held');checks++;await db.exec('UPDATE source_port SET available=true');
 // A real origin's first message insertion fails atomically when its physical
 // 262 differs. Its protected event/source port is explicitly declared here.
 await db.query('INSERT INTO gridex_received_sources.production_contract_origins VALUES($1,$2,$3,$4,NULL)',[id(30),id(1),id(40),id(2)]);
 await assert.rejects(add(40,raw('OTHER'),'Z09'),/physical_source_brp_required/);assert.equal((await db.query('SELECT count(*) n FROM ediel_messages WHERE id=$1',[id(40)])).rows[0].n,0);checks++;
 await add(40,raw().replace('BGM+Z03','BGM+Z09').replace('CAV+Z22','CAV+Z70'),'Z09');await db.query('UPDATE gridex_received_sources.production_contract_origins SET payload_hash=(SELECT immutable_payload_hash FROM ediel_messages WHERE id=$1) WHERE message_id=$1',[id(40)]);await db.query('SELECT gridex_received_sources.require_production_contract_source_current_v1($1,$2,$3)',[id(1),id(40),id(2)]);checks++;
 await db.query('UPDATE source_port SET basis=$1',[{...basis,brpEdielId:'OTHER'}]);await assert.rejects(db.query('SELECT gridex_received_sources.require_production_contract_source_current_v1($1,$2,$3)',[id(1),id(40),id(2)]),/current_physical_brp_required/);checks++;
 // A ceased event uses the exact immutable contract-party proof of its own
 // approved signed start, even after fresh signed-contract admission is held.
 await db.query("INSERT INTO gridex_received_sources.production_contract_events SELECT $1,company_id,'ceased',id,contract_id,contract_revision,protected_contract_hash,customer_id,metering_point_id,point_id,identity_agency,legal_actor_id,legal_sender_id,legal_receiver_id,environment,grid_area_code FROM gridex_received_sources.production_contract_events WHERE id=$2",[id(31),id(30)]);
 await db.exec('UPDATE source_port SET available=false');
 const ceased=()=>db.query('SELECT gridex_received_sources.production_contract_source_for_execution_v1($1,$2,$3,\'communication.send\') b',[id(1),id(31),id(2)]);
 const end=(await ceased()).rows[0].b;assert.equal(end.status,'authorized');assert.equal(end.brpEdielId,'BRP');assert.equal(end.brpBasisKind,'production_original_contract_party');checks++;
 await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[raw('FORGED'),id(40)]);assert.equal((await ceased()).rows[0].b.status,'held');checks++;
 await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[raw().replace('BGM+Z03','BGM+Z09').replace('CAV+Z22','CAV+Z70'),id(40)]);
 await db.exec("UPDATE gridex_received_sources.production_contract_events SET contract_revision='2' WHERE event_kind='ceased'");assert.equal((await ceased()).rows[0].b.status,'held');checks++;

 await assert.rejects(db.exec('DELETE FROM gridex_received_sources.switch_brp_source_bindings'),/immutable/);assert.equal((await db.query("SELECT has_table_privilege('service_role','gridex_received_sources.switch_brp_source_bindings','INSERT') ok")).rows[0].ok,false);checks++;
 console.log(`PASS ${checks} actual normal/production BRP binding SQL checks; independent source ports synthetic, not native/market acceptance`)
}catch(error){console.error(error.message,error.where??'');process.exitCode=1}finally{await db.close()}
