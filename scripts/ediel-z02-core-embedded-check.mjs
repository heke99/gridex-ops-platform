/** Targeted synthetic SQL execution probes. This is NOT native/replay/RLS or
 * authentic counterpart/source acceptance evidence. Supply an installed PGlite
 * module URL explicitly; never connect this script to a production database. */
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const moduleUrl=process.env.PGLITE_MODULE_URL
if(!moduleUrl)throw Error('PGLITE_MODULE_URL required for isolated synthetic probes')
const {PGlite}=await import(moduleUrl)
const db=new PGlite()
const fixture=readFileSync(new URL('./fixtures/ediel-z02-core-embedded-schema.sql',import.meta.url),'utf8')
await db.exec(fixture)
const decoder=readFileSync(process.env.EDIEL_DECODER_MIGRATION_PATH ?? new URL('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',import.meta.url),'utf8')
await db.exec(decoder.slice(0,decoder.indexOf('CREATE FUNCTION gridex_received_sources.permission_wire_v1'))+'\nCOMMIT;')
await db.exec(readFileSync(new URL('../supabase/migrations/20260930154552_ediel_z02_source_owned_core.sql',import.meta.url),'utf8'))
await db.exec(readFileSync(new URL('../supabase/migrations/20260930164947_ediel_z02_original_dispatch_proof.sql',import.meta.url),'utf8'))
// Explicit declared synthetic authority ports. Actual new wrapper, unchanged
// core, source-rule receipt reader and application-facet reader run below; this
// does not authenticate a legal/registry source or execute the full native graph.
await db.exec(`CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
CREATE TABLE public.user_profiles(id uuid,user_status text);
CREATE TABLE public.synthetic_permissions(actor uuid,company_id uuid,allowed boolean,allowed_read boolean DEFAULT true);
CREATE FUNCTION public.gridex_actor_has_company_permission(actor uuid,c uuid,permission text) RETURNS boolean LANGUAGE sql AS $$SELECT coalesce((SELECT CASE WHEN $3 IN('communication.read','metering.read') THEN allowed_read ELSE allowed END FROM public.synthetic_permissions WHERE actor=$1 AND company_id=$2),false)$$;
CREATE SCHEMA gridex_ediel_inbound_context;CREATE TABLE gridex_ediel_inbound_context.synthetic_receipts(source_id uuid,company_id uuid,payload_hash text);
CREATE FUNCTION gridex_ediel_inbound_context.require_v1(c uuid,m uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM gridex_ediel_inbound_context.synthetic_receipts r JOIN public.ediel_messages s ON s.id=r.source_id AND s.company_id=r.company_id WHERE s.id=m AND s.company_id=c AND r.payload_hash=encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex')) THEN RAISE EXCEPTION 'ediel_inbound_legal_context_required';END IF;RETURN jsonb_build_object('syntheticUnqualified',true);END$$;
CREATE SCHEMA gridex_ediel_source_rules;CREATE TABLE gridex_ediel_source_rules.receipts(source_message_id uuid,company_id uuid,environment text,direction text,payload_sha256 text,evidence jsonb);
ALTER TABLE gridex_received_sources.validation_assessments ADD COLUMN owner text,ADD COLUMN facts_hash text;
CREATE TABLE gridex_received_sources.prodat_application_facets(assessment_id uuid,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,application_facts_text text,application_facts_hash text);
CREATE TABLE gridex_received_sources.prodat_response_facets(assessment_id uuid,response_facts_text text);
CREATE FUNCTION gridex_received_sources.validate_prodat_application_v1(raw text,facts jsonb,application jsonb,response jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT raw IS NOT NULL AND application->>'owner'='canonical-prodat-application-all-v1' AND response->>'syntheticUnqualified'='true'$$;`)
const sourceSql=readFileSync(new URL('../supabase/migrations/20260930180104_ediel_immutable_source_rule_pack_basis.sql',import.meta.url),'utf8')
await db.exec(sourceSql.match(/CREATE FUNCTION gridex_ediel_source_rules\.require_v1[\s\S]*?\$\$;/)[0])
const applicationSql=readFileSync(new URL('../supabase/migrations/20261001010321_ediel_complete_prodat_own_application_facets.sql',import.meta.url),'utf8')
for(const name of ['require_prodat_application_objects_v1','prodat_application_object_accepted_v1'])await db.exec(applicationSql.match(new RegExp('CREATE FUNCTION gridex_received_sources\\.'+name+'[\\s\\S]*?\\$\\$;'))[0])
await db.exec(readFileSync(new URL('../supabase/migrations/20261001022917_ediel_z02_native_actor_and_source_authority.sql',import.meta.url),'utf8'))
const ids={actor:'00000000-0000-4000-8000-000000000011',company:'00000000-0000-4000-8000-000000000001',customer:'00000000-0000-4000-8000-000000000002',site:'00000000-0000-4000-8000-000000000003',request:'00000000-0000-4000-8000-000000000004',incoming:'00000000-0000-4000-8000-000000000005',outgoing:'00000000-0000-4000-8000-000000000006',operation:'00000000-0000-4000-8000-000000000007',point:'00000000-0000-4000-8000-000000000008',assessment:'00000000-0000-4000-8000-000000000009'}
const raw=(code,extra=false)=>{const send=code==='Z01'?'12345':'54321',receive=code==='Z01'?'54321':'12345';const segments=[`UNH+M+PRODAT:D:97A:UN:E2SE6A`,`BGM+${code}+DOC+9`,`NAD+FR+${send}:160:SVK`,`NAD+DO+${receive}:160:SVK`,`LIN+1++735123456789012345:::9`,`CCI++Z13`,`CAV+Z22`,`RFF+LI:CASE?+REF`,`RFF+Z05:NET`,`NAD+UD+199001011234:SE2:260++Dated Person`,`NAD+IT+735123456789012345:::9+++Street+City++12345+SE`,...(extra?[`QTY+147:777:KWH`]:[])];return `UNB+UNOC:3+${send}:14+${receive}:14+261001:1200+I+23-DDQ-PRODAT'${segments.join("'")}'UNT+${segments.length+1}+M'UNZ+1+I'`}
const outgoing=raw('Z01'),incoming=raw('Z02',true)
const query=(sql,params=[])=>db.query(sql,params)
const decoded=(await query('SELECT gridex_received_sources.z02_core_wire_v1($1) AS wire',[incoming])).rows[0].wire
assert.equal(decoded.objects[0].lineReference,'CASE+REF')
assert.equal(decoded.objects[0].gridArea,'NET')
assert.equal(Object.hasOwn(decoded.objects[0],'annualConsumption'),false)
const multi=incoming.replace("UNT+","LIN+2++735123456789012346:::9'CCI++Z13'CAV+Z22'RFF+LI:OTHER'RFF+Z05:OTHER-NET'NAD+UD+198001011234:SE2:260++Other Person'UNT+")
const multiWire=(await query('SELECT gridex_received_sources.z02_core_wire_v1($1) AS wire',[multi])).rows[0].wire
assert.equal(multiWire.objects.length,2)
assert.equal(multiWire.objects[0].gridArea,'NET')
assert.equal(multiWire.objects[1].gridArea,'OTHER-NET')
assert.equal(multiWire.objects[1].lineReference,'OTHER')
assert.equal((await query('SELECT gridex_received_sources.z02_core_wire_v1($1) AS wire',[incoming+'BROKEN?'])).rows[0].wire,null)
await query('INSERT INTO public.customers(id,company_id,personal_number) VALUES($1,$2,$3)',[ids.customer,ids.company,'199001011234'])
await query("INSERT INTO public.customer_sites(id,company_id,customer_id,facility_id,normalized_facility_id,street,city,postal_code,address_hash,annual_consumption_kwh) VALUES($1,$2,$3,'735123456789012345','735123456789012345','Street','City','12345','address',9000)",[ids.site,ids.company,ids.customer])
await query("INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,estimated_annual_consumption_kwh) VALUES($1,$2,$3,$4,$4,'735123456789012345','735123456789012345',8500)",[ids.point,ids.company,ids.customer,ids.site])
await query("INSERT INTO public.customer_info_requests(id,company_id,customer_id,site_id,ediel_message_id,operation_id,metering_point_id) VALUES($1,$2,$3,$4,$5,$6,$7)",[ids.request,ids.company,ids.customer,ids.site,ids.outgoing,ids.operation,ids.point])
for(const [id,code,wire,direction] of [[ids.outgoing,'Z01',outgoing,'outbound'],[ids.incoming,'Z02',incoming,'inbound']])await query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,customer_id,site_id,raw_payload,immutable_payload_hash,immutable_rendered_at,message_sent_at,parsed_payload) VALUES($1,$2,'test',$3,'edifact','PRODAT',$4,$5,$6,$7,encode(sha256(convert_to($7,'UTF8')),'hex'),now(),'2026-10-01T10:00:00Z',$8)",[id,ids.company,direction,code,ids.customer,ids.site,wire,{meteringPointId:'ATTACKER',gridAreaId:'EVIL',priceAreaCode:'SE4',annualConsumptionKwh:123456}])
await query("INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,message_code,source_received_at,raw_payload,payload_hash) VALUES($1,$2,'test','Z02','2026-10-01T11:00:00Z',$3,encode(sha256(convert_to($3,'UTF8')),'hex'))",[ids.incoming,ids.company,incoming])
const facts={rulePackEvidence:{profileKey:'synthetic',messageProfileId:'synthetic-profile',rulePackId:'synthetic-pack',sourceHash:'synthetic-source',version:'synthetic-revision',snapshot:{rulePack:{syntheticUnqualified:true},messageProfile:{syntheticUnqualified:true},guideSources:[{syntheticUnqualified:true}]}},syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',registerValidation:{objects:[{messageIndex:0,messageReference:'M',objectId:'735123456789012345',identityAgency:'9',disposition:'accepted',registers:[{lineIndex:0,lineNumber:'1',segmentIndex:decoded.objects[0].segmentIndex}]}]}}
await query("INSERT INTO gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text) SELECT $1,source_message_id,company_id,environment,payload_hash,$2 FROM gridex_received_sources.sources WHERE source_message_id=$3",[ids.assessment,JSON.stringify(facts),ids.incoming])
await query("INSERT INTO public.ediel_business_references(company_id,source_message_id,message_family,message_code,reference_type,reference_value) VALUES($1,$2,'PRODAT','Z01','RFF_LI','CASE+REF')",[ids.company,ids.outgoing])
await query("INSERT INTO public.customer_operation_request_snapshots(company_id,operation_id,customer_id,customer_site_id,request_kind,request_reference,site_address_hash) VALUES($1,$2,$3,$4,'customer_data_request',$5,'address')",[ids.company,ids.operation,ids.customer,ids.site,ids.request])
await query("INSERT INTO public.platform_grid_areas(grid_area_code,price_area,is_active) VALUES('NET','SE3',true)")
await query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())",[ids.company,ids.actor]);await query("INSERT INTO public.user_profiles VALUES($1,'active')",[ids.actor]);await query('INSERT INTO public.synthetic_permissions(actor,company_id,allowed) VALUES($1,$2,true)',[ids.actor,ids.company])
await db.exec('RESET ROLE;');await query("UPDATE gridex_received_sources.validation_assessments SET owner='canonical-runtime-with-registry-v1',facts_hash=encode(sha256(convert_to(facts_text,'UTF8')),'hex')")
const application={version:1,owner:'canonical-prodat-application-all-v1',coverage:'canonical_own_application_only',headerDecision:'accepted',sourcePayloadHash:(await query('SELECT payload_hash FROM gridex_received_sources.sources')).rows[0].payload_hash,objects:facts.registerValidation.objects.map(({disposition,...object})=>({...object,applicationDecision:'accepted',reasonCodes:[]}))}
const applicationText=JSON.stringify(application)
await query('INSERT INTO gridex_received_sources.prodat_application_facets SELECT id,source_message_id,company_id,environment,source_payload_hash,$1,encode(sha256(convert_to($1,\'UTF8\')),\'hex\') FROM gridex_received_sources.validation_assessments',[applicationText])
await query("INSERT INTO gridex_received_sources.prodat_response_facets VALUES($1,'{\"syntheticUnqualified\":true}')",[ids.assessment])
await db.exec('SET ROLE service_role;')
const call=async(company=ids.company,actor=ids.actor)=>{await db.exec('SET ROLE service_role;');try{return(await query('SELECT public.gridex_apply_exact_z02_core($1,$2,$3,$4,$5,$6,$7) AS result',[company,ids.customer,ids.site,ids.request,ids.incoming,ids.operation,actor])).rows[0].result}finally{await db.exec('RESET ROLE;')}}
await assert.rejects(()=>call(ids.company,null),/z02_execution_actor_required/)
await assert.rejects(()=>call(),/ediel_inbound_legal_context_required/)
await db.exec('RESET ROLE;');await query('INSERT INTO gridex_ediel_inbound_context.synthetic_receipts SELECT source_message_id,company_id,payload_hash FROM gridex_received_sources.sources');await db.exec('SET ROLE service_role;')
await assert.rejects(()=>call(),/ediel_historical_rule_pack_basis_unavailable/)
await db.exec('RESET ROLE;');await query('INSERT INTO gridex_ediel_source_rules.receipts SELECT source_message_id,company_id,environment,\'inbound\',payload_hash,$1 FROM gridex_received_sources.sources',[JSON.stringify({...facts.rulePackEvidence,sourceHash:'WRONG'})]);await db.exec('SET ROLE service_role;')
await assert.rejects(()=>call(),/prodat_application_original_rule_witness_mismatch/)
await db.exec('RESET ROLE;');const basis={...facts.rulePackEvidence,snapshot:{...facts.rulePackEvidence.snapshot}};await query('UPDATE gridex_ediel_source_rules.receipts SET evidence=$1',[JSON.stringify(basis)]);await db.exec('SET ROLE service_role;')

const putApplication=async value=>{await db.exec('RESET ROLE;');const text=JSON.stringify(value);await query("UPDATE gridex_received_sources.prodat_application_facets SET application_facts_text=$1,application_facts_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",[text])}
await putApplication({...application,headerDecision:'rejected'});assert.equal((await call()).code,'z02_own_application_scope_unavailable')
await putApplication({...application,objects:application.objects.map(obj=>({...obj,applicationDecision:'held'}))});assert.equal((await call()).code,'z02_own_application_scope_unavailable')
await putApplication(application)
assert.equal((await query('SELECT count(*)::int AS n FROM gridex_received_sources.z02_core_applications')).rows[0].n,0)
await db.exec('RESET ROLE;');await query('UPDATE public.customer_info_requests SET metering_point_id=NULL WHERE id=$1',[ids.request]);await db.exec('SET ROLE service_role;')
assert.equal((await call()).code,'z02_originating_dispatch_proof_required')
assert.equal((await query('SELECT grid_area_code AS grid FROM public.customer_sites WHERE id=$1',[ids.site])).rows[0].grid,null)
await db.exec('RESET ROLE;');await query("INSERT INTO gridex_ediel_transport.attempts(id,message_id,company_id,environment,binding,classification,entered_at,observed_at) VALUES($1,$2,$3,'test',jsonb_build_object('originalHash',encode(sha256(convert_to($4,'UTF8')),'hex')),'accepted','2026-10-01T10:00:00Z','2026-10-01T10:00:01Z')",['00000000-0000-4000-8000-000000000010',ids.outgoing,ids.company,outgoing]);await db.exec('SET ROLE service_role;')
const result=await call();assert.equal(result.ok,true);assert.equal(result.gridAreaCode,'NET');assert.equal(result.priceAreaCode,'SE3');assert.equal(result.meteringPointExternalId,'735123456789012345')
assert.equal((await query('SELECT annual_consumption_kwh AS annual FROM public.customer_sites WHERE id=$1',[ids.site])).rows[0].annual,'9000')
assert.equal((await query('SELECT estimated_annual_consumption_kwh AS annual FROM public.metering_points WHERE id=$1',[ids.point])).rows[0].annual,'8500')
assert.equal((await query('SELECT count(*)::int AS count FROM gridex_received_sources.z02_core_applications')).rows[0].count,1)
await db.exec('RESET ROLE;');await query("UPDATE gridex_received_sources.validation_assessments SET facts_text=$1 WHERE id=$2",[JSON.stringify({...facts,applicationDecision:'rejected'}),ids.assessment])
await query("UPDATE public.user_profiles SET user_status='inactive'");await query('UPDATE public.synthetic_permissions SET allowed=false');await query('DELETE FROM gridex_ediel_inbound_context.synthetic_receipts');await query('DELETE FROM gridex_ediel_source_rules.receipts');await db.exec('SET ROLE service_role;');await assert.rejects(()=>call(ids.company,null),/z02_execution_actor_required/)
await assert.rejects(()=>call(ids.company,'00000000-0000-4000-8000-000000000099'),/z02_execution_actor_required/)
await assert.rejects(()=>call(),/z02_execution_actor_required/)
await query("UPDATE public.user_profiles SET user_status='active'");await query('UPDATE public.company_memberships SET accepted_at=NULL');await assert.rejects(()=>call(),/z02_execution_actor_required/)
await query('UPDATE public.company_memberships SET accepted_at=now()');await query('UPDATE public.synthetic_permissions SET allowed_read=false');await assert.rejects(()=>call(),/z02_history_actor_read_required/)
await query('UPDATE public.synthetic_permissions SET allowed_read=true');assert.deepEqual(await call(),result)
assert.equal((await call('00000000-0000-4000-8000-000000000099')).ok,false)
assert.equal((await query('SELECT count(*)::int AS count FROM public.metering_points')).rows[0].count,1)
assert.equal((await query("SELECT has_function_privilege('authenticated','public.gridex_apply_exact_z02_core(uuid,uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE') AS allowed")).rows[0].allowed,false)
await db.exec('RESET ROLE;');await assert.rejects(()=>query('UPDATE gridex_received_sources.z02_core_applications SET result=$1',[{}]),/received_source_evidence_is_append_only/)
await db.close()
console.log('PASS: isolated synthetic SQL probes; decoder/source whitelist, excluded annual zero effect, tenant scope, native actor/context/six-key/full-own application fences, current read authorization and immutable replay before fresh write/source denials, receipt immutability and RPC privileges. Native/replay/real canonical acceptance remain NOT RUN.')
