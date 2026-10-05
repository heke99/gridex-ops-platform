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
 await db.query("INSERT INTO tenant_bilateral_agreements VALUES($1,$2,'test',$3,'PRODAT:Z04:A','{}',true,'2000-01-01','2100-01-01','REGULATORY-ORIGINAL')",[id(15),id(1),id(14)])
 const selector={environment:'test',kind:'assigned_supply',contractId:id(7),meteringPointId:id(6),identityAgency:'9',bilateralAgreementId:id(15),startAt:'2099-01-01T00:00:00Z'}
 const scoped=await run('ediel_regulated_supply_ground_scope_v1',[id(1),id(2),selector]);assert.equal(scoped.status,'scoped');checks++
 const submission={...selector,source:{bytesBase64:document.toString('base64'),mimeType:'application/pdf',reference:'REGULATORY-ORIGINAL',version:'1'}}
 const archive=await run('ediel_archive_regulated_supply_ground_v1',[id(1),id(2),submission]);assert.equal(archive.status,'archived');checks++
 const review={sourceHash:archive.sourceHash,scopeHash:archive.scopeHash,decision:'approve',reason:'Separate declared source review'}
 await assert.rejects(run('ediel_review_regulated_supply_ground_v1',[id(1),id(2),archive.artifactId,review]),/actor_forbidden|separate_reviewer/);checks++
 assert.equal((await run('ediel_review_regulated_supply_ground_v1',[id(1),id(3),archive.artifactId,review])).status,'held');checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.regulated_supply_ground_versions')).rows[0].n,0);checks++
 await assert.rejects(run('ediel_archive_regulated_supply_ground_v1',[id(1),id(2),{...submission,approved:true}]),/shape_required/);checks++
 await assert.rejects(run('ediel_archive_regulated_supply_ground_v1',[id(1),id(2),{...submission,source:{...submission.source,reference:'OTHER'}}]),/actual_bytes_reference/);checks++
 // ONLY trusted issuer configuration is an explicit synthetic boundary. The
 // artifact/review/ground/origin are always produced by actual public owners.
 const key=Buffer.from('synthetic-test-key-only-at-trusted-issuer-boundary')
 await db.query("INSERT INTO gridex_regulated_supply.issuer_keys VALUES($1,$2,'test','SYNTHETIC','NOT REAL LEGAL CLAIM',$3,$4,'2000-01-01','2100-01-01')",[id(16),id(1),'a'.repeat(64),key])
 await db.query("INSERT INTO gridex_regulated_supply.issuer_representations VALUES($1,$2,'test',$3,$4,$5,'TES','assigned_supply',$6,'SYNTHETIC REPRESENTATION NOT LEGAL CLAIM',$7,'2000-01-01','2100-01-01')",[id(17),id(1),id(16),id(2),id(14),id(15),'b'.repeat(64)])
 const payload=Buffer.from(JSON.stringify({format:'ediel_regulated_supply_ground_receipt_v1',issuerCode:'SYNTHETIC',receiptId:'DECLARED',companyId:id(1),environment:'test',scope:scoped.scope,sourceHash:archive.sourceHash,sourceReference:submission.source.reference,sourceVersion:'1',legalDecisionReference:'DECLARED NOT LEGAL CLAIM',issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:'2100-01-01T00:00:00Z'}))
 const signed={...submission,issuerReceipt:{keyId:id(16),representationId:id(17),payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}}
 const acceptedArchive=await run('ediel_archive_regulated_supply_ground_v1',[id(1),id(2),signed]);const acceptedReview={...review,sourceHash:acceptedArchive.sourceHash,scopeHash:acceptedArchive.scopeHash}
 const approved=await run('ediel_review_regulated_supply_ground_v1',[id(1),id(3),acceptedArchive.artifactId,acceptedReview]);assert.equal(approved.status,'authorized');checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_regulated_supply.origins')).rows[0].n,1);checks++
 // Abort on the final origin write: review and actual ground must roll back together.
 const version2Payload=Buffer.from(JSON.stringify({...JSON.parse(payload.toString()),sourceVersion:'2'})),version2=await run('ediel_archive_regulated_supply_ground_v1',[id(1),id(2),{...signed,source:{...signed.source,version:'2'},issuerReceipt:{...signed.issuerReceipt,payloadBase64:version2Payload.toString('base64'),signatureHex:createHmac('sha256',key).update(version2Payload).digest('hex')}}]);
 const atomicCounts=async()=>(await db.query("SELECT jsonb_build_object('reviews',(SELECT count(*) FROM gridex_regulated_supply.reviews),'grounds',(SELECT count(*) FROM gridex_received_sources.regulated_supply_ground_versions),'origins',(SELECT count(*) FROM gridex_regulated_supply.origins)) b")).rows[0].b,atomicBefore=await atomicCounts()
 await db.exec("CREATE FUNCTION fixture_reject_origin() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'final_origin_write_failed';END$$;CREATE TRIGGER final_origin_failure BEFORE INSERT ON gridex_regulated_supply.origins FOR EACH ROW EXECUTE FUNCTION fixture_reject_origin();")
 await assert.rejects(run('ediel_review_regulated_supply_ground_v1',[id(1),id(3),version2.artifactId,{...review,sourceHash:version2.sourceHash,scopeHash:version2.scopeHash}]),/final_origin_write_failed/);checks++
 assert.deepEqual(await atomicCounts(),atomicBefore);checks++;await db.exec('DROP TRIGGER final_origin_failure ON gridex_regulated_supply.origins;DROP FUNCTION fixture_reject_origin()')
 const current=async()=>(await db.query('SELECT gridex_regulated_supply.ground_current_v1($1,$2,$3,$4) b',[approved.groundId,id(1),id(6),selector.startAt])).rows[0].b
 assert.equal(await current(),true);checks++
 assert.equal((await run('ediel_review_regulated_supply_ground_v1',[id(1),id(3),acceptedArchive.artifactId,acceptedReview])).groundId,approved.groundId);checks++
 const downloaded=await run('ediel_read_regulated_supply_ground_v1',[id(1),id(2),acceptedArchive.artifactId,true]);assert.equal(downloaded.sourceHash,documentHash);assert.equal(Buffer.from(downloaded.bytesBase64,'base64').equals(document),true);checks++
 await assert.rejects(run('ediel_read_regulated_supply_ground_v1',[id(999),id(2),acceptedArchive.artifactId,true]),/read_forbidden/);checks++
 await assert.rejects(db.exec("UPDATE gridex_regulated_supply.artifacts SET source_bytes=decode('01','hex')"),/immutable/);checks++
 await assert.rejects(db.exec('DELETE FROM gridex_regulated_supply.origins'),/immutable/);checks++
 await assert.rejects(db.exec('SET ROLE service_role;INSERT INTO gridex_regulated_supply.issuer_keys DEFAULT VALUES;'),/permission denied/);await db.exec('RESET ROLE');checks++
 await db.query("UPDATE user_permissions SET effect='deny' WHERE user_id=$1 AND permission_key='ediel.regulated_supply.review'",[id(3)]);assert.equal(await current(),false);checks++
 await db.query("UPDATE user_permissions SET effect='allow' WHERE user_id=$1 AND permission_key='ediel.regulated_supply.review'",[id(3)]);assert.equal(await current(),true);checks++
 await db.query("UPDATE tenant_bilateral_agreements SET is_enabled=false WHERE id=$1",[id(15)]);assert.equal(await current(),false);checks++;await db.query('UPDATE tenant_bilateral_agreements SET is_enabled=true WHERE id=$1',[id(15)])
 await db.query('UPDATE metering_points SET grid_area_code=$1 WHERE id=$2',['OTHER',id(6)]);assert.equal(await current(),false);checks++;await db.query('UPDATE metering_points SET grid_area_code=$1 WHERE id=$2',['TES',id(6)])
 // A source-qualified actual regulated consumer, no ordinary Z03 authority.
 const source=id(30),wire=["UNB+UNOC:3+54321:14+12345:14+261001:1200+I++23-DDQ-PRODAT","UNH+M+PRODAT:D:97A:UN:E2SE6A","BGM+Z04+DOC+9","NAD+FR+54321:160:SVK","NAD+DO+12345:160:SVK","LIN+1++735123456789012345:::9","CCI++Z13","CAV+Z26","RFF+LI:OWN-ASSIGNED","RFF+Z05:TES","NAD+UD+199001011234:SE2:260","DTM+92:209901010100:203","UNT+12+M","UNZ+1+I"].join("'")+"'"
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_received_at,customer_id,metering_point_id) VALUES($1,$2,'test','inbound','edifact','PRODAT','Z04',$3,'received',clock_timestamp(),$4,$5)",[source,id(1),wire,id(4),id(6)])
 await db.query('INSERT INTO legal_context_fixture VALUES($1,$2)',[source,{companyId:id(1),family:'PRODAT',code:'Z04',actorRole:'electricity_supplier',legalActorId:id(2),legalEdielId:'12345'}])
 const facts=JSON.stringify({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',reasonCodes:[]})
 await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,encode(sha256(convert_to($5,'UTF8')),'hex'),NULL)",[id(31),source,id(1),wire,facts])
 const applied=await run('ediel_apply_supply_source_v1',[id(1),source,id(2)]);assert.equal(applied.applied,true);assert.equal(applied.regulated,true);assert.equal(applied.periods.length,1);assert.equal(applied.periods[0].status,'confirmed_by_grid_owner');assert.equal(applied.periods[0].metadata.sourceGroundId,approved.groundId);checks++
 const period=applied.periods[0].id,counts=async()=>(await db.query("SELECT jsonb_build_object('periods',(SELECT count(*) FROM customer_supply_periods),'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions),'switches',(SELECT count(*) FROM supplier_switch_requests),'acks',(SELECT count(*) FROM ediel_outbox)) b")).rows[0].b
 assert.deepEqual(await counts(),{periods:1,transitions:1,switches:0,acks:0});checks++
 assert.equal((await run('ediel_apply_supply_source_v1',[id(1),source,id(2)])).idempotent,true);checks++
 assert.equal((await db.query('SELECT gridex_received_sources.advance_supply_before_normal_switch_v1($1,$2,100) b',[id(1),id(2)])).rows[0].b.updated,0);checks++
 assert.equal((await db.query('SELECT status FROM customer_supply_periods WHERE id=$1',[period])).rows[0].status,'confirmed_by_grid_owner');checks++
 // A final immutable source-transition write failure must roll back market effects.
 // Existing source and period stay unchanged; this assertion catches partial writes.
 const duplicate=id(32);await db.query("INSERT INTO ediel_messages SELECT $1,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_sent_at,message_received_at,immutable_rendered_at,immutable_payload_hash,customer_id,metering_point_id,related_message_id FROM ediel_messages WHERE id=$2",[duplicate,source]);
 await db.query('INSERT INTO legal_context_fixture SELECT $1,basis FROM legal_context_fixture WHERE message_id=$2',[duplicate,source]);await db.query("INSERT INTO gridex_received_sources.validation_assessments SELECT $1,$2,company_id,environment,source_payload_hash,facts_text,facts_hash,NULL FROM gridex_received_sources.validation_assessments WHERE source_message_id=$3",[id(33),duplicate,source]);
 assert.equal((await run('ediel_apply_supply_source_v1',[id(1),duplicate,id(2)])).reason,'regulated_supply_conflicting_period');checks++;assert.deepEqual(await counts(),{periods:1,transitions:1,switches:0,acks:0});checks++
 await db.query("INSERT INTO gridex_regulated_supply.issuer_revocations VALUES('representation',$1,'DECLARED REVOCATION',$2,now())",[id(17),'c'.repeat(64)]);assert.equal(await current(),false);checks++
 assert.equal((await run('ediel_apply_supply_source_v1',[id(1),source,id(2)])).reason,'regulated_supply_current_ground_required');checks++
 assert.equal((await db.query("SELECT gridex_received_sources.supply_period_source_basis_v1($1,$2,$3::timestamptz,$3::timestamptz+interval '1 minute') b",[id(1),period,selector.startAt])).rows[0].b,null);checks++
 assert.deepEqual(await counts(),{periods:1,transitions:1,switches:0,acks:0});checks++
 assert.equal((await run('ediel_read_regulated_supply_ground_v1',[id(1),id(2),acceptedArchive.artifactId,false])).status,'held');checks++
 assert.equal((await run('ediel_regulated_supply_ground_scope_v1',[id(1),id(2),{...selector,kind:'production_receipt_obligation'}])).status,'held');checks++
 console.log(JSON.stringify({status:'PASS',checks,scope:'complete-forward-SQL bounded mechanics only',native:'NOT_RUN',legalIssuerAcceptance:'NOT_CLAIMED'}))
}finally{await db.close()}
