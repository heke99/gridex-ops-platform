// masterplan: SC-037
// Finite SQL component: unaltered installed ACK wrapper/leaf and activation bodies.
// Synthetic canonical/actor/provider/parser/guide/retention/bilateral ports and inner
// supply-effect delegate are explicit below. Full table definitions are extracted
// from schema.sql, including supply_source_transitions. No native, SMTP or whole-ID
// authority; pending first activation and established activation replay are separate.
import {readFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest'
type Row=Record<string,unknown>
type Original={origin:string;document:string}
type Seed=Original&{z04:string;sw:string;p:string;ct:string;customer:string;point:string;site:string}
const signature='gridex_ack_authority.apply_before_committed_replay_v1(uuid,text,uuid,uuid,uuid)'
const forward=resolve('supabase/migrations/20261013133852_sc037_late_ack_confirmed_dispatch.sql')
const schema=readFileSync(resolve('supabase/schema.sql'),'utf8')
const escape=(value:string)=>value.replaceAll('.', '\\.')
function fn(name:string):string{const found=new RegExp(String.raw`CREATE FUNCTION ${escape(name)}\([\s\S]*?AS (\$[^$]*\$)[\s\S]*?\1;`).exec(schema);if(!found)throw Error('SETUP_GAP: missing function '+name);return found[0]}
function table(name:string):string{const found=new RegExp(String.raw`CREATE TABLE ${escape(name)} \([\s\S]*?\n\);`).exec(schema);if(!found)throw Error('SETUP_GAP: missing table '+name);return found[0]}
const functions=['gridex_ack_authority.apply_before_committed_replay_v1','gridex_ack_authority.apply_before_physical_outcomes_v1','gridex_ack_authority.apply_before_prodat_unused_document_v1','gridex_ack_authority.apply_before_received_err_response_v1','gridex_ack_authority.apply_before_reference_profile_v1','gridex_ack_authority.apply_before_unused_unh_v1','gridex_ack_authority.apply_v1','public.gridex_apply_inbound_ack_source_v1','gridex_received_sources.sent_source_is_current_v1','public.activate_customer_supply_v1','gridex_received_sources.normal_switch_wire_v1','gridex_received_sources.production_contract_hash_v1']
const tables=['public.ediel_messages','public.supplier_switch_requests','public.customer_supply_periods','public.customer_contracts','public.user_profiles','public.company_memberships','public.tenant_ediel_profiles','public.tenant_actor_roles','public.tenant_actor_identifiers','public.ediel_ack_chains','gridex_received_sources.sources','gridex_received_sources.validation_assessments','gridex_received_sources.normal_switch_confirmations','gridex_received_sources.normal_supply_activations','gridex_ack_authority.source_correlations','gridex_ack_authority.scope_outcomes','gridex_ack_authority.applied_receipts','gridex_ack_authority.prodat_physical_receipts','gridex_received_sources.supply_source_transitions']
let db:PGlite
let initialCatalog:unknown,initialReaders:unknown
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const C=id(1),ACT=id(2),LEGAL=id(3)
beforeAll(async()=>{
 db=new PGlite();await db.waitReady
 await setup()
 initialCatalog=await leafCatalog();initialReaders=await readers()
 // The official empty forward scaffold permits valid test-first RED. Once
 // implementation exists, the same tests execute its real migration unchanged.
 if(existsSync(forward))await db.exec(readFileSync(forward,'utf8'))
},30000)
beforeEach(async()=>{await db.exec('BEGIN')})
afterEach(async()=>{await db.exec('ROLLBACK')})
afterAll(async()=>{await db?.close()})
async function setup(){
const stubs=`CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ack_authority;CREATE SCHEMA gridex_ediel_inbound_context;CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_bilateral_prodat;CREATE SCHEMA gridex_ediel_source_rules;CREATE SCHEMA gridex_ediel_ack_guide;CREATE SCHEMA gridex_ediel_ack_replay;CREATE SCHEMA auth;CREATE SCHEMA extensions;
CREATE ROLE service_role;
CREATE FUNCTION public.gridex_new_public_resource_reference(text) RETURNS text LANGUAGE sql AS $$SELECT $1||gen_random_uuid()::text$$;
CREATE FUNCTION gridex_received_sources.source_wire_point_v1(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT 'fixture-point'::text$$;
CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION gridex_bilateral_prodat.lock_supply_v1() RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION gridex_bilateral_prodat.recorded_supply_current_v1(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION public.ediel_require_contract_records_available_v1(uuid,uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION public.ediel_require_source_bytes_available_v1(uuid,uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION gridex_ediel_inbound_context.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION gridex_ediel_source_rules.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION gridex_received_sources.closure_wire_tokens_v2(text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$WITH input AS(SELECT $1::jsonb wire) SELECT coalesce(jsonb_agg(jsonb_build_object('tag','LIN','elements',jsonb_build_array(jsonb_build_array('LIN'),jsonb_build_array(n::text),'[]'::jsonb,jsonb_build_array(own->>'point','','',own->>'identityAgency')))),'[]'::jsonb) FROM input CROSS JOIN LATERAL generate_series(1,coalesce((wire->>'physicalLines')::int,jsonb_array_length(wire->'objects'),1)) n CROSS JOIN LATERAL(SELECT coalesce(wire->'objects'->(n-1),wire->'objects'->0,'{}'::jsonb) own) objects$$;
CREATE FUNCTION gridex_received_sources.supply_wire_v1(text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$SELECT $1::jsonb$$;
CREATE FUNCTION gridex_ack_authority.wire_v1(text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$SELECT $1::jsonb$$;
CREATE FUNCTION gridex_ack_authority.source_match_v1(jsonb,jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$SELECT $1->>'forDocument'=$2->>'document' AND $2->>'family'='PRODAT'$$;
CREATE FUNCTION gridex_ack_authority.prodat_expected_physical_scope_keys_v1(text,uuid) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$SELECT '["fixture-LI"]'::jsonb$$;
CREATE FUNCTION gridex_ack_authority.prodat_physical_outcomes_v1(text,text,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '[{"reference":"fixture-LI","outcome":"positive"}]'::jsonb$$;
CREATE FUNCTION gridex_ack_authority.prodat_physical_source_projection_version_v1() RETURNS jsonb LANGUAGE sql AS $$SELECT '{"fixture":true}'::jsonb$$;
CREATE FUNCTION gridex_ack_authority.require_physical_actor_v1(uuid,uuid,boolean) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION gridex_ack_authority.read_committed_v1(c uuid,env text,aid uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE r jsonb;mid uuid;BEGIN SELECT ar.result,co.source_message_id INTO r,mid FROM gridex_ack_authority.applied_receipts ar JOIN gridex_ack_authority.source_correlations co ON co.ack_message_id=ar.ack_message_id WHERE ar.ack_message_id=aid AND co.company_id=c AND co.environment=env;RETURN CASE WHEN r IS NOT NULL THEN jsonb_build_object('kind','exact_receipt','sourceMessageId',mid,'result',r) ELSE NULL END;END$$;
CREATE FUNCTION gridex_ediel_ack_guide.require_unused_unh_v1(text,text) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION gridex_ediel_ack_guide.require_prodat_unused_document_v1(text) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION gridex_ediel_ack_guide.require_message_reference_profile_v1(text) RETURNS void LANGUAGE sql AS $$SELECT$$;`;
await db.exec(stubs);
for(const name of tables)await db.exec(table(name));
await db.exec(`CREATE FUNCTION gridex_ediel_transport.accepted_source_basis_v1(public.ediel_messages) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"fixture":"accepted-provider-port"}'::jsonb$$;
CREATE FUNCTION gridex_ediel_inbound_context.require_ack_v1(public.ediel_messages,public.ediel_messages) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION gridex_received_sources.activate_supply_before_source_guard_v1(c uuid,sw uuid,msg uuid,d date,actor uuid,k text) RETURNS TABLE(supplier_switch_request_id uuid,supply_period_id uuid,contract_id uuid,customer_application_id uuid,workflow_id uuid,domain_event_id uuid,notification_job_id uuid) LANGUAGE plpgsql AS $$DECLARE p public.customer_supply_periods%rowtype;BEGIN UPDATE public.customer_supply_periods SET status='active' WHERE source_switch_request_id=sw RETURNING * INTO p;UPDATE public.supplier_switch_requests SET status='completed' WHERE id=sw;RETURN QUERY SELECT sw,p.id,p.contract_id,p.id,p.id,p.id,p.id;END$$;

CREATE UNIQUE INDEX fixture_correlation_unique ON gridex_ack_authority.source_correlations(ack_message_id);
CREATE UNIQUE INDEX fixture_scope_unique ON gridex_ack_authority.scope_outcomes(source_message_id,ack_family,ack_scope,source_reference,ack_message_id);
CREATE UNIQUE INDEX fixture_applied_unique ON gridex_ack_authority.applied_receipts(ack_message_id);`);
for(const name of functions)await db.exec(fn(name));
await db.exec(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${signature} TO service_role`);
await db.exec('GRANT USAGE ON SCHEMA gridex_ack_authority TO service_role');
await db.exec(`INSERT INTO public.user_profiles(id)VALUES('${ACT}');INSERT INTO public.company_memberships(company_id,user_id,accepted_at)VALUES('${C}','${ACT}',now());
INSERT INTO public.tenant_ediel_profiles(company_id,environment,is_enabled,valid_from)VALUES('${C}','test',true,now()-interval '1 day');
INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from)VALUES('${C}','test','${LEGAL}','electricity_supplier',now()-interval '1 day');
INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from)VALUES('${C}','test','${LEGAL}','EdielId','fixture-supplier',now()-interval '1 day');`);
}
const q=async(sql:string,args:unknown[]=[])=> (await db.query<Row>(sql,args)).rows;
async function seed(n:number,{before=false,status='accepted'}:{before?:boolean;status?:string}={}){
 const ids={origin:id(n),z04:id(n+1),sw:id(n+2),p:id(n+3),ct:id(n+4),customer:id(n+5),point:id(n+6),site:id(n+7)};
 const object={line:'1',point:'fixture-point',identityAgency:'9',registerCount:1,li:'fixture-LI',customerIdentity:'fixture-customer',start:'202610200000',reason:'Z22'};
 const origin=JSON.stringify({family:'PRODAT',code:'Z03',environment:'test',document:'fixture-'+n,sender:'fixture-supplier',receiver:'fixture-dso',objects:[object]}); const z04=JSON.stringify({family:'PRODAT',code:'Z04',environment:'test',document:'z04-'+n,sender:'fixture-dso',receiver:'fixture-supplier',objects:[object]});
 await q(`INSERT INTO public.ediel_messages(id,company_id,direction,message_family,message_code,status,raw_payload,immutable_payload_hash,immutable_rendered_at,message_sent_at,requires_contrl,requires_aperak,contrl_status,aperak_status,utilts_err_status) VALUES($1,$2,'outbound','PRODAT','Z03','sent',$3,encode(sha256(convert_to($3,'UTF8')),'hex'),now()-interval '1 day',now()-interval '1 day',false,true,'not_required','pending','not_required')`,[ids.origin,C,origin]);
 await q(`INSERT INTO public.ediel_messages(id,company_id,direction,message_family,message_code,status,raw_payload,immutable_payload_hash,message_received_at)VALUES($1,$2,'inbound','PRODAT','Z04','received',$3,encode(sha256(convert_to($3,'UTF8')),'hex'),now())`,[ids.z04,C,z04]);
 await q(`INSERT INTO public.customer_contracts(id,company_id,customer_id,metering_point_id,status,signed_version,contract_version,signed_at)VALUES($1,$2,$3,$4,'signed','fixture-signed-v1','fixture-contract-v1',now()-interval '1 day')`,[ids.ct,C,ids.customer,ids.point]);
 await q(`INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,site_id,metering_point_id,contract_id,status,inbound_z04_message_id,outbound_z03_message_id,lifecycle_blocked)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,false)`,[ids.sw,C,ids.customer,ids.site,ids.point,ids.ct,status,ids.z04,ids.origin]);
 await q(`INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,start_date,market_start_at,source_message_id,source_switch_request_id,status,market_state_version,source_process)VALUES($1,$2,$3,$4,$5,current_date,now()+$6::interval,$7,$8,'confirmed_by_grid_owner',1,'supplier_switch_confirmation')`,[ids.p,C,ids.customer,ids.point,ids.ct,before?'1 hour':'-1 hour',ids.z04,ids.sw]);
 await q(`INSERT INTO gridex_received_sources.normal_switch_confirmations(source_message_id,period_id,company_id,switch_id,original_message_id,original_payload_hash,contract_id,protected_contract_hash,source_object,legal_context,market_start_at,confirmed_period,confirmed_switch)SELECT $1,p.id,$2,s.id,$3,m.immutable_payload_hash,p.contract_id,gridex_received_sources.production_contract_hash_v1((SELECT c FROM public.customer_contracts c WHERE c.id=p.contract_id)),'{"point":"fixture-point","identityAgency":"9","li":"fixture-LI","customerIdentity":"fixture-customer","start":"202610200000","reason":"Z22"}',jsonb_build_object('legalActorId',$4::text,'legalEdielId','fixture-supplier'),p.market_start_at,to_jsonb(p),to_jsonb(s) FROM public.customer_supply_periods p JOIN public.supplier_switch_requests s ON s.id=p.source_switch_request_id JOIN public.ediel_messages m ON m.id=$3 WHERE p.id=$5`,[ids.z04,C,ids.origin,LEGAL,ids.p]);
 await q(`INSERT INTO gridex_received_sources.supply_source_transitions(source_message_id,company_id,payload_hash,source_code,source_objects,previous_states,resulting_states,qualified_switch_ids,actor_user_id) SELECT $1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'),'Z04',jsonb_build_array(n.source_object),'[]',jsonb_build_array(n.confirmed_period),ARRAY[$4::uuid],$5 FROM gridex_received_sources.normal_switch_confirmations n WHERE n.source_message_id=$1`,[ids.z04,C,z04,ids.sw,ACT]);
 await q(`INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,origin,message_code,source_received_at,raw_payload,payload_hash,received_context)VALUES($1,$2,'test','database_insert','Z04',now(),$3,encode(sha256(convert_to($3,'UTF8')),'hex'),'{}')`,[ids.z04,C,z04]);
 return {...ids,document:'fixture-'+n};
}
async function ack(s:Original,n:number,{positive=false,family='APERAK'}:{positive?:boolean;family?:'APERAK'|'CONTRL'}={}){
 const aid=id(n);const raw=JSON.stringify({family,type:['APERAK','D','96A','UN','E2SE6A'],environment:'test',function:positive?'34':'27',erc:[positive?'100':'42'],refs:positive?{LI:['fixture-LI']}:{},uciRef:s.document,uciAction:positive?'1':'4',forDocument:s.document});
 await q(`INSERT INTO public.ediel_messages(id,company_id,direction,message_family,message_code,raw_payload,immutable_payload_hash,message_received_at)VALUES($1,$2,'inbound',$4,$4,$3,encode(sha256(convert_to($3,'UTF8')),'hex'),now())`,[aid,C,raw,family]);
 await q(`INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,origin,source_received_at,raw_payload,payload_hash,received_context)VALUES($1,$2,'test','database_insert',now(),$3,encode(sha256(convert_to($3,'UTF8')),'hex'),'{}')`,[aid,C,raw]);
 const facts=JSON.stringify({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'});
 await q(`INSERT INTO gridex_received_sources.validation_assessments(source_message_id,company_id,environment,source_payload_hash,facts_text,facts_hash)VALUES($1,$2,'test',encode(sha256(convert_to($3,'UTF8')),'hex'),$4,encode(sha256(convert_to($4,'UTF8')),'hex'))`,[aid,C,raw,facts]);
 return aid;
}
async function call<T>(run:()=>Promise<T>):Promise<T>{await db.exec('SAVEPOINT declared_call');try{const result=await run();await db.exec('RELEASE SAVEPOINT declared_call');return result}catch(error){await db.exec('ROLLBACK TO SAVEPOINT declared_call; RELEASE SAVEPOINT declared_call');throw error}}
const apply=(s:Original,aid:string)=>call(async()=>{await db.exec('SET ROLE service_role');const result=(await q('SELECT public.gridex_apply_inbound_ack_source_v1($1,$2,$3,$4,$5) AS r',[C,'test',aid,s.origin,ACT]))[0].r as Row;await db.exec('RESET ROLE');return result})
const activate=(s:Seed)=>call(()=>q('SELECT * FROM public.activate_customer_supply_v1($1,$2,$3,NULL,$4,NULL)',[C,s.sw,s.z04,ACT]))
const state=(s:Seed)=>q(`SELECT m.status AS original_status,m.aperak_status,s.status AS switch_status,p.status AS period_status,gridex_received_sources.sent_source_is_current_v1(m) AS sent_current,(SELECT count(*)::int FROM gridex_received_sources.normal_supply_activations a WHERE a.period_id=p.id) AS activation_count FROM public.ediel_messages m JOIN public.supplier_switch_requests s ON s.outbound_z03_message_id=m.id JOIN public.customer_supply_periods p ON p.source_switch_request_id=s.id WHERE m.id=$1`,[s.origin]).then(r=>r[0]);


const leafBody=async()=> (await q('SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure($1)',[signature]))[0].prosrc as string
const leafCatalog=async()=> (await q("SELECT to_jsonb(p)-'prosrc' AS metadata FROM pg_proc p WHERE oid=to_regprocedure($1)",[signature]))[0].metadata
const readers=async()=> (await q("SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) AS readers FROM pg_proc p WHERE p.oid=ANY(ARRAY[to_regprocedure('gridex_received_sources.sent_source_is_current_v1(public.ediel_messages)'),to_regprocedure('public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text)')])"))[0].readers
const reapply=()=>db.exec(readFileSync(forward,'utf8').replace(/^BEGIN;$/mg,'').replace(/^COMMIT;$/mg,''))
const evidence=async(s:Seed)=> (await q(`SELECT
 (SELECT jsonb_agg(to_jsonb(c)) FROM gridex_ack_authority.source_correlations c WHERE c.source_message_id=$1) AS correlations,
 (SELECT jsonb_agg(to_jsonb(o)) FROM gridex_ack_authority.scope_outcomes o WHERE o.source_message_id=$1) AS outcomes,
 (SELECT jsonb_agg(to_jsonb(r)) FROM gridex_ack_authority.applied_receipts r JOIN gridex_ack_authority.source_correlations c ON c.ack_message_id=r.ack_message_id WHERE c.source_message_id=$1) AS receipts,
 (SELECT jsonb_agg(to_jsonb(c)) FROM public.ediel_ack_chains c WHERE c.source_message_id=$1) AS chains`,[s.origin]))[0]

it.each(['sent','acknowledged'])('a qualified single-object confirmed dispatch keeps %s after whole negative ACK, then first activation succeeds',async originalStatus=>{
 const s=await seed(100);await q('UPDATE public.ediel_messages SET status=$2 WHERE id=$1',[s.origin,originalStatus])
 const a=await ack(s,110);const result=await apply(s,a)
 expect(result).toMatchObject({outcome:'negative',scope:'message',wholeSourceRejected:true,finalAckReached:false,sourceAccepted:false,failureReason:'APERAK negative whole-source acknowledgement'})
 expect(await state(s)).toMatchObject({original_status:originalStatus,aperak_status:'failed',sent_current:true,switch_status:'accepted',period_status:'confirmed_by_grid_owner',activation_count:0})
 const saved=await evidence(s)
 expect(saved.correlations).toEqual([expect.objectContaining({ack_message_id:a,source_message_id:s.origin,ack_outcome:'negative',ack_scope:'message'})])
 expect(saved.outcomes).toEqual([expect.objectContaining({outcome:'negative'})]);expect(saved.receipts).toEqual([expect.objectContaining({result:expect.objectContaining({wholeSourceRejected:true})})]);expect(saved.chains).toEqual([expect.objectContaining({outcome:'negative'})])
 expect(await activate(s)).toHaveLength(1);expect(await state(s)).toMatchObject({switch_status:'completed',period_status:'active',activation_count:1})
 expect(await evidence(s)).toEqual(saved)
})

it('negative ACK before the planned instant cannot activate or move it earlier',async()=>{
 const s=await seed(100,{before:true});const before=(await q('SELECT market_start_at FROM public.customer_supply_periods WHERE id=$1',[s.p]))[0]
 await apply(s,await ack(s,110));await expect(activate(s)).rejects.toThrow('normal_supply_activation_not_due')
 expect(await state(s)).toMatchObject({activation_count:0,period_status:'confirmed_by_grid_owner'})
 expect((await q('SELECT market_start_at FROM public.customer_supply_periods WHERE id=$1',[s.p]))[0]).toEqual(before)
})
it('established activation replays once after late negative and does not physically deactivate supply',async()=>{
 const s=await seed(100);const first=await activate(s);await apply(s,await ack(s,110))
 expect(await activate(s)).toEqual(first);expect(await state(s)).toMatchObject({switch_status:'completed',period_status:'active',activation_count:1})
})
it('negative ACK receipt replays exactly and opposite positive ACK stays an immutable conflict',async()=>{
 const s=await seed(100),a=await ack(s,110);const first=await apply(s,a),saved=await evidence(s)
 expect(await apply(s,a)).toEqual({...first,idempotent:true});expect(await evidence(s)).toEqual(saved)
 await expect(apply(s,await ack(s,111,{positive:true}))).rejects.toThrow('ack_immutable_scope_outcome_conflict')
 expect(await evidence(s)).toEqual(saved)
})
it('positive application ACK behavior stays unchanged',async()=>{
 const s=await seed(100),result=await apply(s,await ack(s,110,{positive:true}))
 expect(result).toMatchObject({outcome:'positive',wholeSourceRejected:false,sourceAccepted:true,finalAckReached:true})
 expect(await state(s)).toMatchObject({original_status:'acknowledged',aperak_status:'received',sent_current:true})
})

const invalidWitnesses:[string,string][]=[
 ['missing confirmation','DELETE FROM gridex_received_sources.normal_switch_confirmations'],
 ['missing captured Z04',"DELETE FROM gridex_received_sources.sources WHERE message_code='Z04'"],
 ['missing transition','DELETE FROM gridex_received_sources.supply_source_transitions'],
 ['wrong confirmation company',`UPDATE gridex_received_sources.normal_switch_confirmations SET company_id='${id(999)}'`],
 ['wrong original UUID',`UPDATE gridex_received_sources.normal_switch_confirmations SET original_message_id='${id(999)}'`],
 ['wrong original hash',"UPDATE gridex_received_sources.normal_switch_confirmations SET original_payload_hash=repeat('0',64)"],
 ['wrong Z04 company',`UPDATE public.ediel_messages SET company_id='${id(999)}' WHERE message_code='Z04'`],
 ['wrong Z04 environment',"UPDATE public.ediel_messages SET environment='production' WHERE message_code='Z04'"],
 ['wrong Z04 direction',"UPDATE public.ediel_messages SET direction='outbound' WHERE message_code='Z04'"],
 ['wrong Z04 family',"UPDATE public.ediel_messages SET message_family='UTILTS' WHERE message_code='Z04'"],
 ['wrong Z04 code',"UPDATE public.ediel_messages SET message_code='Z05' WHERE message_code='Z04'"],
 ['wrong Z04 original hash',"UPDATE public.ediel_messages SET immutable_payload_hash=repeat('0',64) WHERE message_code='Z04'"],
 ['wrong captured company',`UPDATE gridex_received_sources.sources SET company_id='${id(999)}' WHERE message_code='Z04'`],
 ['wrong captured environment',"UPDATE gridex_received_sources.sources SET environment='production' WHERE message_code='Z04'"],
 ['missing captured context',"UPDATE gridex_received_sources.sources SET received_context=NULL WHERE message_code='Z04'"],
 ['wrong transition code',"UPDATE gridex_received_sources.supply_source_transitions SET source_code='Z05'"],
 ['wrong transition hash',"UPDATE gridex_received_sources.supply_source_transitions SET payload_hash=repeat('0',64)"],
 ['wrong qualified switch',`UPDATE gridex_received_sources.supply_source_transitions SET qualified_switch_ids=ARRAY['${id(999)}'::uuid]`],
 ['wrong transitioned object',"UPDATE gridex_received_sources.supply_source_transitions SET source_objects='[]'"],
 ['wrong transitioned period',"UPDATE gridex_received_sources.supply_source_transitions SET resulting_states='[]'"],
 ['wrong confirmed period id',`UPDATE gridex_received_sources.normal_switch_confirmations SET confirmed_period=jsonb_set(confirmed_period,'{id}','"${id(999)}"')`],
 ['wrong confirmed period company',`UPDATE gridex_received_sources.normal_switch_confirmations SET confirmed_period=jsonb_set(confirmed_period,'{company_id}','"${id(999)}"')`],
 ['wrong confirmed switch',`UPDATE gridex_received_sources.normal_switch_confirmations SET confirmed_switch=jsonb_set(confirmed_switch,'{id}','"${id(999)}"')`],
 ['wrong confirmed inbound reference',`UPDATE gridex_received_sources.normal_switch_confirmations SET confirmed_switch=jsonb_set(confirmed_switch,'{inbound_z04_message_id}','"${id(999)}"')`],
 ['wrong confirmed outbound reference',`UPDATE gridex_received_sources.normal_switch_confirmations SET confirmed_switch=jsonb_set(confirmed_switch,'{outbound_z03_message_id}','"${id(999)}"')`],
 ['wrong confirmed customer',`UPDATE gridex_received_sources.normal_switch_confirmations SET confirmed_switch=jsonb_set(confirmed_switch,'{customer_id}','"${id(999)}"')`],
 ['wrong confirmed point',`UPDATE gridex_received_sources.normal_switch_confirmations SET confirmed_switch=jsonb_set(confirmed_switch,'{metering_point_id}','"${id(999)}"')`],
 ['wrong confirmed contract',`UPDATE gridex_received_sources.normal_switch_confirmations SET confirmed_switch=jsonb_set(confirmed_switch,'{contract_id}','"${id(999)}"')`],
 ['unconfirmed immutable switch',"UPDATE gridex_received_sources.normal_switch_confirmations SET confirmed_switch=jsonb_set(confirmed_switch,'{status}','\"sent\"')"],
 ['unsupported original code',"UPDATE public.ediel_messages SET message_code='Z09' WHERE direction='outbound'"],
 ['already failed original',"UPDATE public.ediel_messages SET status='failed' WHERE direction='outbound'"],
]
it.each(invalidWitnesses)('does not preserve dispatch with %s',async(_name,change)=>{
 const s=await seed(100);await db.exec(change);const result=await apply(s,await ack(s,110))
 expect(result).toMatchObject({wholeSourceRejected:true,outcome:'negative'});expect(await state(s)).toMatchObject({original_status:'failed',aperak_status:'failed',sent_current:false,activation_count:0})
})
it('a real no-business-confirmation fixture stays failed with zero switch, period, and activation rows',async()=>{
 const original:Original={origin:id(100),document:'unconfirmed-original'},raw=JSON.stringify({family:'PRODAT',environment:'test',document:original.document})
 await q(`INSERT INTO public.ediel_messages(id,company_id,direction,message_family,message_code,status,raw_payload,immutable_payload_hash,immutable_rendered_at,message_sent_at,requires_contrl,requires_aperak,contrl_status,aperak_status,utilts_err_status) VALUES($1,$2,'outbound','PRODAT','Z03','sent',$3,encode(sha256(convert_to($3,'UTF8')),'hex'),now(),now(),false,true,'not_required','pending','not_required')`,[original.origin,C,raw])
 await apply(original,await ack(original,110))
 expect((await q('SELECT status FROM public.ediel_messages WHERE id=$1',[original.origin]))[0].status).toBe('failed')
 for(const table of ['public.supplier_switch_requests','public.customer_supply_periods','gridex_received_sources.normal_switch_confirmations','gridex_received_sources.normal_supply_activations'])expect((await q('SELECT count(*)::int AS n FROM '+table))[0].n).toBe(0)
})
async function replaceOriginal(s:Seed,change:(wire:Row)=>Row){const wire=JSON.parse((await q('SELECT raw_payload FROM public.ediel_messages WHERE id=$1',[s.origin]))[0].raw_payload as string);const raw=JSON.stringify(change(wire));await q("UPDATE public.ediel_messages SET raw_payload=$2,immutable_payload_hash=encode(sha256(convert_to($2,'UTF8')),'hex') WHERE id=$1",[s.origin,raw]);await q("UPDATE gridex_received_sources.normal_switch_confirmations SET original_payload_hash=encode(sha256(convert_to($2,'UTF8')),'hex') WHERE original_message_id=$1",[s.origin,raw])}
it.each(['partial multi-object','duplicate LI'])('a %s original never lends preserved dispatch to another object',async mode=>{
 const s=await seed(100)
 await replaceOriginal(s,wire=>{const own=(wire.objects as Row[])[0];return {...wire,objects:[own,{...own,line:'2',li:mode==='duplicate LI'?own.li:'UNCONFIRMED-SIBLING',point:'other-point'}]}})
 await apply(s,await ack(s,110));expect(await state(s)).toMatchObject({original_status:'failed',sent_current:false,activation_count:0})
})
it('nullable original point keeps the existing matching semantics without an invented agency restriction',async()=>{
 const s=await seed(100);await replaceOriginal(s,wire=>({...wire,objects:[{...(wire.objects as Row[])[0],point:null,identityAgency:null}]}))
 await apply(s,await ack(s,110));expect(await state(s)).toMatchObject({original_status:'sent',sent_current:true})
})
it.each(['li','customerIdentity','start','reason','point','identityAgency'])('a mismatched original %s cannot borrow a confirmation',async field=>{
 const s=await seed(100);await replaceOriginal(s,wire=>({...wire,objects:[{...(wire.objects as Row[])[0],[field]:'mismatched'}]}))
 await apply(s,await ack(s,110));expect(await state(s)).toMatchObject({original_status:'failed',sent_current:false})
})
it('invalid original bytes/hash are still refused before the ACK effect',async()=>{
 const s=await seed(100);await q("UPDATE public.ediel_messages SET immutable_payload_hash=repeat('0',64) WHERE id=$1",[s.origin])
 await expect(apply(s,await ack(s,110))).rejects.toThrow('ack_sealed_sent_original_required')
 expect(await state(s)).toMatchObject({original_status:'sent',sent_current:false,activation_count:0})
})
it('migration reapplication preserves function identity, ACL/security/config and all downstream reader bytes',async()=>{
 const before=await leafCatalog(),body=await leafBody(),downstream=await readers();expect(before).toEqual(initialCatalog);expect(downstream).toEqual(initialReaders);await reapply()
 expect(await leafCatalog()).toEqual(before);expect(await leafBody()).toBe(body);expect(await readers()).toEqual(downstream)
})
it('an unexpected installed body refuses the forward with no partial replacement',async()=>{
 const old=await leafBody(),definition=(await q('SELECT pg_get_functiondef(to_regprocedure($1)) AS d',[signature]))[0].d as string
 await db.exec(definition.replace(old,old+'\n-- unexpected installed body\n'))
 const altered=await leafBody();await db.exec('SAVEPOINT bad_preimage')
 await expect(reapply()).rejects.toThrow('sc037_confirmed_dispatch_unexpected_preimage')
 await db.exec('ROLLBACK TO SAVEPOINT bad_preimage; RELEASE SAVEPOINT bad_preimage');expect(await leafBody()).toBe(altered)
})

it.each(['two','missing','string'])('actual original cardinality, not caller registerCount %s, controls dispatch qualification',async mode=>{
 const s=await seed(100);await replaceOriginal(s,wire=>{const own={...(wire.objects as Row[])[0]};if(mode==='missing')delete own.registerCount;else own.registerCount=mode==='two'?2:'1';return {...wire,objects:[own],physicalLines:mode==='two'?2:1}})
 await apply(s,await ack(s,110));expect(await state(s)).toMatchObject({original_status:mode==='two'?'failed':'sent',sent_current:mode!=='two'})
})
it('an extra physical LIN cannot borrow a one-object projection',async()=>{
 const s=await seed(100);await replaceOriginal(s,wire=>({...wire,physicalLines:2}));await apply(s,await ack(s,110));expect(await state(s)).toMatchObject({original_status:'failed',sent_current:false})
})

it('confirmed incoming Z04 may retain multiple registers while the original Z03 has exactly one LIN',async()=>{
 const s=await seed(100),old=(await q('SELECT raw_payload FROM public.ediel_messages WHERE id=$1',[s.z04]))[0].raw_payload as string
 const wire=JSON.parse(old);wire.objects[0].registerCount=2;const raw=JSON.stringify(wire)
 await q("UPDATE public.ediel_messages SET raw_payload=$2,immutable_payload_hash=encode(sha256(convert_to($2,'UTF8')),'hex') WHERE id=$1",[s.z04,raw])
 await q("UPDATE gridex_received_sources.sources SET raw_payload=$2,payload_hash=encode(sha256(convert_to($2,'UTF8')),'hex') WHERE source_message_id=$1",[s.z04,raw])
 await q("UPDATE gridex_received_sources.normal_switch_confirmations SET source_object=jsonb_set(source_object,'{registerCount}','2') WHERE source_message_id=$1",[s.z04])
 await q("UPDATE gridex_received_sources.supply_source_transitions SET payload_hash=encode(sha256(convert_to($2,'UTF8')),'hex'),source_objects=$3::jsonb WHERE source_message_id=$1",[s.z04,raw,JSON.stringify(wire.objects)])
 await apply(s,await ack(s,110));expect(await state(s)).toMatchObject({original_status:'sent',sent_current:true})
})
function fragments(){const migration=readFileSync(forward,'utf8'),old=/\$old\$([\s\S]*?)\$old\$/.exec(migration)?.[1],next=/\$new\$([\s\S]*?)\$new\$/.exec(migration)?.[1];if(!old||!next)throw Error('SETUP_GAP: checked forward fragments unavailable');return {old,next}}
it('the installed forward has an exact one-fragment inverse to the frozen full predecessor',async()=>{
 const {old,next}=fragments(),body=await leafBody();expect(body.split(next)).toHaveLength(2)
 const inverse=body.replace(next,old);expect(createHash('sha256').update(inverse).digest('hex')).toBe('411317aec4133e8b580331c5202264c29de10fe31bc0330e7236d99a03c9e692')
 expect((await leafCatalog())).toEqual(initialCatalog);expect(await readers()).toEqual(initialReaders)
})
it('a tampered proposed replacement is refused before changing the installed predecessor',async()=>{
 const {old,next}=fragments(),body=await leafBody(),predecessor=body.replace(next,old),definition=(await q('SELECT pg_get_functiondef(to_regprocedure($1)) AS d',[signature]))[0].d as string
 await db.exec(definition.replace(body,predecessor));await db.exec('SAVEPOINT tampered_replacement')
 const tampered=readFileSync(forward,'utf8').replace("THEN source.status WHEN whole_negative", "THEN 'failed' WHEN whole_negative").replace(/^BEGIN;$/mg,'').replace(/^COMMIT;$/mg,'')
 await expect(db.exec(tampered)).rejects.toThrow('sc037_confirmed_dispatch_inverse_mismatch')
 await db.exec('ROLLBACK TO SAVEPOINT tampered_replacement; RELEASE SAVEPOINT tampered_replacement');expect(await leafBody()).toBe(predecessor)
})

it.each(['repeated LIN','different sibling LI','extra physical LIN'])('a NULL-point original with %s never borrows single-LIN qualification',async mode=>{
 const s=await seed(100);await replaceOriginal(s,wire=>{const own={...(wire.objects as Row[])[0],point:null,identityAgency:null};return {...wire,objects:mode==='different sibling LI'?[own,{...own,line:'2',li:'OTHER-LI'}]:[own],physicalLines:2}})
 await apply(s,await ack(s,110));expect(await state(s)).toMatchObject({original_status:'failed',sent_current:false,activation_count:0})
})

it.each([
 ['blocked lifecycle',"UPDATE public.supplier_switch_requests SET lifecycle_blocked=true",'normal_supply_activation_current_confirmation_changed'],
 ['cancelled current switch',"UPDATE public.supplier_switch_requests SET status='cancelled_before_start'",'normal_supply_activation_current_confirmation_changed'],
 ['cancelled current period',"UPDATE public.customer_supply_periods SET status='cancelled'",'normal_supply_activation_current_confirmation_changed'],
 ['changed current period version',"UPDATE public.customer_supply_periods SET market_state_version=market_state_version+1",'normal_supply_activation_current_confirmation_changed'],
 ['changed current contract hash',"UPDATE public.customer_contracts SET signed_version='changed-signed-version'",'normal_supply_activation_current_confirmation_changed'],
 ['unsigned current contract',"UPDATE public.customer_contracts SET status='draft'",'normal_supply_activation_current_confirmation_changed'],
 ['revoked user',"UPDATE public.user_profiles SET user_status='inactive'",'normal_supply_activation_actor_forbidden'],
 ['revoked membership',"UPDATE public.company_memberships SET is_active=false",'normal_supply_activation_actor_forbidden'],
 ['expired current legal role',"UPDATE public.tenant_actor_roles SET valid_to=now()-interval '1 hour'",'normal_supply_activation_current_legal_actor_required'],
])('preserved dispatch does not authorize first activation after %s',async(_name,change,error)=>{
 const s=await seed(100);await apply(s,await ack(s,110));expect(await state(s)).toMatchObject({original_status:'sent',sent_current:true})
 await db.exec(change);await expect(activate(s)).rejects.toThrow(error);expect(await state(s)).toMatchObject({activation_count:0,original_status:'sent'})
})
it('late whole-negative CONTRL retains qualified dispatch and still records unchanged protocol negatives',async()=>{
 const s=await seed(100);await q("UPDATE public.ediel_messages SET requires_contrl=true,contrl_status='pending' WHERE id=$1",[s.origin]);const a=await ack(s,110,{family:'CONTRL'}),result=await apply(s,a)
 expect(result).toMatchObject({outcome:'negative',scope:'interchange',wholeSourceRejected:true,sourceAccepted:false,finalAckReached:false,failureReason:'CONTRL negative whole-source acknowledgement'})
 expect((await q('SELECT status,contrl_status,aperak_status,failure_reason FROM public.ediel_messages WHERE id=$1',[s.origin]))[0]).toEqual({status:'sent',contrl_status:'failed',aperak_status:'pending',failure_reason:'CONTRL negative whole-source acknowledgement'})
 expect((await evidence(s)).correlations).toEqual([expect.objectContaining({ack_family:'CONTRL',ack_scope:'interchange',ack_outcome:'negative'})]);expect(await activate(s)).toHaveLength(1)
})
