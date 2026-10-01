/** Declared synthetic mechanical source/origin probe. Supply, authenticated
 * network and signed-agreement bytes below are fixtures, never legal evidence. */
import{readFileSync}from'node:fs';import assert from'node:assert/strict'
if(!process.env.PGLITE_MODULE_URL)throw Error('PGLITE_MODULE_URL required')
const{PGlite}=await import(process.env.PGLITE_MODULE_URL),db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const prior=readFileSync(new URL('./ediel-brp-change-sql-regression.mjs',import.meta.url),'utf8')
let schema=prior.slice(prior.indexOf('await db.exec(`')+15,prior.indexOf('`)\n const tokenizer'))
schema=schema.replace('CREATE SCHEMA gridex_utilts_binding;','CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ai_processing;')
await db.exec(schema)
await db.exec(`ALTER TABLE public.ediel_messages ADD COLUMN created_by uuid,ADD COLUMN site_id uuid,ADD COLUMN message_standard text DEFAULT 'edifact',ADD COLUMN execution_context_snapshot jsonb DEFAULT '{}';
ALTER TABLE public.outbound_requests ADD COLUMN site_id uuid,ADD COLUMN payload jsonb;
ALTER TABLE public.ediel_message_intents ADD COLUMN business_process text DEFAULT 'customer_masterdata',ADD COLUMN market text DEFAULT 'electricity',ADD COLUMN customer_site_id uuid,ADD COLUMN validation_result jsonb DEFAULT '{"ok":true}',ADD COLUMN blocking_reasons jsonb DEFAULT '[]';
CREATE TABLE public.customer_sites(id uuid PRIMARY KEY,company_id uuid,customer_id uuid);
ALTER TABLE public.metering_points ADD COLUMN site_id uuid,ADD COLUMN customer_site_id uuid,ADD COLUMN meter_point_id text;
CREATE TABLE public.customer_contracts(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,status text,signed_at timestamptz,signed_version text,document_sha256 text,site_id uuid,customer_site_id uuid);
CREATE FUNCTION gridex_received_sources.supply_period_source_at_v1(c uuid,p uuid,a timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT gridex_received_sources.supply_period_source_basis_v1(c,p,a,a+interval '1 microsecond')$$;
CREATE FUNCTION gridex_received_sources.production_contract_hash_v1(public.customer_contracts) RETURNS text LANGUAGE sql AS $$SELECT repeat('c',64)$$;
CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'source_immutable';END$$;
CREATE TABLE gridex_received_sources.structural_apply_receipts(source_message_id uuid,company_id uuid,environment text,payload_hash text,object_assessment_id uuid,canonical_assessment_id uuid,objects jsonb,applied_at timestamptz,source_received_at timestamptz);
CREATE TABLE gridex_received_sources.sources(source_message_id uuid,company_id uuid,environment text,payload_hash text,raw_payload text);
CREATE TABLE gridex_received_sources.object_assessments(id uuid,company_id uuid,source_message_id uuid,environment text,source_payload_hash text,canonical_assessment_id uuid,facts_text text,facts_hash text);
CREATE TABLE gridex_received_sources.prodat_ignored_field_facets(canonical_assessment_id uuid,company_id uuid,source_message_id uuid,environment text,source_payload_hash text,fields_hash text,fields_text text);
CREATE FUNCTION gridex_ai_processing.authorize_purpose_phase_v1(c uuid,actor uuid,phase text,env text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF actor IS NULL OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL) OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active') OR public.gridex_actor_has_company_permission(actor,c,CASE phase WHEN 'send' THEN 'communication.send' ELSE 'communication.write' END) IS NOT TRUE THEN RAISE EXCEPTION 'actor_forbidden';END IF;END$$;
CREATE FUNCTION gridex_ai_processing.network_registry_basis_v1(text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"status":"held","blocker":"authentic_network_registry_unqualified"}'::jsonb$$;
CREATE FUNCTION gridex_ai_processing.header_company_basis_v1(c uuid,env text,s text,n text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('legalActorId','${id(9)}','syntheticUnqualified',true)$$;`)
const lexer=readFileSync(new URL('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',import.meta.url),'utf8')
const bounded=lexer.match(/CREATE FUNCTION gridex_received_sources\.wire_tokens_bounded_v1[\s\S]*?END \$\$;/)[0]
const v2=lexer.match(/CREATE FUNCTION gridex_received_sources\.closure_wire_tokens_v2[\s\S]*?\$\$;/)[0]
await db.exec(bounded+'\n'+v2)
await db.exec(readFileSync(new URL('../supabase/migrations/20260930225504_ediel_customer_agreed_metering_method_origination.sql',import.meta.url),'utf8'))
// Fixture-owner dependencies below are declared mechanical ports, never authentic TGT originals.
await db.exec(`CREATE SCHEMA gridex_negative_fixtures;
CREATE TABLE gridex_negative_fixtures.synthetic_ports(witness uuid,company_id uuid,raw text,actor uuid,qualification jsonb);
CREATE TABLE gridex_negative_fixtures.positive_consumptions(message_id uuid,company_id uuid);
CREATE TABLE gridex_negative_fixtures.negative_prepared_consumptions(message_id uuid,company_id uuid);
CREATE FUNCTION gridex_negative_fixtures.prepared_positive_fixture_v1(c uuid,w uuid,r text,a uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT qualification FROM gridex_negative_fixtures.synthetic_ports WHERE witness=w AND company_id=c AND raw=r AND actor=a$$;
CREATE FUNCTION gridex_negative_fixtures.prepared_negative_fixture_v1(c uuid,w uuid,r text,a uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT gridex_negative_fixtures.prepared_positive_fixture_v1(c,w,r,a)$$;
CREATE FUNCTION gridex_negative_fixtures.require_positive_message_v1(c uuid,m uuid,code text) RETURNS jsonb LANGUAGE sql AS $$SELECT p.qualification FROM gridex_negative_fixtures.synthetic_ports p JOIN public.ediel_messages own ON own.company_id=p.company_id AND own.raw_payload=p.raw AND own.created_by=p.actor WHERE own.id=m AND own.company_id=c$$;
CREATE FUNCTION gridex_negative_fixtures.require_negative_message_v1(c uuid,m uuid,code text) RETURNS jsonb LANGUAGE sql AS $$SELECT gridex_negative_fixtures.require_positive_message_v1(c,m,code)$$;`)
await db.exec(readFileSync(new URL('../supabase/migrations/20260930232802_ediel_metering_method_complete_source_scope.sql',import.meta.url),'utf8'))
await db.exec(readFileSync(new URL('../supabase/migrations/20260930233300_ediel_signed_agreement_requested_method_source.sql',import.meta.url),'utf8'))
await db.exec(`INSERT INTO companies VALUES('${id(1)}'),('${id(2)}');INSERT INTO auth.users VALUES('${id(20)}');INSERT INTO user_profiles VALUES('${id(20)}','active');INSERT INTO company_memberships VALUES('${id(1)}','${id(20)}','active',true,now());INSERT INTO customers VALUES('${id(3)}','${id(1)}');INSERT INTO customer_supply_periods VALUES('${id(4)}','${id(1)}');INSERT INTO customer_sites VALUES('${id(31)}','${id(1)}','${id(3)}');INSERT INTO metering_points VALUES('${id(5)}','${id(1)}','${id(3)}','735123456789012345','54321','TES','${id(31)}',NULL,NULL);INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code) VALUES('${id(6)}','${id(1)}','test','inbound','PRODAT','Z04');
INSERT INTO customer_contracts VALUES('${id(30)}','${id(1)}','${id(3)}','${id(5)}','signed',now(),'SYNTHETIC-REVISION',encode(sha256(convert_to('SYNTHETIC AGREEMENT','UTF8')),'hex'),'${id(31)}',NULL);`)
const source=()=>db.query('SELECT public.ediel_metering_method_change_source_v1($1,$2,$3) result',[id(1),id(10),id(20)])
assert.equal((await source()).rows[0].result.status,'held')
const supply={qualified:true,siteId:id(31),customerId:id(3),meteringPointId:id(5),legalActorId:id(9),sourceMessageId:id(6),marketStateVersion:1,dsoEdielId:'54321',sourceObjects:[{point:'735123456789012345',identityAgency:'9',gridArea:'TES'}]}
await db.query('INSERT INTO gridex_received_sources.supply_fixture VALUES($1)',[supply])
const declarationInsert=(which,previous=null)=>db.query(`INSERT INTO gridex_metering_method_changes.contract_request_declarations(id,previous_declaration_id,company_id,environment,contract_id,contract_revision,protected_contract_hash,customer_id,site_id,metering_point_id,legal_actor_id,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,requested_method,agreement_original,agreement_sha256,source_reference,source_version,source_original,source_sha256,approved_by,approved_at) VALUES($1,$2,'${id(1)}','test','${id(30)}','SYNTHETIC-REVISION',repeat('c',64),'${id(3)}','${id(31)}','${id(5)}','${id(9)}','12345','54321','735123456789012345','9','TES','Z04',convert_to('SYNTHETIC AGREEMENT','UTF8'),encode(sha256(convert_to('SYNTHETIC AGREEMENT','UTF8')),'hex'),'SYNTHETIC DECLARATION',$3,convert_to('SYNTHETIC DECLARED METHOD','UTF8'),encode(sha256(convert_to('SYNTHETIC DECLARED METHOD','UTF8')),'hex'),'${id(20)}',now())`,[id(which),previous?id(previous):null,`SYNTHETIC-${which}`])
const requestBasis=()=>db.query("SELECT public.ediel_contract_metering_request_source_v1($1,$2,$3,'test') result",[id(1),id(30),id(20)])
assert.equal((await requestBasis()).rows[0].result.status,'held')
await declarationInsert(35)
await db.exec(`INSERT INTO gridex_metering_method_changes.events(id,company_id,environment,supply_period_id,customer_id,metering_point_id,legal_actor_id,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,supply_source_message_id,supply_state_version,subtype,effective_at,contract_id,contract_revision,protected_contract_hash,agreement_original,agreement_sha256,source_reference,source_original,source_sha256,source_version,approved_by,approved_at,requested_method_declaration_id) VALUES('${id(10)}','${id(1)}','test','${id(4)}','${id(3)}','${id(5)}','${id(9)}','12345','54321','735123456789012345','9','TES','${id(6)}',1,'F','2026-11-01T12:34:00+01:00','${id(30)}','SYNTHETIC-REVISION',repeat('c',64),convert_to('SYNTHETIC AGREEMENT','UTF8'),encode(sha256(convert_to('SYNTHETIC AGREEMENT','UTF8')),'hex'),'SYNTHETIC EVENT',convert_to('SYNTHETIC EVENT ORIGINAL','UTF8'),encode(sha256(convert_to('SYNTHETIC EVENT ORIGINAL','UTF8')),'hex'),'SYNTHETIC VERSION','${id(20)}',now(),'${id(35)}');`)
assert.deepEqual((await source()).rows[0].result.missing,['authentic_network_registry_unqualified'])
await db.exec(`CREATE OR REPLACE FUNCTION gridex_ai_processing.network_registry_basis_v1(text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"status":"authorized","syntheticUnqualified":true}'::jsonb$$;`)
const requested=(await requestBasis()).rows[0].result;assert.equal(requested.requestedMethod,'Z04');
await db.exec('DELETE FROM gridex_received_sources.supply_fixture');assert.equal((await requestBasis()).rows[0].result.status,'authorized');await db.query('INSERT INTO gridex_received_sources.supply_fixture VALUES($1)',[supply]);
const b=(await source()).rows[0].result
assert.equal(b.method,'Z04');assert.equal(b.reason,'E64');assert.equal(b.siteId,id(31))
await db.exec(`UPDATE customer_contracts SET signed_version='OTHER'`);assert.equal((await source()).rows[0].result.status,'held');await db.exec(`UPDATE customer_contracts SET signed_version='SYNTHETIC-REVISION'`)
await db.query("UPDATE gridex_received_sources.supply_fixture SET basis=jsonb_set(basis,'{sourceObjects,0,point}','\"OTHER\"')")
assert.equal((await source()).rows[0].result.status,'held');await db.query('UPDATE gridex_received_sources.supply_fixture SET basis=$1',[supply])
await db.exec(`INSERT INTO ediel_message_intents(id,company_id,environment,direction,message_family,message_code,operation_id,customer_id,metering_point_id,validation_status,application_reference,communication_route_id,route_profile_id,interchange_reference,message_reference,transaction_reference,sender_ediel_id,receiver_ediel_id,customer_site_id) VALUES('${id(12)}','${id(1)}','test','outbound','PRODAT','Z09','${id(10)}','${id(3)}','735123456789012345','validated','23-DDQ-PRODAT','${id(13)}','${id(14)}','SYNTHFG001','1','SYNTHETIC-LI','99111','54321','${id(31)}');INSERT INTO outbound_requests VALUES('${id(15)}','${id(1)}','customer_masterdata','manual','${id(12)}','${id(3)}','${id(13)}','${id(5)}','${id(10)}','${id(31)}','{"environment":"test"}');`)
const reserve=()=>db.query('SELECT public.ediel_reserve_metering_method_change_origin_v1($1,$2,$3,$4,$5) result',[id(1),id(10),id(20),id(12),id(15)])
await db.exec(`UPDATE outbound_requests SET site_id='${id(99)}'`);await assert.rejects(()=>reserve(),/owned_intent_request_required/);await db.exec(`UPDATE outbound_requests SET site_id='${id(31)}',payload='{}'`);await assert.rejects(()=>reserve(),/owned_intent_request_required/);await db.exec(`UPDATE outbound_requests SET payload='{"environment":"test"}'`);
assert.equal((await reserve()).rows[0].result.status,'reserved');assert.equal((await reserve()).rows[0].result.status,'reserved')
const raw="UNB+UNOC:3+99111:ZZ+54321:ZZ+260930:1200+SYNTHFG001++23-DDQ-PRODAT++++1'UNH+1+PRODAT:D:96B:UN:E2SE6A'BGM+Z09+SYNTHFG001+9'NAD+FR+12345:160:SVK'NAD+DO+54321:160:SVK'LIN+1++735123456789012345:SR::9'DTM+157:202611011234:203'CCI++Z13'CAV+E64'CCI++Z04'CAV+Z04'RFF+Z05:TES'RFF+LI:SYNTHETIC-LI'UNT+14+1'UNZ+1+SYNTHFG001'"
const insert=wire=>db.query(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,intent_id,raw_payload,source_operation_id,outbound_request_id,customer_id,metering_point_id,communication_route_id,route_profile_id,sender_ediel_id,receiver_ediel_id,interchange_reference,transaction_reference,created_by,site_id) VALUES($1,$2,'test','outbound','PRODAT','Z09',$3,$4,$5,$6,$7,$8,$9,$10,'99111','54321','SYNTHFG001','SYNTHETIC-LI',$11,$12)`,[id(16),id(1),id(12),wire,id(10),id(15),id(3),id(5),id(13),id(14),id(20),id(31)])
for(const altered of [raw.replace('CAV+Z04','CAV+Z02'),raw.replace('CAV+E64','CAV+E32'),raw.replace('202611011234','202611010000'),raw.replace('SYNTHETIC-LI','OTHER')])await assert.rejects(()=>insert(altered),/exact_wire_basis_required/)
await assert.rejects(()=>insert(raw.replace("LIN+1", "NAD+UD+199001011234:SE1'LIN+1")),/authentic_metering_method_change_origin_required/)
assert.equal((await db.query('SELECT count(*)::int n FROM gridex_metering_method_changes.desired_change_receipts')).rows[0].n,0)
await assert.rejects(()=>insert(raw.replace('PRODAT:D:96B','UTILTS:D:96B')),/authentic_metering_method_change_origin_required/);
await assert.rejects(()=>insert(raw.replace('++++1','++++0')),/exact_wire_basis_required/);
await db.exec(`UPDATE outbound_requests SET site_id='${id(99)}'`);await assert.rejects(()=>insert(raw),/owned_request_changed/);await db.exec(`UPDATE outbound_requests SET site_id='${id(31)}'`);
await insert(raw)
await assert.rejects(()=>db.exec(`UPDATE ediel_messages SET site_id='${id(99)}' WHERE id='${id(16)}'`),/bound_message_immutable/);
assert.equal((await db.query('SELECT count(*)::int n FROM gridex_metering_method_changes.desired_change_receipts')).rows[0].n,1)
assert.equal((await db.query('SELECT gridex_metering_method_changes.frozen_original_basis_v1($1,$2) result',[id(1),id(16)])).rows[0].result.validityDay,'20261101')
const send=()=>db.query('SELECT public.ediel_require_metering_method_change_source_current_v1($1,$2,$3)',[id(1),id(16),id(20)])
await send()
await db.exec("CREATE OR REPLACE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT $3='communication.send'$$")
await send();await assert.rejects(()=>source(),/actor_forbidden/)
await db.exec("CREATE OR REPLACE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$")
await db.exec(`UPDATE customer_contracts SET signed_version='OTHER'`);await assert.rejects(()=>send(),/current_source_held/)
assert.equal((await db.query('SELECT gridex_metering_method_changes.frozen_original_basis_v1($1,$2) result',[id(1),id(16)])).rows[0].result.validityDay,'20261101')
await db.exec(`UPDATE customer_contracts SET signed_version='SYNTHETIC-REVISION'`)
await assert.rejects(()=>db.exec('DELETE FROM gridex_metering_method_changes.desired_change_receipts'),/source_immutable/)
assert.equal((await db.query("SELECT has_table_privilege('service_role','gridex_metering_method_changes.events','INSERT') allowed")).rows[0].allowed,false)
assert.equal((await db.query("SELECT has_table_privilege('service_role','gridex_metering_method_changes.contract_request_declarations','INSERT') allowed")).rows[0].allowed,false)
await assert.rejects(()=>db.exec("UPDATE gridex_metering_method_changes.contract_request_declarations SET requested_method='Z03'"),/source_immutable/)
await declarationInsert(36);assert.equal((await requestBasis()).rows[0].result.status,'held');
await db.exec(`INSERT INTO gridex_metering_method_changes.contract_request_revocations VALUES('${id(36)}','SYNTHETIC REVOCATION',repeat('a',64),'${id(20)}',now())`);assert.equal((await requestBasis()).rows[0].result.status,'authorized');

// Genuine protected TEST original admission has no production origin/effect.
const fixtureQualification=positive=>({kind:positive?'source_qualified_positive_fixture':'source_qualified_negative_fixture',version:1,companyId:id(1),roleCode:'supplier',suite:'PRODAT',expectedOutcome:positive?'positive':'negative',expectedDiagnosticCodes:positive?[]:['42'],authorizesBusinessEffect:false})
for(const positive of [true,false]){
 const mid=positive?id(70):id(71),witness=positive?id(72):id(73),fixtureRaw=raw.replace('SYNTHFG001',positive?'POSITIVEFG':'NEGATIVEFG')
 await db.query('INSERT INTO gridex_negative_fixtures.synthetic_ports VALUES($1,$2,$3,$4,$5)',[witness,id(1),fixtureRaw,id(20),fixtureQualification(positive)])
 const snapshot={[positive?'sourceQualifiedPositiveFixtureWitnessId':'sourceQualifiedNegativeFixtureWitnessId']:witness}
 const store=env=>db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,created_by,execution_context_snapshot) VALUES($1,$2,$3,'outbound','PRODAT','Z09',$4,$5,$6)",[mid,id(1),env,fixtureRaw,id(20),snapshot])
 await assert.rejects(()=>store('production'),/authentic_metering_method_change_origin_required/)
 await store('test')
 await db.query(`INSERT INTO gridex_negative_fixtures.${positive?'positive_consumptions':'negative_prepared_consumptions'} VALUES($1,$2)`,[mid,id(1)])
 await db.query('SELECT public.ediel_require_metering_method_change_source_current_v1($1,$2,$3)',[id(1),mid,id(20)])
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_metering_method_changes.desired_change_receipts')).rows[0].n,1)
 await db.query("UPDATE gridex_negative_fixtures.synthetic_ports SET qualification=jsonb_set(qualification,'{authorizesBusinessEffect}','true') WHERE witness=$1",[witness])
 await assert.rejects(()=>db.query('SELECT public.ediel_require_metering_method_change_source_current_v1($1,$2,$3)',[id(1),mid,id(20)]),/current_test_original_required/)
}
// Pure immutable source-effect projection and P119 own-field mask.
const obj={messageReference:'OWN-Z06',objectId:'735123456789012345',identityAgency:'9',registers:[{lineIndex:0,segmentIndex:6,lineNumber:'1'}]},wire={messageCode:'Z06',businessCase:'change_with_reading',legalSender:'54321',legalReceiver:'12345'}
const effects=[{object:obj,meteringPointId:id(5),siteId:id(31),effectiveAt:'2026-11-03T11:34:00Z',wire,sourceRegisters:[{register:obj.registers[0],tokens:[{tag:'CCI',elements:[['CCI'],[],['Z04']]},{tag:'CAV',elements:[['CAV'],['Z04']]}]}]}]
const facts=JSON.stringify({objects:[{object:obj,disposition:'accepted',business:{owner:'reviewed-received-structure-v1',companyId:id(1),environment:'test',customerId:id(3),siteId:id(31),meteringPointId:id(5),wire}}]})
const effectRaw='DECLARED SYNTHETIC SOURCE EFFECT',hash=async text=>(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') h",[text])).rows[0].h,eh=await hash(effectRaw)
await db.query("INSERT INTO gridex_received_sources.sources VALUES($1,$2,'test',$3,$4)",[id(50),id(1),eh,effectRaw])
await db.query("INSERT INTO gridex_received_sources.object_assessments VALUES($1,$2,$3,'test',$4,$5,$6,$7)",[id(51),id(1),id(50),eh,id(52),facts,await hash(facts)])
await db.query("INSERT INTO gridex_received_sources.prodat_ignored_field_facets VALUES($1,$2,$3,'test',$4,$5,$6)",[id(52),id(1),id(50),eh,await hash('[]'),'[]'])
await db.query("INSERT INTO gridex_received_sources.structural_apply_receipts VALUES($1,$2,'test',$3,$4,$5,$6,now(),now())",[id(50),id(1),eh,id(51),id(52),effects])
const projected=()=>db.query('SELECT gridex_received_sources.applied_structural_method_objects_v1($1,$2) result',[id(1),id(50)])
assert.equal((await projected()).rows[0].result[0].measurementMethod,'Z04')
const ignored=JSON.stringify([{fieldNumber:'217',occurrence:{objectId:obj.objectId,identityAgency:'9',messageReference:'OWN-Z06',lineIndex:0}}])
await db.query('UPDATE gridex_received_sources.prodat_ignored_field_facets SET fields_text=$1,fields_hash=$2',[ignored,await hash(ignored)])
assert.equal((await projected()).rows[0].result[0].measurementMethod,null)
assert.equal((await db.query('SELECT gridex_received_sources.applied_structural_method_objects_v1($1,$2) result',[id(2),id(50)])).rows[0].result,null)
await db.close();console.log('PASS: synthetic F/G agreed-method source/contract/original/intent/wire/atomic desired change/native send scope. Native/authentic agreement/owner legal approval/method fulfillment NOT RUN.')
