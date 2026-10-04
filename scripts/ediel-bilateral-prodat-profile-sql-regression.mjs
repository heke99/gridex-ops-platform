// Mechanical PostgreSQL regression. All contract, registry, canonical and
// issuer configuration below is declared synthetic. This executes the complete
// new forward SQL; it is not native issuer/legal/Ediel acceptance evidence.
import {readFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash,createHmac} from 'node:crypto'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
const migration=file=>{const local=new URL(`../supabase/migrations/${file}`,import.meta.url);return readFileSync(existsSync(local)?local:resolve(process.env.EDIEL_SHARED_MIGRATIONS_ROOT??'',file),'utf8')}
function fn(file,name){const text=migration(file),match=new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${name.replaceAll('.','\\.')}\\(`).exec(text),start=match?.index??-1,b=text.indexOf('$$;',start);if(start<0||b<0)throw Error(name);return text.slice(start,b+3)}
const run=async(name,args)=>(await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) b`,args)).rows[0].b
try{
 const shared=readFileSync(new URL('./ediel-prodat-mixed-own-object-sql-regression.mjs',import.meta.url),'utf8'),a=shared.indexOf('await db.exec(`')+'await db.exec(`'.length,b=shared.indexOf('`)',a)
 await db.exec(shared.slice(a,b))
 await db.exec(`ALTER TABLE public.company_memberships ADD COLUMN id uuid DEFAULT gen_random_uuid();ALTER TABLE public.supplier_switch_requests ADD COLUMN completed_at timestamptz;ALTER TABLE public.companies ADD COLUMN status text DEFAULT 'active';ALTER TABLE auth.users ADD COLUMN deleted_at timestamptz,ADD COLUMN banned_until timestamptz;
 ALTER TABLE public.permissions ADD COLUMN key text UNIQUE,ADD COLUMN name text,ADD COLUMN category text,ADD COLUMN description text,ADD COLUMN is_active boolean DEFAULT true;ALTER TABLE permissions ADD PRIMARY KEY(id);ALTER TABLE permissions ALTER COLUMN id SET DEFAULT gen_random_uuid();
 ALTER TABLE public.user_permissions ADD COLUMN permission_id uuid,ADD COLUMN is_active boolean DEFAULT true,ADD COLUMN status text DEFAULT 'active';ALTER TABLE public.user_roles ADD COLUMN is_active boolean DEFAULT true,ADD COLUMN status text DEFAULT 'active';ALTER TABLE public.roles ADD COLUMN is_active boolean DEFAULT true;ALTER TABLE public.role_permissions ADD COLUMN permission_key text,ADD COLUMN effect text DEFAULT 'allow';
 ALTER TABLE public.metering_points ADD COLUMN customer_site_id uuid,ADD COLUMN product_direction text;ALTER TABLE public.customer_sites ADD COLUMN grid_owner_id uuid;
 ALTER TABLE public.customer_contracts ADD COLUMN signature_snapshot jsonb,ADD COLUMN signature_snapshot_sha256 text,ADD COLUMN document_sha256 text,ADD COLUMN energy_direction text;
 CREATE TABLE public.customer_contract_documents(id uuid PRIMARY KEY,company_id uuid,customer_contract_id uuid,document_type text,document_sha256 text,verified_at timestamptz);
 CREATE TABLE public.grid_owners(id uuid PRIMARY KEY,company_id uuid,ediel_id text,environment text,is_active boolean);
 CREATE TABLE public.platform_actor_identifiers(id uuid PRIMARY KEY,actor_id uuid,identifier_type text,identifier_value text,is_verified boolean,valid_from date,valid_to date);
 CREATE TABLE public.tenant_bilateral_agreements(id uuid PRIMARY KEY,company_id uuid,environment text,counterparty_actor_id uuid,capability_code text,terms jsonb,is_enabled boolean,valid_from timestamptz,valid_to timestamptz,source_reference text);
 DROP TABLE gridex_received_sources.regulated_supply_ground_versions;
 CREATE SCHEMA gridex_ediel_ack_replay;CREATE SCHEMA gridex_requested_changes;CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_service_administration;
 CREATE TABLE public.tenant_counterparty_relations(id uuid);CREATE TABLE public.ediel_service_assignments(id uuid);CREATE TABLE public.ediel_service_evidence(id uuid);CREATE TABLE public.ediel_data_access_grants(id uuid);CREATE TABLE public.ediel_assignment_permission_links(id uuid);CREATE TABLE public.metering_permissions(id uuid);CREATE TABLE public.metering_permission_sites(id uuid);CREATE TABLE public.ediel_ack_transaction_results(id uuid);CREATE TABLE public.meter_reading_series(id uuid);CREATE TABLE gridex_utilts_binding.receipts(id uuid);CREATE TABLE gridex_utilts_binding.contracts(id uuid);CREATE TABLE gridex_service_administration.scope_versions(id uuid);CREATE TABLE gridex_received_sources.permission_transitions(id uuid);`)
 const grounds=migration('20260930161624_ediel_supply_market_source_lifecycle.sql');await db.exec(grounds.slice(grounds.indexOf('CREATE TABLE gridex_received_sources.regulated_supply_ground_versions'),grounds.indexOf('-- No approval API')))
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.permission_transition_immutable_v1','gridex_received_sources.permission_time_v1','gridex_received_sources.permission_date_v1'])await db.exec(fn('20260930144205_ediel_permission_source_atomic_transitions.sql',name))
 await db.exec(fn('20260930161624_ediel_supply_market_source_lifecycle.sql','gridex_received_sources.supply_wire_v1'))
 await db.exec(fn('20260930174333_ediel_production_contract_source_commands.sql','gridex_received_sources.production_contract_hash_v1'))
 await db.exec('CREATE FUNCTION gridex_ediel_transport.accepted_source_basis_v1(public.ediel_messages) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;')
 await db.exec(migration('20260930201111_ediel_normal_switch_source_atomic_confirmation.sql'))
 await db.exec(fn('20260930231958_ediel_atomic_ack_owner_persistence.sql','gridex_ediel_ack_replay.lock_current_graph_v2'))
 await db.exec(fn('20260930232100_ediel_requested_change_source_intake_and_review.sql','gridex_requested_changes.receipt_hmac_sha256_v1'))
 await db.exec(fn('20260930181909_ediel_source_consumer_authority_bridges.sql','public.ediel_apply_supply_source_v1').replace('CREATE FUNCTION public.ediel_apply_supply_source_v1','CREATE OR REPLACE FUNCTION gridex_received_sources.apply_supply_before_normal_switch_v1'))
 await db.exec(migration('20261001004331_ediel_regulated_supply_ground_archive_review.sql'));checks++
 // Actual original immutability guard, never a mutable private ground seed.
 await db.exec(fn('20260930181909_ediel_source_consumer_authority_bridges.sql','gridex_received_sources.regulated_ground_immutable_v1'))
 await db.exec('CREATE TRIGGER ground_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.regulated_supply_ground_versions FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.regulated_ground_immutable_v1();')
 const signature={company_id:id(1),customer_id:id(4),contract_id:id(7)},document=Buffer.from('%PDF-Synthetic declared fixture original'),documentHash=createHash('sha256').update(document).digest('hex')
 await db.query("INSERT INTO companies VALUES($1,'active')",[id(1)]);await db.query('INSERT INTO auth.users(id) VALUES($1),($2)',[id(2),id(3)])
 await db.query("INSERT INTO user_profiles VALUES($1,'active'),($2,'active')",[id(2),id(3)])
 await db.query("INSERT INTO company_memberships VALUES($1,$2,'active',true,now()),($1,$3,'active',true,now())",[id(1),id(2),id(3)])
 for(const actor of [id(2),id(3)])for(const permission of ['communication.read','communication.write','metering.read','metering.write','contracts.read',...(actor===id(3)?['ediel.regulated_supply.review']:[])]){
  await db.query('INSERT INTO permissions(key) VALUES($1) ON CONFLICT(key) DO NOTHING',[permission]);await db.query("INSERT INTO user_permissions(id,user_id,company_id,permission_key,effect) VALUES(gen_random_uuid(),$1,$2,$3,'allow')",[actor,id(1),permission])
 }
 await db.query('INSERT INTO customers VALUES($1,$2,NULL,$3)',[id(4),id(1),'199001011234'])
 await db.query('INSERT INTO customer_sites VALUES($1,$2,$3,$4)',[id(5),id(1),id(4),id(8)])
 await db.query("INSERT INTO grid_owners VALUES($1,$2,'54321','test',true)",[id(8),id(1)])
 await db.query("INSERT INTO metering_points VALUES($1,$2,$3,$4,'735123456789012345','54321','TES',$4,'consumption')",[id(6),id(1),id(4),id(5)])
 await db.query("INSERT INTO customer_contracts VALUES($1,$2,$3,$4,'signed','1','1',now(),'{}',$5,encode(sha256(convert_to($5::jsonb::text,'UTF8')),'hex'),$6,'consumption')",[id(7),id(1),id(4),id(6),signature,documentHash])
 await db.query("INSERT INTO customer_contract_documents VALUES($1,$2,$3,'signed_contract_pdf',$4,now())",[id(9),id(1),id(7),documentHash])
 await db.query("INSERT INTO tenant_ediel_profiles VALUES($1,$2,'test','electricity',true,'2000-01-01',NULL)",[id(10),id(1)])
 await db.query("INSERT INTO tenant_actor_roles VALUES($1,$2,'test',$3,'electricity_supplier','2000-01-01',NULL)",[id(11),id(1),id(2)])
 await db.query("INSERT INTO tenant_actor_identifiers VALUES($1,$2,'test',$3,'EdielId','12345','2000-01-01',NULL)",[id(12),id(1),id(2)])
 await db.query("INSERT INTO platform_actor_identifiers VALUES($1,$2,'EdielId','54321',true,'2000-01-01',NULL)",[id(13),id(14)])
 await db.exec(`CREATE TABLE public.ediel_rule_packs(id uuid PRIMARY KEY,family text,market text,status text,valid_from date,valid_to date,guide_version text,guide_revision text,source_hash text);
 CREATE TABLE public.ediel_message_profiles(id uuid PRIMARY KEY,rule_pack_id uuid,message_code text,transaction_subtype text,profile_key text,direction text,profile jsonb,is_enabled boolean);
 CREATE TABLE public.ediel_segment_rules(id uuid,message_profile_id uuid,segment_tag text);CREATE TABLE public.ediel_field_rules(id uuid,message_profile_id uuid,segment_tag text,element_path text,classification text);CREATE TABLE public.ediel_rule_pack_sources(id uuid,rule_pack_id uuid,source_hash text);CREATE TABLE public.ediel_ack_rules(id uuid,rule_pack_id uuid,inbound_family text,message_code text);
 ALTER TABLE public.ediel_messages ADD COLUMN rule_profile_version_id uuid,ADD COLUMN canonical_rule_pack_id uuid,ADD COLUMN rule_pack_checksum text;
 ALTER TABLE gridex_received_sources.sources ADD COLUMN raw_payload text;
 CREATE FUNCTION public.ediel_require_source_bytes_available_v1(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM public.ediel_messages WHERE company_id=$1 AND id=$2 AND raw_payload IS NOT NULL) THEN RAISE EXCEPTION 'declared_original_bytes_absent';END IF;END$$;`)
 await db.exec(migration('20261001013034_ediel_bilateral_prodat_archived_profile_review.sql'));checks++
 await db.query("INSERT INTO user_permissions(id,user_id,company_id,permission_key,effect) VALUES(gen_random_uuid(),$1,$2,'ediel.bilateral_profile.review','allow')",[id(3),id(1)])
 await db.query("INSERT INTO tenant_bilateral_agreements VALUES($1,$2,'test',$3,'PRODAT:BILATERAL:normal_start_h','{}',true,'2000-01-01','2100-01-01','SYNTHETIC P16 ORIGINAL')",[id(15),id(1),id(14)])
 await db.query("INSERT INTO ediel_rule_packs VALUES($1,'PRODAT','electricity','active','2000-01-01',NULL,'26.A','3',$2)",[id(20),'e'.repeat(64)])
 for(const [n,code,direction]of [[21,'Z03','outbound'],[22,'Z04','inbound']]){
  await db.query("INSERT INTO ediel_message_profiles VALUES($1,$2,$3,'H',$4,$5,'{}',true)",[id(n),id(20),code,`PRODAT:${code}:H:26.A:r3`,direction])
  await db.query("INSERT INTO ediel_field_rules VALUES($1,$2,'CCI','Z13','R')",[id(n+100),id(n)])
  await db.query("INSERT INTO ediel_segment_rules VALUES($1,$2,'LIN')",[id(n+200),id(n)])
  await db.query("INSERT INTO ediel_ack_rules VALUES($1,$2,'PRODAT',$3)",[id(n+300),id(20),code])
 }
 await db.query('INSERT INTO ediel_rule_pack_sources VALUES($1,$2,$3)',[id(23),id(20),'f'.repeat(64)])
 const mixed=migration('20260930224726_ediel_prodat_mixed_own_object_processing.sql');await db.exec(mixed.slice(mixed.indexOf('CREATE TABLE gridex_received_sources.prodat_object_validation_facets'),mixed.indexOf('CREATE TABLE gridex_received_sources.prodat_mixed_object_receipts')));
 await db.exec(migration('20261001020013_ediel_bilateral_positive_source_and_ack_authority_receipts.sql'));checks++
 const selector={environment:'test',kind:'normal_start_h',rulePackId:id(20),bilateralAgreementId:id(15),gridAreaCode:'TES',validFrom:'2026-01-01T00:00:00Z',validTo:'2099-01-01T00:00:00Z'}
 const scoped=await run('ediel_bilateral_prodat_ground_scope_v1',[id(1),id(2),selector]);assert.equal(scoped.status,'scoped');checks++
 const submission={...selector,source:{bytesBase64:document.toString('base64'),mimeType:'application/pdf',reference:'SYNTHETIC P16 ORIGINAL',version:'1'}}
 const unsigned=await run('ediel_archive_bilateral_prodat_ground_v1',[id(1),id(2),submission]),review={sourceHash:unsigned.sourceHash,scopeHash:unsigned.scopeHash,decision:'approve',reason:'Separate original reviewed'}
 assert.equal((await run('ediel_review_bilateral_prodat_ground_v1',[id(1),id(3),unsigned.artifactId,review])).status,'held');checks++
 const key=Buffer.from('SYNTHETIC bilateral issuer protected verifier boundary only')
 await db.query("INSERT INTO gridex_bilateral_prodat.issuer_keys VALUES($1,$2,'test','SYNTHETIC','NOT REAL LEGAL CLAIM',$3,$4,'2000-01-01','2100-01-01')",[id(16),id(1),'a'.repeat(64),key])
 await db.query("INSERT INTO gridex_bilateral_prodat.issuer_representations VALUES($1,$2,'test',$3,$4,$5,'TES','normal_start_h',$6,'SYNTHETIC REPRESENTATION NOT LEGAL CLAIM',$7,'2000-01-01','2100-01-01')",[id(17),id(1),id(16),id(2),id(14),id(15),'b'.repeat(64)])
 const payload=Buffer.from(JSON.stringify({format:'ediel_bilateral_prodat_ground_receipt_v1',issuerCode:'SYNTHETIC',receiptId:'DECLARED',companyId:id(1),environment:'test',scope:scoped.scope,sourceHash:unsigned.sourceHash,sourceReference:submission.source.reference,sourceVersion:'1',legalDecisionReference:'SYNTHETIC bilateral normal-start profile; not real approval',issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:'2100-01-01T00:00:00Z'})),signed={...submission,issuerReceipt:{keyId:id(16),representationId:id(17),payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}}
 const artifact=await run('ediel_archive_bilateral_prodat_ground_v1',[id(1),id(2),signed]),approved=await run('ediel_review_bilateral_prodat_ground_v1',[id(1),id(3),artifact.artifactId,{...review,sourceHash:artifact.sourceHash,scopeHash:artifact.scopeHash}]);assert.equal(approved.status,'authorized');checks++
 const current=async()=>(await db.query('SELECT gridex_bilateral_prodat.ground_current_v1($1,$2,now()) b',[approved.profileVersionId,id(1)])).rows[0].b
 assert.equal(await current(),true);checks++
 assert.deepEqual((await db.query("SELECT jsonb_build_object('profiles',(SELECT count(*) FROM gridex_bilateral_prodat.profile_versions),'origins',(SELECT count(*) FROM gridex_bilateral_prodat.origins),'market',(SELECT count(*) FROM public.customer_supply_periods),'switches',(SELECT count(*) FROM supplier_switch_requests)) b")).rows[0].b,{profiles:1,origins:1,market:0,switches:0});checks++
 await assert.rejects(run('ediel_review_bilateral_prodat_ground_v1',[id(1),id(2),artifact.artifactId,review]),/actor_forbidden|separate_reviewer/);checks++
 await db.query("UPDATE user_permissions SET effect='deny' WHERE user_id=$1 AND permission_key='ediel.bilateral_profile.review'",[id(3)]);assert.equal(await current(),false);checks++
 await db.query("UPDATE user_permissions SET effect='allow' WHERE user_id=$1 AND permission_key='ediel.bilateral_profile.review'",[id(3)]);assert.equal(await current(),true);checks++
 await db.query("UPDATE ediel_field_rules SET classification='X' WHERE message_profile_id=$1",[id(22)]);assert.equal(await current(),false);checks++
 await db.query("UPDATE ediel_field_rules SET classification='R' WHERE message_profile_id=$1",[id(22)]);assert.equal(await current(),true);checks++
 assert.equal((await db.query('SELECT gridex_bilateral_prodat.recorded_profile_authority_v1($1,$2) b',[approved.profileVersionId,id(1)])).rows[0].b,true);checks++
 await db.query("UPDATE ediel_field_rules SET classification='X' WHERE message_profile_id=$1",[id(22)]);assert.equal((await db.query('SELECT gridex_bilateral_prodat.recorded_profile_authority_v1($1,$2) b',[approved.profileVersionId,id(1)])).rows[0].b,true);checks++
 await db.query("UPDATE ediel_field_rules SET classification='R' WHERE message_profile_id=$1",[id(22)]);
 // Source policy capability is actual SQL, over explicitly synthetic legal/
 // rule admission. Absence of committed own effects still forbids ERC100.
 const sourceRaw="UNB+UNOC:3+54321:14+12345:14+261001:1200+I++23-DDQ-PRODAT'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+DOC+9'NAD+FR+54321:160:SVK'NAD+DO+12345:160:SVK'LIN+1++735123456789012345:::9'CCI++Z13'CAV+Z25'RFF+LI:H-OWN'RFF+Z05:TES'NAD+UD+199001011234:SE1:260'DTM+92:202610011200:203'UNT+13+M'UNZ+1+I'",sourceHash=createHash('sha256').update(sourceRaw).digest('hex');
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,message_received_at,rule_profile_version_id,canonical_rule_pack_id,rule_pack_checksum) VALUES($1,$2,'test','inbound','edifact','PRODAT','Z04',$3,clock_timestamp(),$4,$5,$6)",[id(40),id(1),sourceRaw,id(22),id(20),'e'.repeat(64)]);
 await db.query("INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,payload_hash,raw_payload) VALUES($1,$2,'test',$3,$4)",[id(40),id(1),sourceHash,sourceRaw]);
 await db.query('INSERT INTO legal_context_fixture VALUES($1,$2)',[id(40),{companyId:id(1),family:'PRODAT',code:'Z04',actorRole:'electricity_supplier',legalActorId:id(2),legalEdielId:'12345'}]);
 const sourceCapability=await run('ediel_read_prodat_bilateral_source_capability_v1',[id(1),id(40)]);assert.equal(sourceCapability.owner,'immutable-bilateral-prodat-profile-v1');assert.equal(sourceCapability.sourcePayloadHash,sourceHash);assert.equal(sourceCapability.objects[0].profileVersionId,approved.profileVersionId);checks++;
 await assert.rejects(run('ediel_require_prodat_bilateral_positive_source_v1',[id(1),id(40)]),/positive_source_unqualified/);assert.equal((await db.query('SELECT count(*)::int n FROM gridex_bilateral_prodat.source_capability_receipts')).rows[0].n,0);checks++;
 await assert.rejects(run('ediel_require_recorded_prodat_bilateral_ack_source_v1',[id(1),id(40),sourceHash]),/recorded_source_authority_required/);checks++;
 // Explicit finite business/canonical fixture boundary ONLY. The positive RPC
 // itself is real; a genuine native source/business chain remains mandatory.
 const own=(await db.query('SELECT gridex_received_sources.normal_switch_wire_v1($1) b',[sourceRaw])).rows[0].b.objects[0],facts={syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',registerValidation:{owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only'}},full={version:1,owner:'canonical-full-prodat-object-validation-v1',coverage:'full_canonical_guide_objects_only',sharedAccepted:true,objects:[{objectId:own.point,identityAgency:own.identityAgency,firstLineIndex:0,lineItemReference:own.li,disposition:'accepted'}]};
 await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,$3,'test',$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'),NULL)",[id(41),id(40),id(1),sourceHash,JSON.stringify(facts)]);
 await db.query("INSERT INTO gridex_received_sources.prodat_object_validation_facets(assessment_id,company_id,environment,source_message_id,source_payload_hash,facts_text,facts_hash) VALUES($1,$2,'test',$3,$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'))",[id(41),id(1),id(40),sourceHash,JSON.stringify(full)]);
 await db.query("INSERT INTO customer_supply_periods(id,company_id,customer_id,metering_point_id,source_message_id,status,market_start_at,market_state_version) VALUES($1,$2,$3,$4,$5,'confirmed_by_grid_owner',gridex_received_sources.permission_time_v1($6),1)",[id(42),id(1),id(4),id(6),id(40),own.start]);
 const period=(await db.query('SELECT to_jsonb(p) b FROM customer_supply_periods p WHERE id=$1',[id(42)])).rows[0].b;
 await db.query("INSERT INTO gridex_received_sources.supply_source_transitions VALUES($1,$2,$3,'Z04',$4,'[]',$5,'{}',$6)",[id(40),id(1),sourceHash,[own],[period],id(2)]);
 await assert.rejects(run('ediel_require_prodat_bilateral_positive_source_v1',[id(1),id(40)]),/positive_source_unqualified/);checks++;
 await db.query("INSERT INTO supplier_switch_requests(id,company_id) VALUES($1,$2)",[id(43),id(1)]);await db.query("INSERT INTO ediel_messages(id,company_id) VALUES($1,$2)",[id(44),id(1)]);
 await db.query("INSERT INTO gridex_received_sources.normal_switch_confirmations(source_message_id,period_id,company_id,switch_id,original_message_id,original_payload_hash,contract_id,protected_contract_hash,source_object,legal_context,market_start_at,confirmed_period,confirmed_switch) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,'{}',gridex_received_sources.permission_time_v1($9),$10,'{}')",[id(40),id(42),id(1),id(43),id(44),'d'.repeat(64),id(7),own,own.start,period]);
 await db.exec(`ALTER TABLE gridex_bilateral_prodat.source_capability_receipts ADD CONSTRAINT declared_last_receipt_failure CHECK(company_id<>'${id(1)}'::uuid) NOT VALID`);
 await assert.rejects(run('ediel_require_prodat_bilateral_positive_source_v1',[id(1),id(40)]),/declared_last_receipt_failure/);assert.equal((await db.query('SELECT count(*)::int n FROM gridex_bilateral_prodat.source_capability_receipts')).rows[0].n,0);checks++;
 await db.exec('ALTER TABLE gridex_bilateral_prodat.source_capability_receipts DROP CONSTRAINT declared_last_receipt_failure');
 await run('ediel_require_prodat_bilateral_positive_source_v1',[id(1),id(40)]);assert.equal((await db.query('SELECT count(*)::int n FROM gridex_bilateral_prodat.source_capability_receipts')).rows[0].n,1);checks++;
 await run('ediel_require_prodat_bilateral_positive_source_v1',[id(1),id(40)]);assert.equal((await db.query('SELECT count(*)::int n FROM gridex_bilateral_prodat.source_capability_receipts')).rows[0].n,1);checks++;
 await assert.rejects(run('ediel_require_recorded_prodat_bilateral_ack_source_v1',[id(1),id(40),'a'.repeat(64)]),/recorded_source_authority_required/);checks++;
 await db.query("UPDATE ediel_field_rules SET classification='X' WHERE message_profile_id=$1",[id(22)]);await run('ediel_require_recorded_prodat_bilateral_ack_source_v1',[id(1),id(40),sourceHash]);checks++;
 await db.query("UPDATE ediel_field_rules SET classification='R' WHERE message_profile_id=$1",[id(22)]);

 assert.equal(await run('ediel_read_prodat_bilateral_source_capability_v1',[id(999),id(40)]),null);checks++;

 // Mixed native receipt uses ONLY the actually committed positive scope. The
 // rejected unknown sibling has no private profile/period/positive receipt.
 const mixedRaw=sourceRaw.replace("UNT+13+M", "LIN+2++735123456789012352:::9'CCI++Z13'CAV+Z25'RFF+LI:REJECTED-OWN'RFF+Z05:TES'DTM+92:202610011200:203'UNT+19+M"),mixedHash=createHash('sha256').update(mixedRaw).digest('hex');
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,message_received_at,rule_profile_version_id,canonical_rule_pack_id,rule_pack_checksum) VALUES($1,$2,'test','inbound','edifact','PRODAT','Z04',$3,clock_timestamp(),$4,$5,$6)",[id(50),id(1),mixedRaw,id(22),id(20),'e'.repeat(64)]);
 await db.query("INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,payload_hash,raw_payload) VALUES($1,$2,'test',$3,$4)",[id(50),id(1),mixedHash,mixedRaw]);await db.query('INSERT INTO legal_context_fixture VALUES($1,$2)',[id(50),{companyId:id(1),family:'PRODAT',code:'Z04',actorRole:'electricity_supplier',legalActorId:id(2),legalEdielId:'12345'}]);
 assert.equal(await run('ediel_read_prodat_bilateral_source_capability_v1',[id(1),id(50)]),null);checks++;
 const mixedFull={...full,objects:[...full.objects,{objectId:'735123456789012352',identityAgency:'9',firstLineIndex:1,lineItemReference:'REJECTED-OWN',disposition:'rejected'}]};
 await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,$3,'test',$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'),NULL)",[id(51),id(50),id(1),mixedHash,JSON.stringify({...facts,applicationDecision:'rejected'})]);
 await db.query("INSERT INTO gridex_received_sources.prodat_object_validation_facets(assessment_id,company_id,environment,source_message_id,source_payload_hash,facts_text,facts_hash) VALUES($1,$2,'test',$3,$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'))",[id(51),id(1),id(50),mixedHash,JSON.stringify(mixedFull)]);
 await db.query("INSERT INTO customer_supply_periods(id,company_id,customer_id,metering_point_id,source_message_id,status,market_start_at,market_state_version) VALUES($1,$2,$3,$4,$5,'confirmed_by_grid_owner',gridex_received_sources.permission_time_v1($6),1)",[id(52),id(1),id(4),id(6),id(50),own.start]);
 const mixedPeriod=(await db.query('SELECT to_jsonb(p) b FROM customer_supply_periods p WHERE id=$1',[id(52)])).rows[0].b;
 await db.query("INSERT INTO gridex_received_sources.supply_source_transitions VALUES($1,$2,$3,'Z04',$4,'[]',$5,'{}',$6)",[id(50),id(1),mixedHash,[own],[mixedPeriod],id(2)]);
 await db.query("INSERT INTO supplier_switch_requests(id,company_id) VALUES($1,$2)",[id(53),id(1)]);
 await db.query("INSERT INTO gridex_received_sources.normal_switch_confirmations(source_message_id,period_id,company_id,switch_id,original_message_id,original_payload_hash,contract_id,protected_contract_hash,source_object,legal_context,market_start_at,confirmed_period,confirmed_switch) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$8,'{}',gridex_received_sources.permission_time_v1($9),$10,'{}')",[id(50),id(52),id(1),id(53),id(44),'d'.repeat(64),id(7),own,own.start,mixedPeriod]);
 await run('ediel_require_prodat_bilateral_positive_source_v1',[id(1),id(50)]);
 const mixedReceipt=(await db.query('SELECT positive_objects b FROM gridex_bilateral_prodat.source_capability_receipts WHERE source_message_id=$1',[id(50)])).rows[0].b;
 assert.equal(mixedReceipt.length,1);assert.equal(mixedReceipt[0].objectId,own.point);assert.equal(mixedReceipt[0].lineItemReference,'H-OWN');checks++;
 await db.query("INSERT INTO gridex_bilateral_prodat.issuer_revocations VALUES('representation',$1,'DECLARED REVOKE',$2,now())",[id(17),'c'.repeat(64)]);assert.equal(await current(),false);checks++
 await assert.rejects(run('ediel_require_recorded_prodat_bilateral_ack_source_v1',[id(1),id(40),sourceHash]),/recorded_source_authority_required/);checks++
 assert.equal((await run('ediel_read_bilateral_prodat_ground_v1',[id(1),id(2),artifact.artifactId,false])).status,'held');checks++
 await assert.rejects(db.exec('SET ROLE service_role;INSERT INTO gridex_bilateral_prodat.profile_versions DEFAULT VALUES'),/permission denied/);await db.exec('RESET ROLE');checks++
 console.log(JSON.stringify({status:'PASS',checks,scope:'complete prospective profile producer SQL mechanics only',native:'NOT_RUN',bilateralNormativeApproval:'NOT_CLAIMED'}))
}finally{await db.close()}
