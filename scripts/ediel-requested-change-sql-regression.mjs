// Focused real SQL owner checks with synthetic boundary records. Not authentic
// source approvals, full Supabase replay/RLS or market traffic evidence.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {createHash,createHmac} from 'node:crypto'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const fn=(file,name)=>{const s=readFileSync(new URL(file,import.meta.url),'utf8'),start=s.indexOf(`CREATE FUNCTION ${name}`),end=s.indexOf('$$;',start);if(start<0||end<0)throw Error(name);return s.slice(start,end+3)}
const service=async(sql)=>{await db.exec('set role service_role');try{return await db.query(sql)}finally{await db.exec('reset role')}}
const quote=v=>`'${String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")}'`
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create schema gridex_received_sources;
 create table companies(id uuid primary key);create table customers(id uuid primary key,company_id uuid);create table user_profiles(id uuid primary key,user_status text);create table company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);create table permissions(actor uuid,company uuid,permission text,allowed bool);
 create function gridex_actor_has_company_permission(a uuid,c uuid,p text) returns bool language sql as $$select coalesce((select allowed from public.permissions where actor=a and company=c and permission=p),false)$$;
 create table customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,status text,contract_version text,signed_version text,signed_at timestamptz,version_snapshot jsonb);
 create table metering_points(id uuid primary key,company_id uuid,customer_id uuid,product_direction text,ediel_metering_point_id text,grid_owner_ediel_id text,grid_area_code text);
 create table customer_supply_periods(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,status text);
 create table tenant_ediel_profiles(id uuid primary key,company_id uuid,environment text,market text,is_enabled bool,valid_from timestamptz,valid_to timestamptz);create table tenant_actor_identifiers(id uuid primary key,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);create table tenant_actor_roles(id uuid primary key,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
 create table ediel_route_profiles(id uuid primary key,company_id uuid,environment text,is_enabled bool,is_active bool,sender_ediel_id text,receiver_ediel_id text,sender_sub_address text,receiver_sub_address text);
 create table communication_routes(id uuid primary key,company_id uuid,is_active bool);
 create table ediel_message_intents(id uuid primary key default gen_random_uuid(),company_id uuid,environment text,market text,message_family text,message_code text,business_process text,direction text,sender_ediel_id text,sender_subaddress text,receiver_ediel_id text,receiver_subaddress text,application_reference text,route_profile_id uuid,communication_route_id uuid,customer_id uuid,operation_id uuid,metering_point_id text,facility_id text,grid_area_code text,interchange_reference text,message_reference text,transaction_reference text,payload jsonb,idempotency_key text,created_by uuid,updated_by uuid,validation_status text,render_status text,outbox_status text,ediel_message_id uuid,outbound_request_id uuid);
 create table outbound_requests(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,metering_point_id uuid,communication_route_id uuid,request_type text,source_type text,source_id uuid,environment text,status text,channel_type text,payload jsonb,created_by uuid,updated_by uuid,operation_id uuid);
 create table ediel_messages(id uuid primary key,intent_id uuid,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,source_operation_id text,outbound_request_id uuid,customer_id uuid,metering_point_id uuid,raw_payload text,immutable_payload_hash text,status text,sender_ediel_id text,receiver_ediel_id text,sender_sub_address text,receiver_sub_address text,application_reference text,route_profile_id uuid,communication_route_id uuid);
 create table boundary_supply(id uuid primary key,company_id uuid,start_at timestamptz,end_at timestamptz,basis jsonb);
 create function gridex_received_sources.supply_period_source_basis_v1(c uuid,p uuid,s timestamptz,e timestamptz) returns jsonb language sql as $$select basis from public.boundary_supply where id=p and company_id=c and start_at<=s and (end_at is null or e<=end_at)$$;
 create schema gridex_ediel_transport;create schema gridex_outbound_dispatch;grant usage on schema gridex_ediel_transport,gridex_outbound_dispatch to service_role;create table provider_effects(lane text);
 create function gridex_ediel_transport.mutate_v1(i jsonb) returns jsonb language plpgsql security definer as $$begin if i->>'action' in('prepare','enter') then insert into public.provider_effects values('transport');return '{"proceed":true}';end if;return '{"proceed":false}';end$$;
 create function gridex_outbound_dispatch.mutate_v1(i jsonb) returns jsonb language plpgsql security definer as $$begin if i->>'action' in('prepare','enter') then insert into public.provider_effects values('dispatch');return '{"proceed":true,"scoped":true}';end if;return '{"proceed":false,"scoped":true}';end$$;`)
 await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql','gridex_received_sources.wire_tokens_bounded_v1'))
 await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql','gridex_received_sources.closure_wire_tokens_v2'))
 await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql','gridex_received_sources.permission_transition_immutable_v1'))
 await db.exec(fn('../supabase/migrations/20260930174333_ediel_production_contract_source_commands.sql','gridex_received_sources.production_contract_hash_v1'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930224540_ediel_source_bound_requested_changes.sql',import.meta.url),'utf8'))
 const read=(event=uid(8),company=uid(1),actor=uid(2))=>service(`select public.ediel_requested_change_source_v1('${company}','${event}','${actor}') b`)
 assert.equal((await read()).rows[0].b.status,'held')
 const identity={id:'199001019999',qualifier:'SE1',agency:'260'},address={lines:['TEST ROAD 1','',''],city:'TEST',postalCode:'12345',country:'SE',representation:{convention:'SOURCE',reference:'SYNTHETIC',mode:1}}
 const party={...identity,name:'SYNTHETIC CUSTOMER',addressLines:['TEST ROAD 1'],city:'TEST',postalCode:'12345',country:'SE'},invoicee={meteringPointId:'735999123456789012',identityAgency:'9',endUser:{identity,address},invoicee:{identity,nameLines:['SYNTHETIC CUSTOMER'],address,availability:'available'},event:{state:'none',reference:'SYNTHETIC'},source:{kind:'caller_selection',companyId:uid(1),reference:'SYNTHETIC'}}
 await db.exec(`insert into companies values('${uid(1)}');insert into auth.users values('${uid(2)}');insert into user_profiles values('${uid(2)}','active');insert into company_memberships values('${uid(1)}','${uid(2)}','active',true,now());insert into permissions values('${uid(2)}','${uid(1)}','communication.write',true),('${uid(2)}','${uid(1)}','communication.send',true);
 insert into customers values('${uid(3)}','${uid(1)}');insert into metering_points values('${uid(4)}','${uid(1)}','${uid(3)}','consumption','735999123456789012','54321','TES');insert into customer_contracts values('${uid(5)}','${uid(1)}','${uid(3)}','${uid(4)}','signed','1','1',now(),'{}');insert into customer_supply_periods values('${uid(6)}','${uid(1)}','${uid(3)}','${uid(4)}','active');
 insert into ediel_messages(id,company_id,environment,raw_payload) values('${uid(7)}','${uid(1)}','production',${quote("UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z04+SOURCE'LIN+1++735999123456789012:::9'NAD+Z02+99999:160:SVK'")});
 insert into boundary_supply values('${uid(6)}','${uid(1)}','2026-01-01',null,${quote({qualified:true,sourceMessageId:uid(7),initialSourceMessageId:uid(7),marketStateVersion:1,customerId:uid(3),meteringPointId:uid(4),legalActorId:uid(9),dsoEdielId:'54321',sourceObjects:[{point:'735999123456789012',identityAgency:'9'}]})});
 insert into tenant_ediel_profiles values('${uid(10)}','${uid(1)}','production','electricity',true,'2026-01-01',null);insert into tenant_actor_identifiers values('${uid(11)}','${uid(1)}','production','${uid(9)}','EdielId','12345','2026-01-01',null);insert into tenant_actor_roles values('${uid(12)}','${uid(1)}','production','${uid(9)}','electricity_supplier','2026-01-01',null);insert into communication_routes values('${uid(13)}','${uid(1)}',true);insert into ediel_route_profiles values('${uid(14)}','${uid(1)}','production',true,true,'12345','54321',null,null);`)
 const route={routeProfileId:uid(14),communicationRouteId:uid(13),senderEdielId:'12345',receiverEdielId:'54321',senderSubaddress:null,receiverSubaddress:null,applicationReference:'23-DDQ-PRODAT'}
 const originate=(event,r=route)=>service(`select public.ediel_originate_requested_change_v1('${uid(1)}','${event}','${uid(2)}',${quote(r)}) b`)
 const bound=[]
 for(const [n,variant,kind,reason,method] of [[20,'E','death','E34',null],[21,'F','quarter_contract','E64','Z04'],[22,'G','method_contract','E32','Z03']]){
  await db.exec(`insert into gridex_requested_changes.events(id,company_id,environment,supply_period_id,supply_source_message_id,supply_state_version,contract_id,protected_contract_hash,customer_id,metering_point_id,customer_snapshot_hash,legal_actor_id,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,brp_ediel_id,variant,event_kind,effective_at,customer_identity,invoicee_profile,source_reference,source_sha256,source_version,approved_by,approved_at)
  select '${uid(n)}','${uid(1)}','production','${uid(6)}','${uid(7)}',1,c.id,gridex_received_sources.production_contract_hash_v1(c),'${uid(3)}','${uid(4)}',encode(sha256(convert_to(to_jsonb(u)::text,'UTF8')),'hex'),'${uid(9)}','12345','54321','735999123456789012','9','TES','99999','${variant}','${kind}','2026-10-01T12:00Z',${quote(party)},${quote(invoicee)},'SYNTHETIC-${variant}','${'a'.repeat(64)}','1','${uid(2)}',now() from customer_contracts c cross join customers u where c.id='${uid(5)}' and u.id='${uid(3)}';`)
  assert.equal((await read(uid(n))).rows[0].b.status,'authorized')
  assert.equal((await read(uid(n),uid(99))).rows[0].b.status,'held')
  assert.equal((await originate(uid(n),{...route,receiverEdielId:'OTHER'})).rows[0].b.status,'held')
  const o=(await originate(uid(n))).rows[0].b
  assert.deepEqual((await originate(uid(n))).rows[0].b,o)
  const intent=(await db.query(`select * from ediel_message_intents where id='${o.intentId}'`)).rows[0],mid=uid(n+100)
  const wire=`UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z09+${intent.interchange_reference}'NAD+FR+12345:160:SVK'NAD+DO+54321:160:SVK'LIN+1++735999123456789012:::9'DTM+157:202610011300:203'CCI++Z13'CAV+${reason}'${variant==='E'?"CCI++Z17'CAV+Z41'":`CCI++Z04'CAV+${method}'`}RFF+LI:${intent.transaction_reference}'${variant==='E'?"NAD+UD+199001019999:SE1:260++SYNTHETIC CUSTOMER+TEST ROAD 1+TEST++12345+SE'":''}`
  await db.exec(`insert into ediel_messages(id,intent_id,company_id,environment,direction,message_standard,message_family,message_code,source_operation_id,outbound_request_id,customer_id,metering_point_id,raw_payload,sender_ediel_id,receiver_ediel_id,application_reference,route_profile_id,communication_route_id) values('${mid}','${o.intentId}','${uid(1)}','production','outbound','edifact','PRODAT','Z09','${uid(n)}','${o.outboundRequestId}','${uid(3)}','${uid(4)}',${quote(wire)},'12345','54321','23-DDQ-PRODAT','${uid(14)}','${uid(13)}')`)
  await service(`select public.ediel_require_requested_change_source_current_v1('${uid(1)}','${mid}')`)
  const actual=(await service(`select public.ediel_requested_change_message_basis_v1('${uid(1)}','${mid}','${uid(2)}') b`)).rows[0].b
  assert.equal(actual.basis.variant,variant);assert.equal(actual.messageId,mid)
  const count=(await db.query('select count(*)::int n from customer_supply_periods')).rows[0].n;assert.equal(count,1)
  await db.exec(`update ediel_messages set raw_payload=${quote(wire.replace('202610011300','202610021300'))} where id='${mid}'`)
  await assert.rejects(()=>service(`select public.ediel_require_requested_change_source_current_v1('${uid(1)}','${mid}')`),/effective_boundary_changed/)
  await db.exec(`update ediel_messages set raw_payload=${quote(wire)} where id='${mid}'`)
  bound.push({event:uid(n),mid})
 }
 assert.equal((await db.query('select count(*)::int n from ediel_message_intents')).rows[0].n,3)
 assert.equal((await db.query('select count(*)::int n from outbound_requests')).rows[0].n,3)
 for(const role of ['anon','authenticated','service_role']){
  await db.exec(`set role ${role}`)
  for(const statement of ["select * from gridex_requested_changes.events",`insert into gridex_requested_changes.revocations(event_id,source_reference,source_sha256,actor_user_id) values('${bound[0].event}','FORGED','${'b'.repeat(64)}','${uid(2)}')`])await assert.rejects(()=>db.exec(statement),/permission denied/)
  await db.exec('reset role')
 }
 await assert.rejects(()=>db.exec(`update gridex_requested_changes.events set source_version='2' where id='${bound[0].event}'`),/immutable/)
 await db.exec(`update permissions set allowed=false where permission='communication.send'`)
 await assert.rejects(()=>service(`select public.ediel_requested_change_message_basis_v1('${uid(1)}','${bound[0].mid}','${uid(2)}')`),/current_source_required/)
 await db.exec(`update permissions set allowed=true where permission='communication.send';insert into gridex_requested_changes.revocations(event_id,source_reference,source_sha256,actor_user_id) values('${bound[0].event}','SYNTHETIC-REVOCATION','${'b'.repeat(64)}','${uid(2)}')`)
 assert.equal((await read(bound[0].event)).rows[0].b.status,'held')
 for(const schema of ['gridex_ediel_transport','gridex_outbound_dispatch'])await assert.rejects(()=>service(`select ${schema}.mutate_v1(${quote({action:'enter',companyId:uid(1),messageId:bound[0].mid})})`),/current_source_required/)
 assert.equal((await db.query('select count(*)::int n from provider_effects')).rows[0].n,0)
 console.log('PASS focused SQL E/F/G originate+bind, idempotence, source/tenant/route/date/hash/permission/revocation, immutable private rows, both provider rollback boundaries (synthetic predecessor/supply records; not native replay)')
 await db.exec(`alter table permissions rename to boundary_permissions;create table permissions(id uuid default gen_random_uuid(),key text,name text,category text,description text,is_active bool default true);create or replace function gridex_actor_has_company_permission(a uuid,c uuid,p text) returns bool language sql as $$select coalesce((select allowed from public.boundary_permissions where actor=a and company=c and permission=p),false)$$;
 alter table auth.users add deleted_at timestamptz,add banned_until timestamptz;
 create table user_permissions(id uuid default gen_random_uuid(),user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active bool,status text,effect text);
 create table roles(id uuid primary key,key text,is_active bool);create table user_roles(id uuid default gen_random_uuid(),user_id uuid,company_id uuid,role_id uuid,is_active bool,status text);create table role_permissions(id uuid default gen_random_uuid(),role_id uuid,permission_id uuid,permission_key text,effect text);
 alter table customer_contracts add signature_snapshot jsonb,add signature_snapshot_sha256 text,add document_sha256 text;
 create table customer_contract_documents(id uuid primary key,company_id uuid,customer_contract_id uuid,document_type text,document_sha256 text,verified_at timestamptz);`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930232100_ediel_requested_change_source_intake_and_review.sql',import.meta.url),'utf8'))
 // The upgraded owner no longer accepts manually inserted old fixture events.
 assert.equal((await read(bound[1].event)).rows[0].b.status,'held')
 for(const key of ['communication.write','communication.read','customers.read','customers.write','contracts.read','contracts.write'])await db.exec(`insert into permissions(key,name,is_active) values('${key}','Synthetic ${key}',true)`)
 await db.exec(`insert into auth.users(id) values('${uid(30)}');insert into user_profiles values('${uid(30)}','active');insert into company_memberships values('${uid(1)}','${uid(30)}','active',true,now());insert into boundary_permissions(actor,company,permission,allowed) values('${uid(30)}','${uid(1)}','communication.write',true);`)
 for(const actor of [uid(2),uid(30)])await db.exec(`insert into user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect) select '${actor}','${uid(1)}',id,key,true,'active','allow' from permissions where key in('communication.write','communication.read','customers.read','customers.write','contracts.read','contracts.write')`)
 const pdf=Buffer.from('%PDF-1.7\nSYNTHETIC MECHANISM ONLY: own quarter measurement clause.\n%%EOF'),pdfHash=createHash('sha256').update(pdf).digest('hex')
 await db.exec(`update customer_contracts set signature_snapshot=${quote({company_id:uid(1),customer_id:uid(3),contract_id:uid(5)})},document_sha256='${pdfHash}' where id='${uid(5)}';update customer_contracts set signature_snapshot_sha256=encode(sha256(convert_to(signature_snapshot::text,'UTF8')),'hex');insert into customer_contract_documents values('${uid(31)}','${uid(1)}','${uid(5)}','signed_contract_pdf','${pdfHash}',now())`)
 const submission=kind=>({supplyPeriodId:uid(6),contractId:uid(5),kind,effectiveAt:'2026-10-01T12:00:00Z',source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference:`SYNTHETIC ARCHIVE-${kind}`,version:'1'},customerIdentity:party,invoiceeProfile:invoicee})
 const archive=(input,actor=uid(2))=>service(`select public.ediel_archive_requested_change_source_v1('${uid(1)}','${actor}',${quote(input)}) b`)
 const review=(a,cmd,actor=uid(30))=>service(`select public.ediel_review_requested_change_artifact_v1('${uid(1)}','${a.artifactId}','${actor}',${quote({sourceHash:a.sourceHash,claimsHash:a.claimsHash,decision:'approve',reason:'SYNTHETIC SEPARATE REVIEW MECHANISM',clause:{locator:'page1 synthetic own clause',quote:'own quarter measurement clause'},...cmd})}) b`)
 const quarter=(await archive(submission('quarter_contract'))).rows[0].b
 assert.equal(quarter.status,'archived');assert.equal(quarter.sourceHash,pdfHash);assert.deepEqual((await archive(submission('quarter_contract'))).rows[0].b,quarter)
 await assert.rejects(()=>review(quarter,{}),/review_actor_forbidden/) // Generic permissions, even global legacy authority, cannot grant review.
 await db.exec(`insert into user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect) select '${uid(30)}','${uid(1)}',id,key,true,'active','allow' from permissions where key='ediel.source.review'`)
 await assert.rejects(()=>review(quarter,{sourceHash:'a'.repeat(64)}),/actual_archived_candidate_required/)
 assert.equal((await review(quarter,{decision:'hold'})).rows[0].b.status,'held')
 const approved=(await review(quarter,{})).rows[0].b;assert.equal(approved.status,'authorized');assert.deepEqual((await review(quarter,{})).rows[0].b,approved)
 assert.equal((await read(approved.eventId,uid(1),uid(30))).rows[0].b.status,'authorized')
 await db.exec(`update user_permissions set effect='deny' where user_id='${uid(30)}' and permission_key='ediel.source.review'`)
 assert.equal((await read(approved.eventId,uid(1),uid(30))).rows[0].b.status,'held')
 await db.exec(`update user_permissions set effect='allow' where user_id='${uid(30)}' and permission_key='ediel.source.review'`)
 const death=(await archive(submission('death'))).rows[0].b
 const before=(await db.query('select count(*)::int n from gridex_requested_changes.events')).rows[0].n
 assert.equal((await review(death,{})).rows[0].b.status,'held');assert.equal((await db.query('select count(*)::int n from gridex_requested_changes.events')).rows[0].n,before)
 const secret=Buffer.from('SYNTHETIC HMAC RECEIPT FIXTURE KEY ONLY 0123456789'),payload={format:'ediel_requested_change_issuer_receipt_v1',issuerCode:'SYNTHETIC-DEATH-ISSUER',receiptId:'SYNTHETIC-RECEIPT-1',companyId:uid(1),environment:'production',legalActorId:uid(9),customerId:uid(3),meteringPointId:uid(4),kind:'death',effectiveAt:'2026-10-01T12:00:00Z',sourceHash:pdfHash,sourceReference:'SYNTHETIC AUTHENTICATED-MECHANISM',sourceVersion:'1',customerIdentity:party,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()},payloadBytes=Buffer.from(JSON.stringify(payload))
 const receipt={keyId:uid(40),representationId:uid(41),payloadBase64:payloadBytes.toString('base64'),signatureHex:createHmac('sha256',secret).update(payloadBytes).digest('hex')}
 await db.exec(`insert into gridex_requested_changes.issuer_keys values('${uid(40)}','${uid(1)}','production','SYNTHETIC-DEATH-ISSUER','SYNTHETIC COMPETENCE MECHANISM NOT APPROVAL','${'c'.repeat(64)}',decode('${secret.toString('hex')}','hex'),'2026-01-01','2099-01-01');insert into gridex_requested_changes.issuer_representations values('${uid(41)}','${uid(1)}','production','${uid(40)}','${uid(9)}','death','SYNTHETIC REPRESENTATION NOT APPROVAL','${'d'.repeat(64)}','2026-01-01','2099-01-01')`)
 const sqlHmac=(await db.query(`select encode(gridex_requested_changes.receipt_hmac_sha256_v1(decode('${payloadBytes.toString('hex')}','hex'),decode('${secret.toString('hex')}','hex')),'hex') h`)).rows[0].h;assert.equal(sqlHmac,receipt.signatureHex)
 const authenticated=(await archive({...submission('death'),effectiveAt:'2026-10-01T12:01:00Z',source:{...submission('death').source,reference:payload.sourceReference},issuerReceipt:receipt})).rows[0].b
 assert.equal((await review(authenticated,{})).rows[0].b.status,'held') // Signed minute differs from actual candidate.
 const actualReceipt={...payload,effectiveAt:'2026-09-09T23:00:00Z',receiptId:'SYNTHETIC-RECEIPT-2'},actualBytes=Buffer.from(JSON.stringify(actualReceipt)),actualToken={...receipt,payloadBase64:actualBytes.toString('base64'),signatureHex:createHmac('sha256',secret).update(actualBytes).digest('hex')}
 const authenticatedOwn=(await archive({...submission('death'),effectiveAt:actualReceipt.effectiveAt,source:{...submission('death').source,reference:payload.sourceReference},issuerReceipt:actualToken})).rows[0].b
 const deathApproval=(await review(authenticatedOwn,{})).rows[0].b;assert.equal(deathApproval.status,'authorized')
 // Actual forward customer owner, with explicitly synthetic previously-qualified
 // supply/transport/source-assessment boundary records. Not authentic replay.
 await db.exec(`alter table ediel_messages add message_received_at timestamptz;alter table metering_points add site_id uuid,add customer_site_id uuid;create table customer_sites(id uuid primary key,company_id uuid,customer_id uuid);insert into customer_sites values('${uid(60)}','${uid(1)}','${uid(3)}');update metering_points set site_id='${uid(60)}' where id='${uid(4)}';
 create table ediel_message_events(company_id uuid,ediel_message_id uuid,message_id uuid,event_type text,event_status text,message text,payload jsonb,event_payload jsonb,created_by uuid);
 create schema gridex_ediel_inbound_context;create function gridex_ediel_inbound_context.require_v1(c uuid,m uuid) returns void language plpgsql as $$begin null;end$$;
 create schema gridex_ediel_source_rules;create function gridex_ediel_source_rules.require_v1(c uuid,m uuid) returns void language plpgsql as $$begin null;end$$;
 create table gridex_received_sources.sources(source_message_id uuid primary key,company_id uuid,environment text,raw_payload text,payload_hash text,source_received_at timestamptz);
 create table gridex_received_sources.validation_assessments(id uuid primary key,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,facts_text text,previous_assessment_id uuid);
 create schema gridex_ai_processing;`)
 await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql','gridex_received_sources.permission_date_v1'))
 await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql','gridex_received_sources.permission_time_v1'))
 await db.exec(fn('../supabase/migrations/20260930203354_ediel_ai_intent_source_origination.sql','gridex_ai_processing.party_text_v1'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001002600_ediel_confirmed_customer_source_versions.sql',import.meta.url),'utf8'))
 const receivedWire="UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z06+SYNTHETIC-INCOMING+9'NAD+FR+54321:160:SVK'NAD+DO+12345:160:SVK'LIN+1++735999123456789012:::9'DTM+157:202609100000:203'CCI++Z13'CAV+E34'CCI++Z17'CAV+Z41'RFF+LI:SYNTHETIC-NETWORK-CASE'NAD+UD+199001019999:SE1:260++SYNTHETIC CUSTOMER ESTATE+TEST ROAD 1+TEST++12345+SE'"
 const incomingHash=createHash('sha256').update(receivedWire).digest('hex')
 await db.exec(`insert into ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,sender_ediel_id,receiver_ediel_id,message_received_at) values('${uid(61)}','${uid(1)}','production','inbound','edifact','PRODAT','Z06',${quote(receivedWire)},'54321','12345','2026-09-10T00:01Z');insert into gridex_received_sources.sources values('${uid(61)}','${uid(1)}','production',${quote(receivedWire)},'${incomingHash}','2026-09-10T00:01Z');insert into gridex_received_sources.validation_assessments values('${uid(62)}','${uid(61)}','${uid(1)}','production','${incomingHash}','{"syntaxDecision":"accepted","applicationDecision":"accepted","functionalDecision":"accepted"}',null)`)
 const applyCustomer=(company=uid(1),actor=uid(30))=>service(`select public.ediel_apply_reviewed_customer_source_v1('${company}','${uid(61)}','${actor}') b`)
 const appliedCustomer=(await applyCustomer()).rows[0].b
 assert.equal(appliedCustomer.applied,true);assert.equal(appliedCustomer.owner,'confirmed-customer-source-v1');assert.deepEqual((await applyCustomer()).rows[0].b,appliedCustomer)
 assert.equal((await db.query('select party from gridex_requested_changes.confirmed_customer_versions')).rows[0].party.name,'SYNTHETIC CUSTOMER ESTATE')
 await assert.rejects(()=>applyCustomer(uid(99)),/actor_forbidden/)
 assert.equal((await service(`select public.ediel_witness_confirmed_customer_source_v1('${uid(1)}','${uid(61)}','${uid(30)}') b`)).rows[0].b.sourceMessageId,uid(61))
 assert.equal((await db.query('select count(*)::int n from gridex_requested_changes.customer_version_availability')).rows[0].n,1)
 await db.exec(`update ediel_messages set raw_payload=${quote(receivedWire.replace('E34','E64'))} where id='${uid(61)}'`)
 await assert.rejects(()=>applyCustomer(),/immutable_original_required/)
 await db.exec(`update ediel_messages set raw_payload=${quote(receivedWire)} where id='${uid(61)}'`)
 await assert.rejects(()=>db.exec(`update gridex_requested_changes.confirmed_customer_versions set party='{}' where source_message_id='${uid(61)}'`),/immutable/)
 console.log('PASS incoming Z06E source-only customer version mechanism: actual raw hash/canonical assessment/life-event binding, immutable dated party, atomic idempotence, separate committed availability, tenant/mutation/foreign rejection (synthetic source/guide/inbound boundary records; not authentic replay)')
 // Customer facet and native CSV epoch bridge. The source snapshot/legacy
 // structural marker are synthetic mechanism records, not real guide approval.
 await db.exec(`create table gridex_received_sources.object_selection_snapshots(id uuid primary key,company_id uuid,environment text,cutoff_at timestamptz,captured_at timestamptz,readset_text text,readset_hash text,visibility_snapshot text);alter table ediel_message_intents add customer_site_id uuid;alter table customer_supply_periods add start_date date,add end_date date,add actual_start_date date,add actual_end_date date;update customer_supply_periods set start_date='2026-09-01' where id='${uid(6)}';create table gridex_ai_processing.outbound_origins(source_ids jsonb,row_sources jsonb,intent_id uuid,company_id uuid,environment text,snapshot_id uuid,readset_hash text,raw_payload text);create function gridex_ai_processing.require_ai_outbound_origin_v1(c uuid,m uuid) returns jsonb language sql as $$select '{}'::jsonb$$;`)
 await db.exec(fn('../supabase/migrations/20260930203354_ediel_ai_intent_source_origination.sql','gridex_ai_processing.source_row_basis_v1'))
 await db.exec(fn('../supabase/migrations/20260930203354_ediel_ai_intent_source_origination.sql','gridex_ai_processing.row_epoch_matches_v1'))
 await db.exec(fn('../supabase/migrations/20260930203354_ediel_ai_intent_source_origination.sql','gridex_ai_processing.require_original_row_sources_v1'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001003642_ediel_ai_confirmed_customer_facet_history.sql',import.meta.url),'utf8'))
 const baselineWire="UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z04+SYNTHETIC-BASELINE+9'NAD+FR+54321:160:SVK'NAD+DO+12345:160:SVK'LIN+1++735999123456789012:::9'DTM+92:202609010000:203'RFF+Z05:TES'NAD+Z02+99999:160:SVK'NAD+UD+199001019999:SE1:260++SYNTHETIC CUSTOMER'NAD+IT+SYNTHETIC-SITE+++TEST STREET+TEST++12345+SE'"
 const baselineHash=createHash('sha256').update(baselineWire).digest('hex'),cutoff=(await db.query('select clock_timestamp()::text t')).rows[0].t
 const linIndex=(await db.query(`select gridex_received_sources.closure_wire_tokens_v2(${quote(baselineWire)}) t`)).rows[0].t.find(t=>t.tag==='LIN').index
 const business={owner:'reviewed-received-structure-v1',companyId:uid(1),environment:'production',customerId:uid(3),siteId:uid(60),meteringPointId:uid(4),supplyPeriodId:uid(6),sourceMessageId:uid(7),sourcePayloadHash:baselineHash,coverageWindow:{baselineSourceMessageId:uid(7)},wire:{businessCase:'supply_baseline',messageCode:'Z04',functionCode:'9',legalSender:'54321',legalReceiver:'12345',effectiveFrom:{marketMinute:'202609010000'}}}
 const factsText=JSON.stringify({objects:[{object:{objectId:'735999123456789012',identityAgency:'9',registers:[{segmentIndex:linIndex}]},disposition:'accepted',business}]})
 const body={complete:true,companyId:uid(1),environment:'production',cutoffAt:cutoff,capturedAt:cutoff,sources:[{sourceMessageId:uid(7),rawPayload:baselineWire,payloadHash:baselineHash,assessments:[{id:uid(65),availabilityWitnessId:uid(66),availableAt:cutoff,factsText,factsHash:createHash('sha256').update(factsText).digest('hex')}]},{sourceMessageId:uid(61),rawPayload:receivedWire,payloadHash:incomingHash,assessments:[]}]}
 await db.exec(`insert into gridex_received_sources.object_selection_snapshots select '${uid(64)}','${uid(1)}','production','${cutoff}','${cutoff}',${quote(body)}::jsonb::text,encode(sha256(convert_to(${quote(body)}::jsonb::text,'UTF8')),'hex'),pg_current_snapshot()::text;insert into ediel_message_intents(id,company_id,environment,customer_id,customer_site_id,sender_ediel_id,receiver_ediel_id) values('${uid(63)}','${uid(1)}','production','${uid(3)}','${uid(60)}','12345','54321');update boundary_supply set basis=basis||jsonb_build_object('siteId','${uid(60)}','marketStartAt','2026-08-31T23:00:00Z','marketEndAt',null) where id='${uid(6)}'`)
 const snapshotHash=(await db.query(`select readset_hash h from gridex_received_sources.object_selection_snapshots where id='${uid(64)}'`)).rows[0].h
 const readCustomerHistory=(actor=uid(30))=>service(`select public.ediel_confirmed_customer_snapshot_v1('${uid(1)}','${actor}','${uid(64)}','${snapshotHash}','${uid(3)}','${uid(60)}') b`)
 const actualHistory=(await readCustomerHistory()).rows[0].b;assert.equal(actualHistory.versions.length,1);assert.equal(actualHistory.versions[0].party.name,'SYNTHETIC CUSTOMER ESTATE');assert.equal(actualHistory.versions[0].marketMinute,'202609100000')
 await assert.rejects(()=>readCustomerHistory(uid(99)),/reader_forbidden/)
 const csvCols=(name,from,to)=>['TES','735999123456789012','9','','','','','TEST STREET','12345','TEST','99999','','','','','','','199001019999',name,from,to,'']
 const header='AI;SYNTHETIC;202610011300;12345;54321;SYNTHETIC;SYNTHETIC;20260901;20261001;',csv=header+'\n'+csvCols('SYNTHETIC CUSTOMER','','20260910').join(';')+'\n'+csvCols('SYNTHETIC CUSTOMER ESTATE','20260910','').join(';')
 const baseRef={sourceMessageId:uid(7),baselineSourceMessageId:uid(7),addressSourceMessageId:uid(7),supplyPeriodId:uid(6)},refs=[baseRef,{...baseRef,customerSourceMessageId:uid(61)}]
 const nativeRows=(raw=csv,claims=refs)=>db.query(`select gridex_ai_processing.require_original_row_sources_v1((select readset_text::jsonb from gridex_received_sources.object_selection_snapshots where id='${uid(64)}'),'${cutoff}',(select i from ediel_message_intents i where id='${uid(63)}'),${quote(raw)},${quote(claims)}) b`)
 assert.deepEqual((await nativeRows()).rows[0].b,refs)
 await assert.rejects(()=>nativeRows(csv.replace('CUSTOMER ESTATE','FORGED NAME')),/version_cell_mismatch/)
 await assert.rejects(()=>nativeRows(csv,[baseRef,{...baseRef,customerSourceMessageId:uid(99)}]),/epoch_source_mismatch/)
 await assert.rejects(()=>nativeRows(header+'\n'+csvCols('SYNTHETIC CUSTOMER','','').join(';'),[baseRef]),/epoch_omitted_or_forged/)
 await assert.rejects(()=>nativeRows(csv.replace('20260910','20260911')),/epoch_omitted_or_forged/)
 await db.exec(`update user_permissions set effect='deny' where user_id='${uid(30)}' and permission_key='ediel.source.review'`)
 assert.equal((await readCustomerHistory()).rows[0].b.versions.length,0)
 await assert.rejects(()=>nativeRows(),/dated_source_owner_missing/)
 await db.exec(`update user_permissions set effect='allow' where user_id='${uid(30)}' and permission_key='ediel.source.review'`)
 console.log('PASS AI customer facet same-native-snapshot/visibility/current-source read and actual complete structural+customer CSV epoch bridge: cells/split/source/tenant/revocation reject (synthetic structural/source/issuer boundary records, not authentic replay or production/legal approval)')

 // A second, independent namespace owns non-death bilateral facts. The ONLY
 // invented authority boundary here is explicitly synthetic key/mandate data;
 // artifacts, reviews, version and read receipts use the real native producers.
 const bilateralWire=receivedWire.replace("CCI++Z17'CAV+Z41'",'').replace('202609100000','202609200000').replace('199001019999','199101019999').replace('SYNTHETIC CUSTOMER ESTATE','SYNTHETIC BILATERAL CUSTOMER')
 const bilateralRawHash=createHash('sha256').update(bilateralWire).digest('hex')
 await db.exec(`create table tenant_bilateral_agreements(id uuid primary key,company_id uuid,environment text,counterparty_actor_id uuid,capability_code text,terms jsonb,is_enabled bool,valid_from timestamptz,valid_to timestamptz,source_reference text);
 create table platform_actor_identifiers(id uuid primary key,actor_id uuid,identifier_type text,identifier_value text,is_verified bool,valid_from date,valid_to date);create table platform_actor_roles(id uuid primary key,actor_id uuid,actor_role text,is_active bool);
 insert into platform_actor_identifiers values('${uid(81)}','${uid(80)}','EdielId','54321',true,'2026-01-01',null);insert into platform_actor_roles values('${uid(82)}','${uid(80)}','grid_owner',true);insert into tenant_bilateral_agreements values('${uid(83)}','${uid(1)}','production','${uid(80)}','prodat_z06e_customer_change','{}',true,'2026-01-01',null,'SYNTHETIC SIGNED AGREEMENT');
 insert into ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,sender_ediel_id,receiver_ediel_id,message_received_at) values('${uid(84)}','${uid(1)}','production','inbound','edifact','PRODAT','Z06',${quote(bilateralWire)},'54321','12345','2026-09-20T00:01Z');insert into gridex_received_sources.sources values('${uid(84)}','${uid(1)}','production',${quote(bilateralWire)},'${bilateralRawHash}','2026-09-20T00:01Z');insert into gridex_received_sources.validation_assessments values('${uid(85)}','${uid(84)}','${uid(1)}','production','${bilateralRawHash}','{"syntaxDecision":"accepted","applicationDecision":"accepted","functionalDecision":"accepted"}',null)`)
 const applyBilateral=()=>service(`select public.ediel_apply_reviewed_customer_source_v1('${uid(1)}','${uid(84)}','${uid(30)}') b`)
 assert.equal((await applyBilateral()).rows[0].b.reason,'customer_source_separate_bilateral_non_death_ground_required') // genuine red baseline
 await db.exec(`create schema gridex_ediel_ack_replay;create function gridex_ediel_ack_replay.lock_current_graph_v2() returns void language plpgsql as $$begin null;end$$;create table user_permission_overrides(id uuid default gen_random_uuid(),company_id uuid,user_id uuid,permission_key text,effect text,valid_from timestamptz,valid_to timestamptz,is_active bool default true)`)
 // Central full-schema phantom fence is a synthetic no-op boundary here.
 // Its genuine lock/concurrency proof belongs to actual full native replay.
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001010758_ediel_bilateral_customer_source_owner.sql',import.meta.url),'utf8'))
 const bilateralClaims=(await db.query(`select gridex_bilateral_customer_sources.source_claims_v1('${uid(1)}','${uid(84)}','${uid(83)}','${uid(6)}','${uid(5)}') b`)).rows[0].b
 const bilateralPdf=Buffer.from('%PDF-1.7\nSYNTHETIC signed bilateral customer clause.\n%%EOF'),bilateralPdfHash=createHash('sha256').update(bilateralPdf).digest('hex'),clause={locator:'page1 synthetic clause',quote:'signed bilateral customer clause'}
 const bilateralSubmission={sourceMessageId:uid(84),agreementId:uid(83),supplyPeriodId:uid(6),contractId:uid(5),source:{bytesBase64:bilateralPdf.toString('base64'),mimeType:'application/pdf',reference:'SYNTHETIC BILATERAL PDF',version:'1'}}
 const archiveBilateral=input=>service(`select public.ediel_archive_bilateral_customer_source_v1('${uid(1)}','${uid(2)}',${quote(input)}) b`)
 const reviewBilateral=(a,actor=uid(30),extra={})=>service(`select public.ediel_review_bilateral_customer_source_v1('${uid(1)}','${actor}','${a.artifactId}',${quote({sourceHash:a.sourceHash,claimsHash:a.claimsHash,decision:'approve',reason:'SYNTHETIC separate bilateral review',clause,...extra})}) b`)
 const pendingBilateral=(await archiveBilateral(bilateralSubmission)).rows[0].b
 assert.equal(pendingBilateral.status,'archived');assert.deepEqual(pendingBilateral.missing,['authentic_current_bilateral_dso_receipt_and_representation']);assert.equal((await reviewBilateral(pendingBilateral)).rows[0].b.status,'held');assert.equal((await applyBilateral()).rows[0].b.applied,false)
 await assert.rejects(()=>reviewBilateral(pendingBilateral,uid(2)),/review_actor_forbidden/)
 await db.exec(`insert into user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect) select '${uid(2)}','${uid(1)}',id,key,true,'active','allow' from permissions where key='ediel.source.review'`)
 await assert.rejects(()=>reviewBilateral(pendingBilateral,uid(2)),/separate_reviewer/);await assert.rejects(()=>archiveBilateral({...bilateralSubmission,companyId:uid(99),authorizedFields:['310']}),/shape_required/)
 const bilateralKey=Buffer.alloc(32,44)
 await db.exec(`insert into gridex_bilateral_customer_sources.issuer_keys values('${uid(86)}','${uid(1)}','production','${uid(80)}','SYNTHETIC fixture-only competent DSO authority','${'d'.repeat(64)}',decode('${bilateralKey.toString('hex')}','hex'),'2026-01-01','2027-01-01');insert into gridex_bilateral_customer_sources.representations values('${uid(87)}','${uid(1)}','production','${uid(86)}','${uid(9)}','${uid(83)}','prodat_z06e_customer_change','SYNTHETIC fixture-only representation','${'e'.repeat(64)}','2026-01-01','2027-01-01')`)
 const signedBilateralPdf=Buffer.concat([bilateralPdf,Buffer.from('\nSYNTHETIC signed receipt version2')]),signedBilateralHash=createHash('sha256').update(signedBilateralPdf).digest('hex')
 const bilateralReceipt={format:'ediel_bilateral_customer_source_receipt_v1',receiptId:'SYNTHETIC ONLY',lifeEventKind:'bankruptcy',claims:bilateralClaims,sourceHash:signedBilateralHash,sourceReference:'SYNTHETIC BILATERAL PDF',sourceVersion:'2',authorizedFields:['227','228','229','231','232','316'],clause,issuedAt:'2026-01-02T00:00Z',expiresAt:'2027-01-01T00:00Z'},bilateralPayload=Buffer.from(JSON.stringify(bilateralReceipt))
 const qualifiedBilateralSubmission={...bilateralSubmission,source:{...bilateralSubmission.source,bytesBase64:signedBilateralPdf.toString('base64'),version:'2'},issuerReceipt:{keyId:uid(86),representationId:uid(87),payloadBase64:bilateralPayload.toString('base64'),signatureHex:createHmac('sha256',bilateralKey).update(bilateralPayload).digest('hex')}}
 const qualifiedBilateral=(await archiveBilateral(qualifiedBilateralSubmission)).rows[0].b;assert.deepEqual(qualifiedBilateral.missing,[])
 assert.equal((await reviewBilateral(qualifiedBilateral,uid(30),{clause:{...clause,quote:'not in the actual PDF'}})).rows[0].b.status,'held')
 assert.equal((await reviewBilateral(qualifiedBilateral)).rows[0].b.status,'authorized')
 await db.exec(`insert into user_permission_overrides(company_id,user_id,permission_key,effect,valid_from,valid_to) values(null,'${uid(30)}','ediel.source.review','deny',now()-interval '1 day',now()+interval '1 day')`)
 assert.equal((await applyBilateral()).rows[0].b.applied,false);await db.exec(`update user_permission_overrides set valid_to=now()-interval '1 second'`)
 await db.exec(`insert into user_permissions(user_id,company_id,permission_key,is_active,status,effect) values('${uid(30)}','${uid(1)}','ediel.source.review',true,'active','deny')`)
 assert.equal((await applyBilateral()).rows[0].b.applied,false);await db.exec(`delete from user_permissions where user_id='${uid(30)}' and permission_key='ediel.source.review' and effect='deny'`)
 const bilateralVersion=(await applyBilateral()).rows[0].b;assert.equal(bilateralVersion.applied,true);assert.equal(bilateralVersion.eventId,null);assert.equal(bilateralVersion.authority.artifactId,qualifiedBilateral.artifactId);assert.deepEqual((await applyBilateral()).rows[0].b,bilateralVersion)
 await service(`select public.ediel_witness_confirmed_customer_source_v1('${uid(1)}','${uid(84)}','${uid(30)}')`)
 const bilateralCutoff=(await db.query('select clock_timestamp()::text t')).rows[0].t,bilateralBody={...body,cutoffAt:bilateralCutoff,capturedAt:bilateralCutoff,sources:[...body.sources,{sourceMessageId:uid(84),rawPayload:bilateralWire,payloadHash:bilateralRawHash,assessments:[]}]}
 await db.exec(`insert into gridex_received_sources.object_selection_snapshots select '${uid(88)}','${uid(1)}','production','${bilateralCutoff}','${bilateralCutoff}',${quote(bilateralBody)}::jsonb::text,encode(sha256(convert_to(${quote(bilateralBody)}::jsonb::text,'UTF8')),'hex'),pg_current_snapshot()::text`)
 const bilateralSnapshotHash=(await db.query(`select readset_hash h from gridex_received_sources.object_selection_snapshots where id='${uid(88)}'`)).rows[0].h
 const readBilateralHistory=()=>service(`select public.ediel_confirmed_customer_snapshot_v1('${uid(1)}','${uid(30)}','${uid(88)}','${bilateralSnapshotHash}','${uid(3)}','${uid(60)}') b`)
 assert.equal((await readBilateralHistory()).rows[0].b.versions.length,2)
 const bilateralFacet=(await readBilateralHistory()).rows[0].b.versions.find(v=>v.sourceMessageId===uid(84));assert.equal(bilateralFacet.identityChangeAuthorized,true);assert.equal(bilateralFacet.authorityKind,'bilateral');assert.equal(bilateralFacet.party.id,'199101019999');assert.equal(bilateralFacet.party.deathStatus,undefined)
 const bilateralCols=csvCols('SYNTHETIC BILATERAL CUSTOMER','20260920','');bilateralCols[17]='199101019999'
 const bilateralCsv=header+'\n'+csvCols('SYNTHETIC CUSTOMER','','20260910').join(';')+'\n'+csvCols('SYNTHETIC CUSTOMER ESTATE','20260910','20260920').join(';')+'\n'+bilateralCols.join(';'),bilateralRefs=[baseRef,{...baseRef,customerSourceMessageId:uid(61)},{...baseRef,customerSourceMessageId:uid(84)}]
 const nativeBilateralRows=(raw=bilateralCsv)=>db.query(`select gridex_ai_processing.require_original_row_sources_v1(${quote(bilateralBody)},'${bilateralCutoff}',(select i from ediel_message_intents i where id='${uid(63)}'),${quote(raw)},${quote(JSON.stringify(bilateralRefs))}) b`)
 assert.deepEqual((await nativeBilateralRows()).rows[0].b,bilateralRefs);await assert.rejects(()=>nativeBilateralRows(bilateralCsv.replace('SYNTHETIC BILATERAL CUSTOMER','FORGED NAME')),/version_cell_mismatch/)
 await db.exec(`update tenant_bilateral_agreements set is_enabled=false where id='${uid(83)}'`);assert.equal((await applyBilateral()).rows[0].b.applied,false);assert.equal((await readBilateralHistory()).rows[0].b.versions.length,1);await assert.rejects(()=>nativeBilateralRows(),/dated_source_owner_missing/);await db.exec(`update tenant_bilateral_agreements set is_enabled=true where id='${uid(83)}'`)
 await db.exec(`insert into gridex_bilateral_customer_sources.revocations values('representation','${uid(87)}','SYNTHETIC revocation','${'f'.repeat(64)}',clock_timestamp())`);assert.equal((await applyBilateral()).rows[0].b.applied,false);assert.equal((await readBilateralHistory()).rows[0].b.versions.length,1)
 for(const role of ['anon','authenticated','service_role']){await db.exec(`set role ${role}`);await assert.rejects(()=>db.query('select source_bytes from gridex_bilateral_customer_sources.artifacts'),/permission denied/);await assert.rejects(()=>db.query('select receipt_signing_key from gridex_bilateral_customer_sources.issuer_keys'),/permission denied/);await db.exec('reset role')}
 console.log('PASS independent non-death/bankruptcy bilateral actual archive/review→dated version→committed witness→same snapshot/complete AI CSV: HMAC/actual clause/cells/identity mandate/current agreement/representation revocation/foreign no-death rejects (synthetic original/canonical/supply/issuer boundary facts, NOT authentic native replay or external legal approval)')

 await db.exec(`insert into gridex_requested_changes.issuer_revocations(target_kind,target_id,source_reference,source_hash) values('representation','${uid(41)}','SYNTHETIC CURRENT REVOCATION','${'e'.repeat(64)}')`)
 assert.equal((await read(deathApproval.eventId,uid(1),uid(30))).rows[0].b.status,'held');assert.equal((await applyCustomer()).rows[0].b.applied,false)
 for(const role of ['anon','authenticated','service_role']){await db.exec(`set role ${role}`);await assert.rejects(()=>db.query('select source_bytes from gridex_requested_changes.artifacts'),/permission denied/);await assert.rejects(()=>db.query('select receipt_signing_key from gridex_requested_changes.issuer_keys'),/permission denied/);await db.exec('reset role')}
 await assert.rejects(()=>db.exec(`update gridex_requested_changes.artifacts set source_bytes='tampered' where id='${quarter.artifactId}'`),/immutable/)
 console.log('PASS custody/review mechanism: byte/hash archive, separate company-scoped no-default review grants, actual signed-PDF/signature binding, authenticated own HMAC receipt/minute, issuer representation revocation and private immutable rows (all source approvals/issuer keys synthetic; not authentic external/native approval)')
}catch(error){console.error(JSON.stringify({error:error.message,code:error.code,where:error.where,detail:error.detail,assertionStack:error.code==='ERR_ASSERTION'?error.stack:undefined}));process.exitCode=1}finally{await db.close()}
