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
const ids={company:'00000000-0000-4000-8000-000000000001',customer:'00000000-0000-4000-8000-000000000002',site:'00000000-0000-4000-8000-000000000003',request:'00000000-0000-4000-8000-000000000004',incoming:'00000000-0000-4000-8000-000000000005',outgoing:'00000000-0000-4000-8000-000000000006',operation:'00000000-0000-4000-8000-000000000007',point:'00000000-0000-4000-8000-000000000008',assessment:'00000000-0000-4000-8000-000000000009'}
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
const facts={syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',registerValidation:{objects:[{messageIndex:0,messageReference:'M',objectId:'735123456789012345',identityAgency:'9',disposition:'accepted',registers:[{lineIndex:0,lineNumber:'1',segmentIndex:decoded.objects[0].segmentIndex}]}]}}
await query("INSERT INTO gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text) SELECT $1,source_message_id,company_id,environment,payload_hash,$2 FROM gridex_received_sources.sources WHERE source_message_id=$3",[ids.assessment,JSON.stringify(facts),ids.incoming])
await query("INSERT INTO public.ediel_business_references(company_id,source_message_id,message_family,message_code,reference_type,reference_value) VALUES($1,$2,'PRODAT','Z01','RFF_LI','CASE+REF')",[ids.company,ids.outgoing])
await query("INSERT INTO public.customer_operation_request_snapshots(company_id,operation_id,customer_id,customer_site_id,request_kind,request_reference,site_address_hash) VALUES($1,$2,$3,$4,'customer_data_request',$5,'address')",[ids.company,ids.operation,ids.customer,ids.site,ids.request])
await query("INSERT INTO public.platform_grid_areas(grid_area_code,price_area,is_active) VALUES('NET','SE3',true)")
const call=async(company=ids.company)=>(await query('SELECT public.gridex_apply_exact_z02_core($1,$2,$3,$4,$5,$6,NULL) AS result',[company,ids.customer,ids.site,ids.request,ids.incoming,ids.operation])).rows[0].result
await query('UPDATE public.customer_info_requests SET metering_point_id=NULL WHERE id=$1',[ids.request])
assert.equal((await call()).code,'z02_originating_dispatch_proof_required')
assert.equal((await query('SELECT grid_area_code AS grid FROM public.customer_sites WHERE id=$1',[ids.site])).rows[0].grid,null)
await query("INSERT INTO gridex_ediel_transport.attempts(id,message_id,company_id,environment,binding,classification,entered_at,observed_at) VALUES($1,$2,$3,'test',jsonb_build_object('originalHash',encode(sha256(convert_to($4,'UTF8')),'hex')),'accepted','2026-10-01T10:00:00Z','2026-10-01T10:00:01Z')",['00000000-0000-4000-8000-000000000010',ids.outgoing,ids.company,outgoing])
const result=await call();assert.equal(result.ok,true);assert.equal(result.gridAreaCode,'NET');assert.equal(result.priceAreaCode,'SE3');assert.equal(result.meteringPointExternalId,'735123456789012345')
assert.equal((await query('SELECT annual_consumption_kwh AS annual FROM public.customer_sites WHERE id=$1',[ids.site])).rows[0].annual,'9000')
assert.equal((await query('SELECT estimated_annual_consumption_kwh AS annual FROM public.metering_points WHERE id=$1',[ids.point])).rows[0].annual,'8500')
assert.equal((await query('SELECT count(*)::int AS count FROM gridex_received_sources.z02_core_applications')).rows[0].count,1)
await query("UPDATE gridex_received_sources.validation_assessments SET facts_text=$1 WHERE id=$2",[JSON.stringify({...facts,applicationDecision:'rejected'}),ids.assessment])
assert.deepEqual(await call(),result)
assert.equal((await call('00000000-0000-4000-8000-000000000099')).ok,false)
assert.equal((await query('SELECT count(*)::int AS count FROM public.metering_points')).rows[0].count,1)
assert.equal((await query("SELECT has_function_privilege('authenticated','public.gridex_apply_exact_z02_core(uuid,uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE') AS allowed")).rows[0].allowed,false)
await assert.rejects(()=>query('UPDATE gridex_received_sources.z02_core_applications SET result=$1',[{}]),/received_source_evidence_is_append_only/)
await db.close()
console.log('PASS: isolated synthetic SQL probes; decoder/source whitelist, excluded annual zero effect, tenant scope, sealed repeat outcome, receipt immutability and RPC privileges. Native/replay/real canonical acceptance remain NOT RUN.')
