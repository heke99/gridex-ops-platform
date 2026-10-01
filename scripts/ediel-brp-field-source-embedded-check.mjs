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
CREATE FUNCTION public.ediel_read_source_supply_at_v1(c uuid,actor uuid,p uuid,a timestamptz) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN PERFORM gridex_ai_processing.authorize_purpose_phase_v1(c,actor,'origination',NULL);RETURN gridex_received_sources.supply_period_source_at_v1(c,p,a);END$$;
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
// All owner/source/role originals below are declared mechanical fixtures.
const originalTokenizer=readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql',import.meta.url),'utf8').match(/CREATE FUNCTION gridex_utilts_binding\.wire_tokens_v1[\s\S]*?END \$\$;/)[0]
await db.exec(originalTokenizer)
await db.exec(readFileSync(new URL('../supabase/migrations/20260930200545_ediel_brp_change_source_origination.sql',import.meta.url),'utf8'))
await db.exec(`ALTER TABLE gridex_received_sources.sources ADD PRIMARY KEY(source_message_id),ADD COLUMN captured_at timestamptz DEFAULT now(),ADD COLUMN source_received_at timestamptz DEFAULT now(),ADD COLUMN message_code text;
ALTER TABLE gridex_received_sources.object_assessments ADD COLUMN previous_assessment_id uuid,ADD COLUMN assessed_at timestamptz DEFAULT now();
CREATE TABLE gridex_received_sources.validation_assessments(id uuid,previous_assessment_id uuid,company_id uuid,environment text,source_message_id uuid,source_payload_hash text,facts_text text);
CREATE TABLE gridex_received_sources.object_availability_witnesses(id uuid,assessment_id uuid,company_id uuid,environment text,facts_hash text,observed_at timestamptz);
CREATE TABLE gridex_received_sources.epoch(singleton bool,opened_at timestamptz);INSERT INTO gridex_received_sources.epoch VALUES(true,'2026-09-01Z');
CREATE TABLE gridex_received_sources.object_selection_snapshots(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,environment text,cutoff_at timestamptz,captured_at timestamptz,readset_text text,readset_hash text,visibility_snapshot text);`)
const snapshot=readFileSync(new URL('../supabase/migrations/20260922150922_ediel_source_decision_snapshots.sql',import.meta.url),'utf8').match(/CREATE FUNCTION gridex_received_sources\.open_object_selection_snapshot[\s\S]*?END \$\$;/)[0]
await db.exec(snapshot)
const sourceRow=readFileSync(new URL('../supabase/migrations/20260930203354_ediel_ai_intent_source_origination.sql',import.meta.url),'utf8').match(/CREATE FUNCTION gridex_ai_processing\.source_row_basis_v1[\s\S]*?END \$\$;/)[0]
await db.exec(sourceRow)
await db.exec(readFileSync(new URL('../supabase/migrations/20261001001231_ediel_protected_dated_brp_source.sql',import.meta.url),'utf8'))
await db.exec(`INSERT INTO companies VALUES('${id(1)}'),('${id(2)}');INSERT INTO auth.users VALUES('${id(20)}');INSERT INTO user_profiles VALUES('${id(20)}','active');INSERT INTO company_memberships VALUES('${id(1)}','${id(20)}','active',true,now());INSERT INTO customers VALUES('${id(3)}','${id(1)}');INSERT INTO customer_supply_periods VALUES('${id(4)}','${id(1)}');INSERT INTO customer_sites VALUES('${id(31)}','${id(1)}','${id(3)}');INSERT INTO metering_points VALUES('${id(5)}','${id(1)}','${id(3)}','735123456789012345','54321','TES','${id(31)}',NULL,NULL);
INSERT INTO customer_contracts VALUES('${id(30)}','${id(1)}','${id(3)}','${id(5)}','signed',now(),'SYNTHETIC-REVISION',encode(sha256(convert_to('SYNTHETIC AGREEMENT','UTF8')),'hex'),'${id(31)}',NULL);
INSERT INTO platform_market_actors VALUES('${id(7)}','active','verified'),('${id(8)}','active','verified');INSERT INTO platform_actor_roles(actor_id,actor_role,is_active) VALUES('${id(7)}','grid_owner',true),('${id(8)}','balance_responsible',true);INSERT INTO platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified,valid_from) VALUES('${id(7)}','EdielId','54321',true,'2000-01-01'),('${id(8)}','EdielId','11111',true,'2000-01-01');
INSERT INTO gridex_brp_changes.registry_grounds(id,company_id,environment,dso_actor_id,brp_actor_id,dso_ediel_id,brp_ediel_id,grid_area_code,registry_version,source_reference,source_sha256,registry_snapshot,approved_by,approved_at,valid_from) VALUES('${id(11)}','${id(1)}','test','${id(7)}','${id(8)}','54321','11111','TES','SYNTHETIC REGISTRY','SYNTHETIC ORIGINAL',repeat('a',64),gridex_brp_changes.registry_snapshot_v1('${id(7)}','${id(8)}'),'${id(20)}',now(),'2000-01-01');`)
await db.exec(`INSERT INTO platform_market_actors VALUES('${id(18)}','active','verified');INSERT INTO platform_actor_roles(actor_id,actor_role,is_active) VALUES('${id(18)}','balance_responsible',true);INSERT INTO platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified,valid_from) VALUES('${id(18)}','EdielId','22222',true,'2000-01-01');
INSERT INTO gridex_brp_changes.registry_grounds(id,company_id,environment,dso_actor_id,brp_actor_id,dso_ediel_id,brp_ediel_id,grid_area_code,registry_version,source_reference,source_sha256,registry_snapshot,approved_by,approved_at,valid_from) VALUES('${id(19)}','${id(1)}','test','${id(7)}','${id(18)}','54321','22222','TES','SYNTHETIC REGISTRY','SYNTHETIC ORIGINAL',repeat('b',64),gridex_brp_changes.registry_snapshot_v1('${id(7)}','${id(18)}'),'${id(20)}',now(),'2000-01-01');`)
const read=period=>db.query("SELECT public.ediel_brp_field_source_v1($1,$2,$3,'test',$4,$5,$6,'2026-11-01T11:34:00Z',$7) result",[id(1),id(30),id(20),id(3),id(31),id(5),period])
assert.equal((await read(null)).rows[0].result.status,'held')
await db.exec(`INSERT INTO gridex_brp_sources.contract_declarations(id,company_id,environment,contract_id,contract_revision,protected_contract_hash,customer_id,site_id,metering_point_id,legal_actor_id,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,registry_ground_id,brp_ediel_id,agreement_original,agreement_sha256,source_reference,source_version,source_original,source_sha256,approved_by,approved_at) VALUES('${id(40)}','${id(1)}','test','${id(30)}','SYNTHETIC-REVISION',repeat('c',64),'${id(3)}','${id(31)}','${id(5)}','${id(9)}','12345','54321','735123456789012345','9','TES','${id(11)}','11111',convert_to('SYNTHETIC AGREEMENT','UTF8'),encode(sha256(convert_to('SYNTHETIC AGREEMENT','UTF8')),'hex'),'SYNTHETIC BRP DECLARATION','1',convert_to('SYNTHETIC SOURCE','UTF8'),encode(sha256(convert_to('SYNTHETIC SOURCE','UTF8')),'hex'),'${id(20)}',now());`)
assert.equal((await read(null)).rows[0].result.status,'held') // network remains unqualified
await db.exec(`CREATE OR REPLACE FUNCTION gridex_ai_processing.network_registry_basis_v1(text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"status":"authorized","syntheticUnqualified":true}'::jsonb$$;`)
assert.equal((await read(null)).rows[0].result.brpEdielId,'11111')
assert.equal((await read(null)).rows[0].result.sourceKind,'signed_contract_brp_declaration')
await db.exec(`UPDATE customer_contracts SET signed_version='WRONG'`);assert.equal((await read(null)).rows[0].result.status,'held');await db.exec(`UPDATE customer_contracts SET signed_version='SYNTHETIC-REVISION'`)
await db.exec(`UPDATE platform_actor_roles SET is_active=false WHERE actor_role='balance_responsible'`);assert.equal((await read(null)).rows[0].result.status,'held');await db.exec(`UPDATE platform_actor_roles SET is_active=true`)
assert.equal((await db.query("SELECT has_table_privilege('service_role','gridex_brp_sources.contract_declarations','INSERT') allowed")).rows[0].allowed,false)
await assert.rejects(()=>db.exec("UPDATE gridex_brp_sources.contract_declarations SET brp_ediel_id='FAKE'"),/source_immutable/)
const raw=(code,brp,effective,fn='9',doc='DOC')=>`UNB+UNOC:3+54321:14+12345:14+260930:1200+SYNTHBASE++23-DDQ-PRODAT++++1'UNH+SOURCE+PRODAT:D:97A:UN:26A'BGM+${code}+${doc}+${fn}'NAD+FR+54321:160:SVK'NAD+DO+12345:160:SVK'LIN+1++735123456789012345:MP::9'CCI++Z13'CAV+${code==='Z04'?'Z22':'E64'}'DTM+${code==='Z04'?'92':'157'}:${effective}:203'RFF+LI:OWN'NAD+Z02+${brp}:160:SVK'UNT+12+SOURCE'UNZ+1+SYNTHBASE'`
const hash=async text=>(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') h",[text])).rows[0].h
async function received(n,code,brp,effective,fn='9',replaces=null,{customerOnly=false,ignored262=false,applied=true}={}){
 const payload=raw(code,brp,effective,fn,'DOC'+n).replace('CAV+E64',customerOnly?'CAV+E34':'CAV+E64'),payloadHash=await hash(payload),assessment=id(n+1),canonical=id(n+2)
 const tokens=(await db.query('SELECT gridex_received_sources.closure_wire_tokens_v2($1) t',[payload])).rows[0].t,lin=tokens.find(t=>t.tag==='LIN'),object={messageReference:'SOURCE',messageIndex:0,objectId:'735123456789012345',identityAgency:'9',registers:[{lineIndex:0,lineNumber:'1',segmentIndex:lin.index,registerIndex:0,registerPosition:1}]}
 const minute=effective,utc=minute.slice(0,4)+'-'+minute.slice(4,6)+'-'+minute.slice(6,8)+'T'+minute.slice(8,10)+':'+minute.slice(10,12)+':00+01:00'
 const business={owner:'reviewed-received-structure-v1',companyId:id(1),environment:'test',customerId:id(3),siteId:id(31),meteringPointId:id(5),supplyPeriodId:id(4),sourceMessageId:id(n),sourcePayloadHash:payloadHash,coverageWindow:{baselineSourceMessageId:id(50)},wire:{messageCode:code,businessCase:code==='Z04'?'supply_baseline':customerOnly?'customer_only':'change_with_reading',legalSender:'54321',legalReceiver:'12345',caseReference:'OWN',functionCode:fn,effectiveFrom:{marketMinute:minute,utc}},replaces}
 const facts=JSON.stringify({objects:[{object,disposition:'accepted',business}]})
 await db.query("INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,payload_hash,raw_payload,message_code) VALUES($1,$2,'test',$3,$4,$5)",[id(n),id(1),payloadHash,payload,code])
 await db.query("INSERT INTO gridex_received_sources.object_assessments(id,company_id,source_message_id,environment,source_payload_hash,canonical_assessment_id,facts_text,facts_hash) VALUES($1,$2,$3,'test',$4,$5,$6,$7)",[assessment,id(1),id(n),payloadHash,canonical,facts,await hash(facts)])
 await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,NULL,$2,'test',$3,$4,$5)",[canonical,id(1),id(n),payloadHash,JSON.stringify({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'})])
 await db.query("INSERT INTO gridex_received_sources.object_availability_witnesses VALUES($1,$2,$3,'test',$4,now())",[id(n+3),assessment,id(1),await hash(facts)])
 const ignored=JSON.stringify(ignored262?[{fieldNumber:'262',occurrence:{messageReference:'SOURCE',objectId:object.objectId,identityAgency:object.identityAgency,lineIndex:0}}]:[])
 await db.query("INSERT INTO gridex_received_sources.prodat_ignored_field_facets VALUES($1,$2,$3,'test',$4,$5,$6)",[canonical,id(1),id(n),payloadHash,await hash(ignored),ignored])
 if(code!=='Z04'&&!customerOnly&&applied)await db.query("INSERT INTO gridex_received_sources.structural_apply_receipts VALUES($1,$2,'test',$3,$4,$5,$6,now(),now())",[id(n),id(1),payloadHash,assessment,canonical,JSON.stringify([{object,meteringPointId:id(5),siteId:id(31),wire:business.wire}])])
 return{sourceMessageId:id(n),assessmentId:assessment,payloadHash}
}
await received(50,'Z04','11111','202610010000')
const supply={qualified:true,periodId:id(4),customerId:id(3),siteId:id(31),meteringPointId:id(5),initialSourceMessageId:id(50),sourceMessageId:id(50),legalActorId:id(9),marketStartAt:'2026-09-30T23:00:00Z',marketEndAt:null,dsoEdielId:'54321',sourceObjects:[{point:'735123456789012345',identityAgency:'9',gridArea:'TES'}]}
await db.query('INSERT INTO gridex_received_sources.supply_fixture VALUES($1)',[supply])
assert.equal((await read(id(4))).rows[0].result.sourceKind,'accepted_supply_brp')
assert.equal((await read(id(4))).rows[0].result.sourceMessageId,id(50))
const next=await received(60,'Z06','22222','202610020000')
assert.equal((await read(id(4))).rows[0].result.status,'held') // does not choose latest native raw
const snap=(await db.query("SELECT gridex_received_sources.open_object_selection_snapshot($1,'test',clock_timestamp()) s",[id(1)])).rows[0].s
const qualify=async(n,receipt=snap)=>(await db.query("SELECT public.ediel_qualify_brp_source_candidate_v1($1,$2,$3,'test',$4,$5,$6,'2026-11-01T11:34:00Z',$7,$8,$9,$10) result",[id(1),id(30),id(20),id(3),id(31),id(5),id(4),receipt.snapshotId,receipt.readsetHash,id(n)])).rows[0].result
assert.equal((await qualify(50)).status,'held')
assert.equal((await qualify(60)).brpEdielId,'22222')
assert.equal((await read(id(4))).rows[0].result.sourceMessageId,id(60))
const receiptRead=async(snapshot,n)=>(await db.query("SELECT public.ediel_read_structural_effect_scope_v1($1,'test',$2,$3,$4,$5,$6,$7,$8,'2026-11-01T11:34:00Z',$9,$10,'735123456789012345','9') r",[id(1),id(20),snapshot.snapshotId,snapshot.readsetHash,id(3),id(31),id(5),id(4),id(n),id(n+1)])).rows[0].r
assert.equal((await receiptRead(snap,60)).applied,true)
await assert.rejects(()=>receiptRead({...snap,readsetHash:'f'.repeat(64)},60),/structural_effect_protected_snapshot_required/)
await received(70,'Z06','11111','202610030000','9',null,{ignored262:true});assert.equal((await read(id(4))).rows[0].result.brpEdielId,'22222') // same P119 facet retains field lineage
await received(80,'Z06','11111','202610040000','9',null,{customerOnly:true});assert.equal((await read(id(4))).rows[0].result.sourceMessageId,id(60)) // customer-only does not change structure
const unapplied=await received(85,'Z06','11111','202610041200','9',null,{applied:false})
const unappliedSnap=(await db.query("SELECT gridex_received_sources.open_object_selection_snapshot($1,'test',clock_timestamp()) s",[id(1)])).rows[0].s
assert.equal((await qualify(85,unappliedSnap)).status,'held');assert.equal((await receiptRead(unappliedSnap,85)).applied,false) // parser acceptance never becomes an actual applied change
await db.query("INSERT INTO gridex_received_sources.structural_apply_receipts VALUES($1,$2,'test',$3,$4,$5,$6,now(),now())",[id(85),id(1),unapplied.payloadHash,id(86),id(87),JSON.stringify([{object:{messageReference:'SOURCE',messageIndex:0,objectId:'735123456789012345',identityAgency:'9',registers:[{lineIndex:0,lineNumber:'1',segmentIndex:5,registerIndex:0,registerPosition:1}]},meteringPointId:id(5),siteId:id(31),wire:{}}])]) // deliberately wrong source wire remains unqualified
assert.equal((await receiptRead(unappliedSnap,85)).applied,false)
const correction=await received(90,'Z06','11111','202610050000','5',{sourceMessageId:next.sourceMessageId,assessmentId:next.assessmentId,payloadHash:next.payloadHash})
assert.equal((await read(id(4))).rows[0].result.status,'held') // explicit replacement makes the prior read derivative obsolete
const correctedSnap=(await db.query("SELECT gridex_received_sources.open_object_selection_snapshot($1,'test',clock_timestamp()) s",[id(1)])).rows[0].s
assert.equal((await qualify(90,correctedSnap)).brpEdielId,'11111');assert.equal((await read(id(4))).rows[0].result.sourceMessageId,correction.sourceMessageId)
await received(100,'Z06','11111','202610050000');assert.equal((await read(id(4))).rows[0].result.status,'held') // equal epoch ambiguity
await db.exec(`INSERT INTO gridex_brp_sources.contract_revocations VALUES('${id(40)}','SYNTHETIC REVOCATION',repeat('f',64),'${id(20)}',now())`);assert.equal((await read(null)).rows[0].result.status,'held')
await db.close();console.log('PASS: declared synthetic BRP262 native full-profile/same-contract/role/source/epoch/snapshot/immutability checks; native replay/authentic originals/legal approval NOT RUN.')
