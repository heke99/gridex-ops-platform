// Complete new forward executed with actual legal/original/rule-owner bodies.
// Disposable contract/issuer configuration, historic edition selection and
// transport predecessor are explicit finite mechanics boundaries, NOT native
// PostgreSQL, actual provider traffic, legal approval or whole P16 proof.
import {readFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash,createHmac} from 'node:crypto'
import assert from 'node:assert/strict'
const fixtureUrl=new URL('./ediel-bilateral-prodat-profile-sql-regression.mjs',import.meta.url).href
const fixture=readFileSync(new URL(fixtureUrl),'utf8'),prefix=fixture.slice(fixture.indexOf('const {PGlite}'),fixture.indexOf(' const sourceRaw=' )).replaceAll('import.meta.url','fixtureUrl').replace('guide_revision text,source_hash text);','guide_revision text,source_hash text,field_matrix_version text);').replace('INSERT INTO ediel_rule_packs VALUES','INSERT INTO ediel_rule_packs(id,family,market,status,valid_from,valid_to,guide_version,guide_revision,source_hash) VALUES')
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor
const setup=new AsyncFunction('readFileSync','existsSync','resolve','pathToFileURL','createHash','createHmac','assert','fixtureUrl',prefix+' return {db,id,checks,fn,migration,approved,artifact,selector,run};}catch(error){await db.close();throw error}')
const {db,id,fn,migration,approved,run}=await setup(readFileSync,existsSync,resolve,pathToFileURL,createHash,createHmac,assert,fixtureUrl)
let checks=0
try{
 await db.exec(`ALTER TABLE supplier_switch_requests ADD COLUMN requested_start_date date,ADD COLUMN prodat_variant text,ADD COLUMN prodat_reason text,ADD COLUMN request_type text;ALTER TABLE metering_points ADD COLUMN meter_point_id text;
 INSERT INTO supplier_switch_requests(id,company_id,customer_id,metering_point_id,site_id,contract_id,rff_li_reference,status,lifecycle_blocked,requested_start_date) VALUES('${id(30)}','${id(1)}','${id(4)}','${id(6)}','${id(5)}','${id(7)}','H-OWN','prepared',false,'2026-10-15');UPDATE supplier_switch_requests SET prodat_variant='H',prodat_reason='Z25';
 CREATE SCHEMA gridex_ediel_outbound_owner;CREATE SCHEMA gridex_ediel_readiness;CREATE SCHEMA extensions;
 CREATE FUNCTION public.digest(bytea,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256($1)$$;
 CREATE TABLE gridex_ediel_readiness.source_editions(source_version text,input_manifest jsonb,catalog jsonb,recorded_at timestamptz DEFAULT now());`)
 const identity=migration('20260930173632_ediel_immutable_source_legal_context.sql'),a=identity.indexOf('CREATE TABLE gridex_ediel_inbound_context.receipts'),b=identity.indexOf('CREATE FUNCTION gridex_ediel_inbound_context.derive',a)
 await db.exec(identity.slice(a,b))
 const projection=identity.slice(identity.indexOf('INSERT INTO gridex_ediel_readiness.source_editions'),identity.indexOf('-- END CANONICAL SOURCE PROJECTION'))
 await db.exec(projection)
 await db.exec('DROP TABLE tenant_counterparty_relations;CREATE TABLE tenant_counterparty_relations(id uuid,company_id uuid,environment text,relation_type text,counterparty_actor_id uuid,is_enabled boolean,valid_from timestamptz,valid_to timestamptz)')
 const original=migration('20260930193722_ediel_outbound_canonical_owner_witness.sql'),wa=original.indexOf('CREATE TABLE gridex_ediel_outbound_owner.witnesses'),wb=original.indexOf('CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1',wa)
 await db.exec(original.slice(wa,wb))
 const rules=migration('20260930180104_ediel_immutable_source_rule_pack_basis.sql'),ra=rules.indexOf('CREATE TABLE gridex_ediel_source_rules.receipts'),rb=rules.indexOf('CREATE FUNCTION gridex_ediel_source_rules.require_v1',ra)
 await db.exec(rules.slice(ra,rb))
 // Add only the actual original gateway column contract used by this forward.
 const forward=migration('20261001023248_ediel_bilateral_prodat_outbound_profile_original_owner.sql'),cols=/INSERT INTO public.ediel_messages\(([^)]+)\)/.exec(forward)[1].split(',')
 const known=new Set((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='ediel_messages'")).rows.map(r=>r.column_name))
 for(const c of cols)if(!known.has(c)){const type=['rule_pack_snapshot','execution_context_snapshot','parsed_payload','validation_report'].includes(c)?'jsonb':['requires_contrl','requires_aperak','was_smime_encrypted','cms_expected_receiver_present'].includes(c)?'boolean':c==='test_flag'?'integer':c.endsWith('_id')&&!['sender_ediel_id','receiver_ediel_id','unb_sender_id','unb_receiver_id','original_message_id','original_transaction_id','source_operation_id'].includes(c)||['created_by','updated_by'].includes(c)?'uuid':'text';await db.exec(`ALTER TABLE ediel_messages ADD COLUMN ${c} ${type}`)}
 await db.exec(`CREATE TABLE ediel_business_references(company_id uuid,source_message_id uuid,reference_type text,reference_value text,message_family text,message_code text,business_object_type text,business_object_id uuid,customer_id uuid,customer_site_id uuid,metering_point_id uuid,UNIQUE(company_id,reference_type,reference_value,business_object_type,business_object_id));
 CREATE TABLE ediel_message_events(company_id uuid,ediel_message_id uuid,message_id uuid,event_type text,event_status text,message text,payload jsonb,event_payload jsonb,created_by uuid);
 CREATE TABLE audit_logs(actor_user_id uuid,company_id uuid,entity_type text,entity_id uuid,action text,metadata jsonb);
 CREATE FUNCTION public.declared_physical_hash_seal() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.immutable_payload_hash:=encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex');NEW.immutable_rendered_at:=clock_timestamp();RETURN NEW;END$$;
 CREATE TRIGGER declared_physical_hash_seal BEFORE INSERT ON ediel_messages FOR EACH ROW EXECUTE FUNCTION public.declared_physical_hash_seal();`)
 await db.exec(fn('20260923135706_ediel_utilts_consumption_binding_v1.sql','gridex_utilts_binding.wire_tokens_v1'))
 await db.exec(fn('20260930180104_ediel_immutable_source_rule_pack_basis.sql','gridex_ediel_inbound_context.derive'))
 await db.exec(fn('20260930173632_ediel_immutable_source_legal_context.sql','gridex_ediel_inbound_context.require_v1').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
 await db.exec(fn('20260930173632_ediel_immutable_source_legal_context.sql','gridex_ediel_inbound_context.capture'))
 await db.exec('CREATE TRIGGER actual_legal_capture AFTER INSERT ON ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_inbound_context.capture()')
 await db.exec(fn('20260930213848_ediel_draft_owner_preparation_permissions.sql','gridex_ediel_outbound_owner.assert_preparation_v1'))
 await db.exec(fn('20260930200633_ediel_outbound_witness_ack_scope_and_time_guards.sql','gridex_ediel_outbound_owner.require_positive_utilts_ack_v1'))
 await db.exec(fn('20260930213848_ediel_draft_owner_preparation_permissions.sql','gridex_ediel_outbound_owner.prepare_before_native_ack_guide_v1').replace('prepare_before_native_ack_guide_v1','prepare_v1'))
 await db.exec(fn('20260930200633_ediel_outbound_witness_ack_scope_and_time_guards.sql','gridex_ediel_outbound_owner.assert_message_v1'))
 await db.exec(fn('20260930200633_ediel_outbound_witness_ack_scope_and_time_guards.sql','gridex_ediel_outbound_owner.consume'))
 await db.exec('CREATE TRIGGER actual_original_consume AFTER INSERT ON ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_outbound_owner.consume()')
 await db.exec(fn('20260930193722_ediel_outbound_canonical_owner_witness.sql','gridex_ediel_outbound_owner.require_v1'))
 await db.exec(fn('20260930180104_ediel_immutable_source_rule_pack_basis.sql','gridex_ediel_source_rules.require_v1').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
 await db.exec(fn('20260930193722_ediel_outbound_canonical_owner_witness.sql','gridex_ediel_source_rules.capture_v1'))
 await db.exec(`CREATE TABLE public.declared_transport_entries(message_id uuid PRIMARY KEY,accepted boolean NOT NULL DEFAULT false);
 CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF EXISTS(SELECT FROM public.declared_transport_entries WHERE message_id=(i->>'messageId')::uuid AND accepted) THEN RETURN '{"proceed":false,"acceptedReceipt":{"declared":true}}';END IF;INSERT INTO public.declared_transport_entries(message_id) VALUES((i->>'messageId')::uuid) ON CONFLICT DO NOTHING;RETURN '{"proceed":true}';END$$;
 CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT gridex_ediel_transport.mutate_v1(i)$$;`)

 // Actual intent and switch binder run over declared current contract/route/intent
 // rows. Only contract-readiness issuance is a finite external port below.
 await db.exec(`CREATE TABLE public.outbound_requests(id uuid PRIMARY KEY,company_id uuid,payload jsonb,source_type text,source_id uuid,operation_id uuid,request_type text,customer_id uuid,site_id uuid,metering_point_id uuid);
 CREATE TABLE public.ediel_message_intents(id uuid PRIMARY KEY,company_id uuid,environment text,market text,message_family text,message_code text,direction text,created_by uuid,operation_id uuid,supplier_switch_request_id uuid,customer_id uuid,customer_site_id uuid,payload jsonb,ediel_message_id uuid,outbound_request_id uuid,render_status text,updated_at timestamptz,validation_status text,validation_result jsonb,blocking_reasons jsonb,route_profile_id uuid,communication_route_id uuid,expected_rule_version text,expected_field_matrix_version text,message_reference text,interchange_reference text,application_reference text,sender_ediel_id text,receiver_ediel_id text,sender_subaddress text,receiver_subaddress text,transaction_reference text,metering_point_id text,grid_area_code text);
 CREATE TABLE public.communication_routes(id uuid PRIMARY KEY,company_id uuid,is_active boolean);
 CREATE TABLE public.ediel_route_profiles(id uuid PRIMARY KEY,company_id uuid,is_enabled boolean,environment text,communication_route_id uuid);
 CREATE FUNCTION public.gridex_assert_supplier_switch_ready(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM public.customer_contracts WHERE id=$2 AND company_id=$1 AND status='signed' AND signed_at IS NOT NULL) THEN RAISE EXCEPTION 'declared_contract_readiness_missing';END IF;END$$;
 INSERT INTO outbound_requests VALUES('${id(32)}','${id(1)}','{"environment":"test"}','supplier_switch_request','${id(30)}','${id(30)}','supplier_switch','${id(4)}','${id(5)}','${id(6)}');
 INSERT INTO communication_routes VALUES('${id(33)}','${id(1)}',true);
 INSERT INTO ediel_route_profiles VALUES('${id(34)}','${id(1)}',true,'test','${id(33)}');
 INSERT INTO ediel_message_intents(id,company_id,environment,market,message_family,message_code,direction,created_by,operation_id,supplier_switch_request_id,customer_id,customer_site_id,payload,validation_status,validation_result,blocking_reasons,route_profile_id,communication_route_id,message_reference,interchange_reference,application_reference,sender_ediel_id,receiver_ediel_id,transaction_reference,metering_point_id,grid_area_code) VALUES('${id(31)}','${id(1)}','test','electricity','PRODAT','Z03','outbound','${id(2)}','${id(30)}','${id(30)}','${id(4)}','${id(5)}','{"transactionSubtype":"H"}','validated','{"ok":true,"status":"validated"}','[]','${id(34)}','${id(33)}','M','I','23-DDQ-PRODAT','12345','54321','H-OWN','${id(6)}','TES');`)
 const binding=migration('20260930213949_ediel_switch_intent_original_source_binding.sql');await db.exec(binding.slice(binding.indexOf('CREATE TABLE gridex_received_sources.switch_originals'),binding.indexOf('-- Actual field209')))
 await db.exec(fn('20260930213949_ediel_switch_intent_original_source_binding.sql','gridex_received_sources.switch_origin_wire_v1'))
 await db.exec(fn('20260930204728_ediel_native_intent_and_source_request_guards.sql','gridex_ediel_transport.require_message_intent_v1'))
 await db.exec(forward);checks++
 const raw="UNB+UNOC:3+12345:14+54321:14+261001:1200+I++23-DDQ-PRODAT++++1'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z03+DOC+9'NAD+FR+12345:160:SVK'NAD+DO+54321:160:SVK'LIN+1++735123456789012345:::9'CCI++Z13'CAV+Z25'RFF+LI:H-OWN'RFF+Z05:TES'NAD+UD+199001011234:SE2:260'DTM+92:202610150000:203'UNT+13+M'UNZ+1+I'"
 const qualified=()=>run('ediel_qualify_bilateral_prodat_outbound_draft_v1',[id(1),id(2),'test',raw])
 const q=await qualified();assert.equal(q.owner,'immutable-bilateral-prodat-outbound-profile-v1');assert.equal(q.objects[0].profileVersionId,approved.profileVersionId);checks++
 const snapshot=(await db.query("SELECT jsonb_build_object('rulePack',to_jsonb(r),'messageProfile',to_jsonb(p),'guideSources',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM ediel_rule_pack_sources s WHERE rule_pack_id=r.id),'profileKey',p.profile_key,'profileVersionId',p.id,'version','26.A:r3','checksum',r.source_hash) b FROM ediel_rule_packs r JOIN ediel_message_profiles p ON p.rule_pack_id=r.id WHERE p.id=$1",[id(21)])).rows[0].b
 const draft={companyId:id(1),actorUserId:id(999),environment:'test',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z03',status:'draft',rawPayload:raw,sourceOperationId:id(30),intentId:id(31),outboundRequestId:id(32),communicationRouteId:id(33),routeProfileId:id(34),customerId:id(4),meteringPointId:id(6),siteId:id(5),switchRequestId:id(30),senderEdielId:'12345',receiverEdielId:'54321',testFlag:1,requiresContrl:true,requiresAperak:true,canonicalRulePackId:id(20),ruleProfileVersionId:id(21),ruleProfileKey:snapshot.profileKey,ruleProfileVersion:'26.A:r3',rulePackChecksum:'e'.repeat(64),rulePackSnapshot:snapshot}
 const create=(d=draft,company=id(1),actor=id(2))=>run('ediel_create_bilateral_prodat_original_v1',[company,actor,d])
 const counts=async()=>(await db.query("SELECT jsonb_build_object('originals',(SELECT count(*) FROM ediel_messages),'operations',(SELECT count(*) FROM gridex_bilateral_prodat.outbound_operations),'receipts',(SELECT count(*) FROM gridex_bilateral_prodat.outbound_receipts),'witnesses',(SELECT count(*) FROM gridex_ediel_outbound_owner.witnesses),'consumed',(SELECT count(*) FROM gridex_ediel_outbound_owner.consumptions),'rules',(SELECT count(*) FROM gridex_ediel_source_rules.receipts),'legal',(SELECT count(*) FROM gridex_ediel_inbound_context.receipts),'events',(SELECT count(*) FROM ediel_message_events),'audit',(SELECT count(*) FROM audit_logs),'switchOriginals',(SELECT count(*) FROM gridex_received_sources.switch_originals),'boundSwitches',(SELECT count(*) FROM supplier_switch_requests WHERE outbound_z03_message_id IS NOT NULL),'boundIntents',(SELECT count(*) FROM ediel_message_intents WHERE ediel_message_id IS NOT NULL)) b")).rows[0].b
 const empty=await counts();assert.deepEqual(empty,{originals:0,operations:0,receipts:0,witnesses:0,consumed:0,rules:0,legal:0,events:0,audit:0,switchOriginals:0,boundSwitches:0,boundIntents:0});checks++
 for(const changed of [{...draft,companyId:id(99)},{...draft,rawPayload:raw.replace('H-OWN','OTHER')},{...draft,customerId:id(99)},{...draft,ruleProfileVersionId:id(22)},{...draft,intentId:id(99)}]){await assert.rejects(create(changed));assert.deepEqual(await counts(),empty);checks++}
 await db.query("UPDATE ediel_message_intents SET validation_status='blocked' WHERE id=$1",[id(31)]);await assert.rejects(create(),/native_validated_intent_required/);assert.deepEqual(await counts(),empty);checks++;await db.query("UPDATE ediel_message_intents SET validation_status='validated' WHERE id=$1",[id(31)]);
 await db.query("UPDATE user_permissions SET effect='deny' WHERE user_id=$1 AND permission_key='ediel.bilateral_profile.review'",[id(3)]);assert.equal(await qualified(),null);await assert.rejects(create(),/current_profile_required/);assert.deepEqual(await counts(),empty);checks++
 await db.query("UPDATE user_permissions SET effect='allow' WHERE user_id=$1 AND permission_key='ediel.bilateral_profile.review'",[id(3)])
 await db.exec("ALTER TABLE audit_logs ADD CONSTRAINT declared_last_write_failure CHECK(action<>'ediel.bilateral_profile.original_registered') NOT VALID")
 await assert.rejects(create(),/declared_last_write_failure/);assert.deepEqual(await counts(),empty);checks++
 await db.exec('ALTER TABLE audit_logs DROP CONSTRAINT declared_last_write_failure')
 const made=await create();assert.equal(made.version,1);assert.equal(made.replayed,false);assert.equal(made.message.created_by,id(2));assert.equal(made.message.raw_payload,raw);assert.deepEqual(await counts(),{originals:1,operations:1,receipts:1,witnesses:1,consumed:1,rules:1,legal:1,events:1,audit:1,switchOriginals:1,boundSwitches:1,boundIntents:1});checks++
 const actualBound=(await db.query('SELECT original_object FROM gridex_received_sources.switch_originals WHERE message_id=$1',[made.message.id])).rows[0].original_object;assert.equal(actualBound.reason,'Z25');assert.equal(actualBound.li,'H-OWN');assert.equal(actualBound.customerQualifier,'SE2');checks++;
 const done=await counts(),again=await create();assert.equal(again.message.id,made.message.id);assert.equal(again.replayed,true);assert.deepEqual(await counts(),done);checks++
 await db.query("UPDATE supplier_switch_requests SET status='completed' WHERE id=$1",[id(30)]);assert.equal((await create()).message.id,made.message.id);assert.deepEqual(await counts(),done);checks++
 await db.query("UPDATE supplier_switch_requests SET status='prepared' WHERE id=$1",[id(30)])
 await db.query("UPDATE ediel_field_rules SET classification='X' WHERE message_profile_id=$1",[id(21)]);assert.equal(await qualified(),null);assert.equal((await create()).message.id,made.message.id);assert.deepEqual(await counts(),done);checks++
 const transport={action:'prepare',companyId:id(1),messageId:made.message.id,actorUserId:id(2),environment:'test'}
 await assert.rejects(db.query('SELECT gridex_ediel_transport.mutate_v1($1)',[transport]),/current_profile_required/);assert.equal((await db.query('SELECT count(*)::int n FROM declared_transport_entries')).rows[0].n,0);checks++
 await db.query("UPDATE ediel_field_rules SET classification='R' WHERE message_profile_id=$1",[id(21)])
 assert.equal((await db.query('SELECT gridex_ediel_transport.mutate_v1($1) b',[transport])).rows[0].b.proceed,true);checks++
 await db.query('UPDATE declared_transport_entries SET accepted=true WHERE message_id=$1',[made.message.id])
 await db.query("UPDATE user_permissions SET effect='deny' WHERE user_id=$1 AND permission_key='ediel.bilateral_profile.review'",[id(3)]);await assert.rejects(create(),/recorded_profile_required/);assert.equal((await db.query('SELECT gridex_ediel_transport.mutate_v1($1) b',[transport])).rows[0].b.proceed,false);assert.deepEqual(await counts(),done);checks++
 await assert.rejects(db.exec('SET ROLE service_role;INSERT INTO gridex_bilateral_prodat.outbound_operations DEFAULT VALUES'),/permission denied/);await db.exec('RESET ROLE');checks++
 console.log(JSON.stringify({status:'PASS',checks,scope:'complete outbound forward/current source-owner SQL mechanics over declared contract/issuer/transport boundaries',native:'NOT_RUN',normativeBilateralApproval:'NOT_CLAIMED'}))
}finally{await db.close()}
