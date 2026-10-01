// Retention mechanism continuation reuses the actual archive/source owner SQL.
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
 await db.exec(`alter table permissions rename to boundary_permissions;create table permissions(id uuid default gen_random_uuid(),key text,name text,category text,description text,is_active bool default true);create or replace function gridex_actor_has_company_permission(a uuid,c uuid,p text) returns bool language sql security definer as $$select coalesce((select allowed from public.boundary_permissions where actor=a and company=c and permission=p),false)$$;
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
 const actualReceipt={...payload,effectiveAt:'2026-10-01T12:02:00Z',receiptId:'SYNTHETIC-RECEIPT-2'},actualBytes=Buffer.from(JSON.stringify(actualReceipt)),actualToken={...receipt,payloadBase64:actualBytes.toString('base64'),signatureHex:createHmac('sha256',secret).update(actualBytes).digest('hex')}
 const authenticatedOwn=(await archive({...submission('death'),effectiveAt:actualReceipt.effectiveAt,source:{...submission('death').source,reference:payload.sourceReference},issuerReceipt:actualToken})).rows[0].b
 const deathApproval=(await review(authenticatedOwn,{})).rows[0].b;assert.equal(deathApproval.status,'authorized')
 await db.exec(`insert into gridex_requested_changes.issuer_revocations(target_kind,target_id,source_reference,source_hash) values('representation','${uid(41)}','SYNTHETIC CURRENT REVOCATION','${'e'.repeat(64)}')`)
 assert.equal((await read(deathApproval.eventId,uid(1),uid(30))).rows[0].b.status,'held')
 for(const role of ['anon','authenticated','service_role']){await db.exec(`set role ${role}`);await assert.rejects(()=>db.query('select source_bytes from gridex_requested_changes.artifacts'),/permission denied/);await assert.rejects(()=>db.query('select receipt_signing_key from gridex_requested_changes.issuer_keys'),/permission denied/);await db.exec('reset role')}
 await assert.rejects(()=>db.exec(`update gridex_requested_changes.artifacts set source_bytes='tampered' where id='${quarter.artifactId}'`),/immutable/)
 console.log('PASS custody/review mechanism: byte/hash archive, separate company-scoped no-default review grants, actual signed-PDF/signature binding, authenticated own HMAC receipt/minute, issuer representation revocation and private immutable rows (all source approvals/issuer keys synthetic; not authentic external/native approval)')
 // Continue from the actual source archive/review RPC above. The predecessor
 // supply, signed PDF and legal issuer are explicit synthetic boundaries here.
 await db.exec(`create table user_permission_overrides(id uuid default gen_random_uuid(),user_id uuid,company_id uuid,permission_key text,effect text,is_active bool);
 create table audit_logs(actor_user_id uuid,company_id uuid,entity_type text,entity_id uuid,action text,metadata jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`)
 await db.exec(fn('../supabase/migrations/20260922095911_ediel_received_source_ledger.sql','gridex_received_sources.reject_mutation'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001000500_ediel_artifact_retention_decision_and_purge.sql',import.meta.url),'utf8'))
 const authenticatedCall=async(actor,statement)=>{await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${actor}',false)`);try{return (await db.query(statement)).rows[0]?.b}finally{await db.exec('reset role')}}
 const grant=async(actor,keys)=>{for(const key of keys){await db.exec(`insert into user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect) select '${actor}','${uid(1)}',id,key,true,'active','allow' from permissions where key='${key}';insert into boundary_permissions select '${actor}','${uid(1)}','${key}',true where not exists(select from boundary_permissions where actor='${actor}' and company='${uid(1)}' and permission='${key}')`)} }
 await grant(uid(2),['ediel.retention.submit','ediel.retention.purge']);await grant(uid(30),['ediel.retention.review'])
 const submit=async(document,issuerReceipt=null,actor=uid(2),company=uid(1),artifact=quarter.artifactId)=>authenticatedCall(actor,`select public.ediel_submit_artifact_retention_v1('${company}','${actor}','${artifact}',${quote(document.toString('base64'))},${issuerReceipt===null?'NULL':quote(issuerReceipt)}) b`)
 const retentionReview=(id,outcome='approve',actor=uid(30))=>authenticatedCall(actor,`select public.ediel_review_artifact_retention_v1('${uid(1)}','${actor}','${id}','${outcome}','SYNTHETIC MECHANISM REVIEW') b`)
 const purge=(id,actor=uid(2))=>authenticatedCall(actor,`select public.ediel_purge_artifact_retention_v1('${uid(1)}','${actor}','${id}') b`)
 const unqualified=await submit(Buffer.from('SYNTHETIC no issuer'));assert.equal(unqualified.issuerQualified,false);assert.equal((await retentionReview(unqualified.decisionId)).status,'held');assert.equal((await purge(unqualified.decisionId)).status,'held')
 await assert.rejects(()=>submit(Buffer.from('wrong company'),null,uid(2),uid(99)),/current_actor_forbidden/)
 await assert.rejects(()=>authenticatedCall(uid(30),`select public.ediel_submit_artifact_retention_v1('${uid(1)}','${uid(2)}','${quarter.artifactId}','YQ==',NULL) b`),/current_actor_forbidden/)
 await assert.rejects(()=>service(`select public.ediel_purge_artifact_retention_v1('${uid(1)}','${uid(2)}','${unqualified.decisionId}')`),/permission denied/)
 await grant(uid(2),['ediel.retention.review']);await assert.rejects(()=>retentionReview(unqualified.decisionId,'approve',uid(2)),/separate_reviewer_required/)
 const legalBytes=Buffer.from('SYNTHETIC LEGAL COMPETENCE TEST ONLY'),retentionKey=Buffer.from('SYNTHETIC RETENTION KEY ONLY 01234567890123456789')
 await db.exec(`insert into gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to) values('${uid(50)}','${uid(1)}','SYNTHETIC LEGAL COMPETENCE TEST ONLY',decode('${legalBytes.toString('hex')}','hex'),'${createHash('sha256').update(legalBytes).digest('hex')}',decode('${retentionKey.toString('hex')}','hex'),'2020-01-01','2099-01-01')`)
 const policy=(document,extra={})=>{
  const claims={format:'ediel_retention_policy_v1',retentionClass:'requested_change_source_artifact_bytes',companyId:uid(1),artifactId:quarter.artifactId,sourceHash:quarter.sourceHash,claimsHash:quarter.claimsHash,documentHash:createHash('sha256').update(document).digest('hex'),issuerLegalReference:'SYNTHETIC LEGAL COMPETENCE TEST ONLY',legalBasisReference:'SYNTHETIC PURPOSE+PERIOD TEST ONLY',issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString(),...extra},bytes=Buffer.from(JSON.stringify(claims))
  return {issuerId:uid(50),payloadBase64:bytes.toString('base64'),signatureHex:createHmac('sha256',retentionKey).update(bytes).digest('hex')}
 }
 const futureDoc=Buffer.from('SYNTHETIC future retention deadline'),future=await submit(futureDoc,policy(futureDoc,{retainUntil:new Date(Date.now()+3600000).toISOString()}));assert.equal(future.issuerQualified,true);assert.equal((await retentionReview(future.decisionId)).status,'approved');assert.equal((await purge(future.decisionId)).status,'held')
 const wrongDoc=Buffer.from('SYNTHETIC missing required deadline'),wrong=await submit(wrongDoc,policy(wrongDoc,{retainUntil:null}));assert.equal(wrong.issuerQualified,false);assert.equal((await retentionReview(wrong.decisionId)).status,'held')
 const revokedDoc=Buffer.from('SYNTHETIC revoked legal policy'),revoked=await submit(revokedDoc,policy(revokedDoc));assert.equal((await retentionReview(revoked.decisionId)).status,'approved');await authenticatedCall(uid(30),`select public.ediel_revoke_artifact_retention_v1('${uid(1)}','${uid(30)}','${revoked.decisionId}','SYNTHETIC REVOCATION') b`);assert.equal((await purge(revoked.decisionId)).status,'held')
 const actualDoc=Buffer.from('SYNTHETIC mechanism qualified elapsed source byte deadline'),token=policy(actualDoc),actual=await submit(actualDoc,token);assert.equal(actual.issuerQualified,true);assert.equal((await submit(actualDoc,token)).decisionId,actual.decisionId);assert.equal((await retentionReview(actual.decisionId)).status,'approved')
 await db.exec(`insert into user_permission_overrides(user_id,company_id,permission_key,effect,is_active) values('${uid(30)}','${uid(1)}','ediel.retention.review','deny',true)`);assert.deepEqual((await purge(actual.decisionId)).missing,['current_retention_reviewer_authority']);await db.exec('delete from user_permission_overrides')
 await db.exec(`update boundary_permissions set allowed=false where actor='${uid(2)}' and permission='ediel.retention.purge'`);await assert.rejects(()=>purge(actual.decisionId),/current_actor_forbidden/);await db.exec(`update boundary_permissions set allowed=true where actor='${uid(2)}' and permission='ediel.retention.purge'`)
 await retentionReview(actual.decisionId,'hold');assert.equal((await purge(actual.decisionId)).status,'held');await retentionReview(actual.decisionId)
 const saved=(await db.query(`select to_jsonb(a)-'source_bytes'-'purged_at' b from gridex_requested_changes.artifacts a where id='${quarter.artifactId}'`)).rows[0].b
 const purged=await purge(actual.decisionId);assert.equal(purged.status,'purged');assert.equal(purged.replay,false);assert.equal(purged.sourceHash,quarter.sourceHash);assert.equal(purged.byteLength,pdf.length)
 const archived=(await db.query(`select source_bytes is null empty,purged_at is not null tombstone,(to_jsonb(a)-'source_bytes'-'purged_at') b from gridex_requested_changes.artifacts a where id='${quarter.artifactId}'`)).rows[0];assert.equal(archived.empty,true);assert.equal(archived.tombstone,true);assert.deepEqual(archived.b,saved)
 assert.equal((await db.query(`select count(*)::int n from gridex_requested_changes.revocations where event_id='${approved.eventId}'`)).rows[0].n,1);assert.equal((await read(approved.eventId,uid(1),uid(30))).rows[0].b.status,'held')
 assert.equal((await purge(actual.decisionId)).replay,true);await assert.rejects(()=>purge(future.decisionId),/purge_decision_conflict/)
 for(const sql of [`update gridex_requested_changes.artifacts set source_bytes=decode('61','hex') where id='${quarter.artifactId}'`,`delete from gridex_requested_changes.artifacts where id='${quarter.artifactId}'`,`update gridex_ediel_retention.purges set byte_length=1`])await assert.rejects(()=>db.exec(sql),/immutable|received_source_evidence_is_append_only/)
 for(const role of ['anon','authenticated','service_role']){await db.exec(`set role ${role}`);await assert.rejects(()=>db.query('select * from gridex_ediel_retention.purges'),/permission denied/);await db.exec('reset role')}
 assert.equal((await db.query('select count(*)::int n from customer_supply_periods')).rows[0].n,1);assert.equal((await db.query(`select raw_payload is not null retained from ediel_messages where id='${uid(7)}'`)).rows[0].retained,true)
 assert.equal((await db.query("select count(*)::int n from audit_logs where action='ediel.retention.bytes_purged'")).rows[0].n,1)
 console.log('PASS 20 retention mechanics: authenticated current scoped actor+deny, separate reviewer, no-issuer/null deadline/future/revoked holds, exact source native HMAC/document, operational revoke before sanctioned bytes NULL, immutable tombstone/hash/metadata, retry and no cascade (all legal/source boundaries SYNTHETIC, NOT native/authentic decision)')

 // Current canonical personal-field class. Synthetic minimal schema boundaries
 // explicitly do not establish full app triggers, legal customer closure or RLS.
 await db.exec(`alter table customers add status text default 'archived',add first_name text,add last_name text,add full_name text,add company_name text,add personal_number text,add org_number text,add email text,add phone text,add apartment_number text,add identity_number text,add organization_number text,add name text,add billing_street text,add billing_postal_code text,add billing_city text,add metadata jsonb default '{}',add onboarding_issues jsonb default '[]',add intake_missing_fields text[] default '{}',add intake_warnings text[] default '{}',add process_summary jsonb default '{}',add archive_reason text,add next_action text,add latest_customer_action text,add anonymized_at timestamptz,add anonymized_by uuid,add data_retention_note text,add updated_at timestamptz,add updated_by uuid;
 alter table customer_supply_periods add actual_end_date date,add end_date date;
 create table customer_portal_accounts(id uuid default gen_random_uuid(),company_id uuid,customer_id uuid,status text,is_active bool,updated_at timestamptz);
 create table customer_portal_claims(id uuid default gen_random_uuid(),company_id uuid,customer_id uuid,status text,updated_at timestamptz);
 create table retained_customer_history(kind text,customer_id uuid,hash text);
 insert into retained_customer_history values('invoice','${uid(3)}','immutable invoice'),('meter','${uid(3)}','immutable meter'),('ACK','${uid(3)}','immutable ACK');
 update customers set first_name='SYNTHETIC',last_name='PERSON',full_name='SYNTHETIC PERSON',email='synthetic@example.invalid',personal_number='SYNTHETIC-ID',phone='0101234567',metadata='{"syntheticPersonal":"SYNTHETIC"}' where id='${uid(3)}';
 insert into customer_portal_accounts(company_id,customer_id,status,is_active) values('${uid(1)}','${uid(3)}','active',true);insert into customer_portal_claims(company_id,customer_id,status) values('${uid(1)}','${uid(3)}','approved');`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001000610_ediel_customer_class_retention.sql',import.meta.url),'utf8'))
 await grant(uid(2),['customers.write'])
 const personalHash=async()=>(await db.query(`select encode(sha256(convert_to(gridex_ediel_retention.customer_personal_fields_v1(c)::text,'UTF8')),'hex') h from customers c where id='${uid(3)}'`)).rows[0].h
 const customerPolicy=async(document,extra={})=>{const c={format:'ediel_customer_retention_policy_v1',retentionClass:'customer_canonical_personal_fields',companyId:uid(1),customerId:uid(3),sourceHash:await personalHash(),documentHash:createHash('sha256').update(document).digest('hex'),issuerLegalReference:'SYNTHETIC LEGAL COMPETENCE TEST ONLY',legalBasisReference:'SYNTHETIC personal-field class legal decision',issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString(),...extra},b=Buffer.from(JSON.stringify(c));return {issuerId:uid(50),payloadBase64:b.toString('base64'),signatureHex:createHmac('sha256',retentionKey).update(b).digest('hex')}}
 const submitCustomer=(document,token=null)=>authenticatedCall(uid(2),`select public.ediel_submit_customer_retention_v1('${uid(1)}','${uid(2)}','${uid(3)}',${quote(document.toString('base64'))},${token===null?'NULL':quote(token)}) b`)
 const reviewCustomer=(id)=>authenticatedCall(uid(30),`select public.ediel_review_customer_retention_v1('${uid(1)}','${uid(30)}','${id}','approve','SYNTHETIC separate personal-field review') b`)
 const pseudonymise=id=>authenticatedCall(uid(2),`select public.ediel_pseudonymise_customer_retention_v1('${uid(1)}','${uid(2)}','${id}') b`)
 const noLegal=await submitCustomer(Buffer.from('SYNTHETIC customer no legal decision'));assert.equal((await reviewCustomer(noLegal.decisionId)).status,'held');assert.equal((await pseudonymise(noLegal.decisionId)).status,'held')
 const customerDoc=Buffer.from('SYNTHETIC actual current customer field class'),current=await submitCustomer(customerDoc,await customerPolicy(customerDoc));assert.equal(current.issuerQualified,true);assert.equal((await reviewCustomer(current.decisionId)).status,'approved')
 assert.deepEqual((await pseudonymise(current.decisionId)).missing,['operative_customer_closed_and_no_active_supply'])
 await db.exec(`update customer_supply_periods set status='ended',actual_end_date=current_date-1 where id='${uid(6)}';update customers set email='changed@example.invalid' where id='${uid(3)}'`)
 assert.deepEqual((await pseudonymise(current.decisionId)).missing,['exact_native_customer_personal_fields_changed'])
 await db.exec(`update customers set email='synthetic@example.invalid' where id='${uid(3)}'`)
 await db.exec(`insert into user_permission_overrides(user_id,company_id,permission_key,effect,is_active) values('${uid(30)}','${uid(1)}','ediel.retention.review','deny',true)`);assert.deepEqual((await pseudonymise(current.decisionId)).missing,['current_retention_reviewer_authority']);await db.exec('delete from user_permission_overrides')
 const beforeHistory=(await db.query('select * from retained_customer_history order by kind')).rows,resultCustomer=await pseudonymise(current.decisionId);assert.equal(resultCustomer.status,'pseudonymised');assert.equal(resultCustomer.replay,false)
 const afterCustomer=(await db.query(`select status,first_name,last_name,email,personal_number,phone,full_name,metadata,anonymized_at is not null anonymized from customers where id='${uid(3)}'`)).rows[0];assert.deepEqual(afterCustomer,{status:'archived',first_name:null,last_name:null,email:null,personal_number:null,phone:null,full_name:'Pseudonymiserad kund',metadata:{},anonymized:true})
 assert.equal((await db.query(`select bool_and(status='revoked' and not is_active) revoked from customer_portal_accounts where customer_id='${uid(3)}'`)).rows[0].revoked,true);assert.equal((await db.query(`select bool_and(status='revoked') revoked from customer_portal_claims where customer_id='${uid(3)}'`)).rows[0].revoked,true)
 assert.deepEqual((await db.query('select * from retained_customer_history order by kind')).rows,beforeHistory);assert.equal((await pseudonymise(current.decisionId)).replay,true)
 assert.equal((await db.query("select count(*)::int n from audit_logs where action='ediel.retention.customer_pseudonymised'")).rows[0].n,1)
 await assert.rejects(()=>db.exec('delete from gridex_ediel_retention.customer_tombstones'),/append_only/)
 await assert.rejects(()=>db.exec(`update customers set email='reidentify@example.invalid' where id='${uid(3)}'`),/personal_fields_tombstoned/);await assert.rejects(()=>db.exec(`delete from customers where id='${uid(3)}'`),/no_tombstone_cascade/)
 console.log('PASS 12 customer class mechanics: no legal issuer hold, active supply hold, exact current hash change hold, current reviewer deny, portal revoke before personal fields pseudonymised, immutable source tombstone, retained invoice/meter/ACK boundaries and exact replay (synthetic schema/closure/issuer, NOT native or actual legal approval)')

 // Exact message-content + MIME class mechanics use synthetic schema/private
 // attempt/Storage boundaries here. Metadata DELETE is not physical evidence.
 await db.exec(`create schema storage;create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 create table ediel_message_payloads(id uuid primary key,company_id uuid,ediel_message_id uuid,payload_kind text,raw_payload text,encrypted_payload text,raw_payload_hash text,encrypted_payload_ref text,metadata jsonb);
 create table gridex_ediel_transport.attempts(id uuid primary key,company_id uuid,message_id uuid,environment text,entered_at timestamptz,binding jsonb);
 create table gridex_outbound_dispatch.attempts(id uuid primary key,company_id uuid,message_id uuid,binding jsonb);
 create table gridex_outbound_dispatch.events(attempt_id uuid,kind text);
 create table gridex_received_sources.sources(source_message_id uuid primary key,company_id uuid,environment text,origin text,raw_payload text,payload_hash text,source_received_at timestamptz,captured_at timestamptz default clock_timestamp(),received_context jsonb,CONSTRAINT received_source_hash_check CHECK(raw_payload IS NULL AND payload_hash IS NULL OR raw_payload IS NOT NULL AND payload_hash=encode(sha256(convert_to(raw_payload,'UTF8')),'hex')));
 create trigger received_sources_no_update_delete before update or delete on gridex_received_sources.sources for each row execute function gridex_received_sources.reject_mutation();
 alter table ediel_messages add parsed_payload jsonb default '{}',add validation_report jsonb default '{}',add metadata jsonb default '{}',add updated_at timestamptz;
 create function gridex_received_sources.synthetic_content_guard() returns trigger language plpgsql as $$begin if new.raw_payload is distinct from old.raw_payload then raise exception 'SYNTHETIC immutable existing public content guard';end if;return new;end$$;
 create trigger synthetic_existing_guard before update on ediel_messages for each row execute function gridex_received_sources.synthetic_content_guard();
 update ediel_messages set direction='inbound',parsed_payload='{"customer":"SYNTHETIC"}',validation_report='{"source":"SYNTHETIC"}',metadata='{"rawCopy":"SYNTHETIC"}' where id='${uid(7)}';
 insert into gridex_received_sources.sources(source_message_id,company_id,environment,origin,raw_payload,payload_hash) select id,company_id,environment,'database_insert',raw_payload,encode(sha256(convert_to(raw_payload,'UTF8')),'hex') from ediel_messages where id='${uid(7)}';
 insert into ediel_message_payloads(id,company_id,ediel_message_id,payload_kind,raw_payload,encrypted_payload,metadata) values('${uid(60)}','${uid(1)}','${uid(7)}','raw_edifact','SYNTHETIC COPY','SYNTHETIC CIPHER','{}');`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001000699_ediel_retention_source_trigger_prerequisite.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001000700_ediel_message_content_and_mime_retention.sql',import.meta.url),'utf8'))
 await grant(uid(2),['communication.write'])
 const blobSubmit=(kind,target,document,receipt=null)=>authenticatedCall(uid(2),`select public.ediel_submit_blob_retention_v1('${uid(1)}','${uid(2)}','${kind}','${target}',${quote(document.toString('base64'))},${receipt===null?'NULL':quote(receipt)}) b`)
 const blobReview=id=>authenticatedCall(uid(30),`select public.ediel_review_blob_retention_v1('${uid(1)}','${uid(30)}','${id}','approve','SYNTHETIC distinct class review') b`)
 const blobBegin=id=>authenticatedCall(uid(2),`select public.ediel_begin_blob_purge_v1('${uid(1)}','${uid(2)}','${id}') b`)
 const blobPolicy=async(kind,target,document)=>{const b=(await db.query(`select gridex_ediel_retention.blob_basis_v1('${uid(1)}','${kind}','${target}') b`)).rows[0].b,p={format:'ediel_blob_retention_policy_v1',retentionClass:kind,companyId:uid(1),targetId:target,messageId:b.messageId,sourceHash:b.sourceHash,targetHash:b.targetHash,documentHash:createHash('sha256').update(document).digest('hex'),issuerLegalReference:'SYNTHETIC LEGAL COMPETENCE TEST ONLY',legalBasisReference:'SYNTHETIC exact original class policy',issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString()},raw=Buffer.from(JSON.stringify(p));return{issuerId:uid(50),payloadBase64:raw.toString('base64'),signatureHex:createHmac('sha256',retentionKey).update(raw).digest('hex')}}
 const bare=await blobSubmit('received_ediel_message_content',uid(7),Buffer.from('SYNTHETIC absent policy'));assert.equal((await blobReview(bare.decisionId)).status,'held');assert.equal((await blobBegin(bare.decisionId)).status,'held')
 const originalDoc=Buffer.from('SYNTHETIC actual source+public+payload content legal class'),original=await blobSubmit('received_ediel_message_content',uid(7),originalDoc,await blobPolicy('received_ediel_message_content',uid(7),originalDoc));assert.equal(original.issuerQualified,true);assert.equal((await blobReview(original.decisionId)).status,'approved')
 await assert.rejects(()=>db.exec(`update ediel_messages set raw_payload='forged' where id='${uid(7)}'`),/immutable existing public/)
 const erasure=await blobBegin(original.decisionId);assert.equal(erasure.status,'purged');assert.equal(erasure.sourceHash,original.sourceHash);assert.equal(erasure.replay,false)
 assert.deepEqual((await db.query(`select raw_payload,parsed_payload,validation_report,metadata from ediel_messages where id='${uid(7)}'`)).rows[0],{raw_payload:null,parsed_payload:{},validation_report:{},metadata:{}})
 const durable=(await db.query(`select raw_payload,payload_hash,retention_purged_at is not null erased from gridex_received_sources.sources where source_message_id='${uid(7)}'`)).rows[0];assert.equal(durable.raw_payload,null);assert.equal(durable.payload_hash,original.sourceHash);assert.equal(durable.erased,true)
 assert.equal((await db.query(`select raw_payload is null and encrypted_payload is null erased from ediel_message_payloads where id='${uid(60)}'`)).rows[0].erased,true)
 assert.equal((await blobBegin(original.decisionId)).replay,true);await assert.rejects(()=>service(`select public.ediel_require_source_bytes_available_v1('${uid(1)}','${uid(7)}')`),/retention_tombstoned/)
 await assert.rejects(()=>db.exec(`update ediel_messages set raw_payload='repopulate' where id='${uid(7)}'`),/immutable existing public/);await assert.rejects(()=>db.exec(`update ediel_message_payloads set raw_payload='repopulate' where id='${uid(60)}'`),/retention_tombstoned/)
 const mime=Buffer.from('Message-ID: <synthetic@example.invalid>\r\n\r\nSYNTHETIC MIME'),mh=createHash('sha256').update(mime).digest('hex'),path=`transport/${uid(1)}/${uid(70)}/${mh}.eml`,mimeMetadata={archive_verified:true,archived_mime_sha256:mh,archived_mime_bytes:mime.length,archived_rfc_message_id:'<synthetic@example.invalid>'}
 await db.exec(`insert into ediel_messages(id,company_id,environment,direction,raw_payload) values('${uid(70)}','${uid(1)}','test','outbound','SYNTHETIC');insert into ediel_message_payloads(id,company_id,ediel_message_id,payload_kind,encrypted_payload_ref,metadata) values('${uid(71)}','${uid(1)}','${uid(70)}','raw_mime',${quote('storage://ediel-files/'+path)},${quote(mimeMetadata)});insert into gridex_ediel_transport.attempts values('${uid(72)}','${uid(1)}','${uid(70)}','test',now(),${quote({mimeSha256:mh,mimeArchiveRef:'storage://ediel-files/'+path,mimeLength:mime.length,rfcMessageId:mimeMetadata.archived_rfc_message_id})});insert into storage.objects(bucket_id,name,metadata) values('ediel-files',${quote(path)},'{}')`)
 await assert.rejects(()=>db.exec(`delete from storage.objects where name=${quote(path)}`),/native_class_purge_required/)
 const mimeDoc=Buffer.from('SYNTHETIC distinct exact MIME byte policy'),mimeDecision=await blobSubmit('transport_raw_mime_bytes',uid(71),mimeDoc,await blobPolicy('transport_raw_mime_bytes',uid(71),mimeDoc));assert.equal((await blobReview(mimeDecision.decisionId)).status,'approved');assert.equal((await blobBegin(mimeDecision.decisionId)).status,'storage_purge_pending')
 await assert.rejects(()=>authenticatedCall(uid(2),`select public.ediel_finish_blob_storage_purge_v1('${uid(1)}','${uid(2)}','${mimeDecision.decisionId}') b`),/actual_delete_receipt_required/)
 await db.exec(`insert into user_permission_overrides(user_id,company_id,permission_key,effect,is_active) values('${uid(30)}','${uid(1)}','ediel.retention.review','deny',true);select set_config('request.jwt.claim.sub','${uid(2)}',false)`)
 await assert.rejects(()=>db.exec(`delete from storage.objects where name=${quote(path)}`),/current_legal_purge_required/);await db.exec('delete from user_permission_overrides')
 await db.exec(`delete from storage.objects where name=${quote(path)}`) // SQL only: proves locked consumer admission, never physical Storage erasure.
 assert.equal((await db.query("select count(*)::int n from gridex_ediel_retention.blob_events where kind='storage_delete_authorized'")).rows[0].n,1)
 await assert.rejects(()=>db.exec(`insert into storage.objects(bucket_id,name,metadata) values('ediel-files',${quote(path)},'{}')`),/object_tombstoned/)
 console.log('PASS 15 message/MIME class mechanics: separate exact native fact/policy, absent decision hold, existing guard preserved, private/public/payload actual content removal with immutable hashes/tombstones, no repopulation/fresh authority, Storage actual-deletion admission/current-reviewer deny/no premature completion, no path reupload (synthetic boundaries; SQL Storage metadata deletion NOT physical/native evidence)')
 // Actual permission owner on a bounded schema; operative resolver below is
 // explicitly a stand-in reproducing its archived-company denial boundary.
 await db.exec(`ALTER TABLE companies ADD status text NOT NULL DEFAULT 'active';ALTER TABLE user_permission_overrides ADD valid_from timestamptz,ADD valid_to timestamptz;CREATE UNIQUE INDEX retention_fixture_permissions_key ON permissions(key);CREATE OR REPLACE FUNCTION public.gridex_actor_has_company_permission(a uuid,c uuid,p text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT EXISTS(SELECT FROM public.boundary_permissions b JOIN public.companies x ON x.id=b.company WHERE b.actor=a AND b.company=c AND b.permission=p AND b.allowed AND x.status='active')$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001000710_ediel_archived_tenant_retention_class_authority.sql',import.meta.url),'utf8'))
 const classPermission=async(actor,key)=>(await db.query(`SELECT gridex_ediel_retention.permission_v1('${uid(1)}','${actor}','${key}') allowed`)).rows[0].allowed
 assert.equal((await db.query("SELECT count(*)::int n FROM user_permissions WHERE permission_key IN('ediel.retention.source_bytes','ediel.retention.customer_fields','ediel.retention.original_bytes','ediel.retention.mime_bytes')")).rows[0].n,0)
 await assert.rejects(()=>blobBegin(mimeDecision.decisionId),/current_class_grant_required/)
 await grant(uid(2),['ediel.retention.source_bytes','ediel.retention.customer_fields','ediel.retention.original_bytes','ediel.retention.mime_bytes']);await grant(uid(30),['ediel.retention.source_bytes','ediel.retention.customer_fields','ediel.retention.original_bytes','ediel.retention.mime_bytes'])
 await db.exec(`UPDATE companies SET status='archived' WHERE id='${uid(1)}'`)
 assert.equal((await db.query(`SELECT public.gridex_actor_has_company_permission('${uid(2)}','${uid(1)}','communication.write') p`)).rows[0].p,false)
 assert.equal(await classPermission(uid(2),'communication.write'),false);assert.equal(await classPermission(uid(2),'ediel.retention.purge'),true);assert.equal(await classPermission(uid(2),'ediel.retention.mime_bytes'),true)
 assert.equal((await blobBegin(mimeDecision.decisionId)).status,'storage_purge_pending')
 await db.exec(`INSERT INTO user_permission_overrides(user_id,company_id,permission_key,effect,is_active) VALUES('${uid(2)}',NULL,'ediel.retention.mime_bytes','deny',true)`)
 assert.equal(await classPermission(uid(2),'ediel.retention.mime_bytes'),false);await assert.rejects(()=>blobBegin(mimeDecision.decisionId),/current_class_grant_required/)
 await db.exec(`UPDATE user_permission_overrides SET valid_to=now()-interval '1 second' WHERE user_id='${uid(2)}'`);assert.equal(await classPermission(uid(2),'ediel.retention.mime_bytes'),true)
 await db.exec(`DELETE FROM user_permission_overrides;INSERT INTO auth.users(id) VALUES('${uid(80)}');INSERT INTO user_profiles VALUES('${uid(80)}','active');INSERT INTO company_memberships VALUES('${uid(1)}','${uid(80)}','active',true,now());INSERT INTO user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect) SELECT '${uid(80)}',NULL,id,key,true,'active','allow' FROM permissions WHERE key='ediel.retention.purge'`)
 assert.equal(await classPermission(uid(80),'ediel.retention.purge'),false)
 await db.exec(`INSERT INTO roles(id,key,is_active) VALUES('${uid(81)}','SYNTHETIC global role',true);INSERT INTO user_roles(user_id,company_id,role_id,is_active,status) VALUES('${uid(2)}',NULL,'${uid(81)}',true,'active');INSERT INTO role_permissions(role_id,permission_id,permission_key,effect) SELECT '${uid(81)}',id,key,'deny' FROM permissions WHERE key='ediel.retention.mime_bytes'`)
 assert.equal(await classPermission(uid(2),'ediel.retention.mime_bytes'),false);await db.exec(`DELETE FROM role_permissions;DELETE FROM user_roles;DELETE FROM roles`)
 await db.exec(`UPDATE company_memberships SET accepted_at=NULL WHERE user_id='${uid(2)}'`);assert.equal(await classPermission(uid(2),'ediel.retention.mime_bytes'),false)
 console.log('PASS 12 archived-tenant/class authority mechanics: no default/global allow, separate explicit source/customer/original/MIME class grants, actual current auth+accepted own membership, global user/role deny and override time window; operative archived-company denial preserved (bounded synthetic resolver; NOT actual native/issuer approval)')

 await db.exec(`UPDATE company_memberships SET accepted_at=now() WHERE user_id='${uid(2)}'`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001022426_ediel_blob_retention_review_reads.sql',import.meta.url),'utf8'))
 const blobRead=(id,actor=uid(30),include=false,company=uid(1))=>authenticatedCall(actor,`select public.ediel_read_blob_retention_decision_v1('${company}','${actor}','${id}',${include}) b`)
 const history=await blobRead(original.decisionId)
 assert.equal(history.companyId,uid(1));assert.equal(history.sourceHash,original.sourceHash);assert.equal(history.documentBase64,null);assert.equal(history.currentQualified,false);assert.equal(history.purge.physicalBytesRemoved,true)
 const document=await blobRead(original.decisionId,uid(30),true)
 assert.equal(document.documentBase64,originalDoc.toString('base64'));assert.equal(document.documentHash,createHash('sha256').update(originalDoc).digest('hex'))
 const pendingRead=await blobRead(mimeDecision.decisionId)
 assert.equal(pendingRead.purge.physicalBytesRemoved,false,'SQL metadata deletion must never fabricate a physical Storage receipt')
 await assert.rejects(()=>blobRead(mimeDecision.decisionId,uid(30),false,uid(99)),/current_read_grant_required|current_actor_forbidden/)
 await assert.rejects(()=>blobRead(mimeDecision.decisionId,uid(80)),/current_read_grant_required/)
 await db.exec(`INSERT INTO user_permission_overrides(user_id,company_id,permission_key,effect,is_active) VALUES('${uid(30)}',NULL,'ediel.retention.mime_bytes','deny',true)`)
 const revokedBefore=(await db.query('select count(*)::int n from gridex_ediel_retention.blob_revocations')).rows[0].n
 await assert.rejects(()=>blobRead(mimeDecision.decisionId),/current_class_grant_required/)
 await assert.rejects(()=>authenticatedCall(uid(30),`select public.ediel_revoke_blob_retention_v1('${uid(1)}','${uid(30)}','${mimeDecision.decisionId}','SYNTHETIC denied revocation') b`),/current_class_grant_required/)
 assert.equal((await db.query('select count(*)::int n from gridex_ediel_retention.blob_revocations')).rows[0].n,revokedBefore)
 await db.exec('DELETE FROM user_permission_overrides')
 await authenticatedCall(uid(30),`select public.ediel_revoke_blob_retention_v1('${uid(1)}','${uid(30)}','${mimeDecision.decisionId}','SYNTHETIC own class revocation') b`)
 assert.equal((await blobRead(mimeDecision.decisionId)).revoked,true)
 await assert.rejects(()=>authenticatedCall(uid(30),`select public.ediel_revoke_blob_retention_before_class_guard_v1('${uid(1)}','${uid(30)}','${mimeDecision.decisionId}','BYPASS') b`),/permission denied/)
 await assert.rejects(()=>service(`select public.ediel_read_blob_retention_decision_v1('${uid(1)}','${uid(30)}','${mimeDecision.decisionId}',true) b`),/permission denied/)
 console.log('PASS 11 private review-reader/revocation mechanisms: current own actor and actual class, archived company history, exact original legal bytes/hash, no source/MIME byte export, metadata deletion cannot imply physical Storage finish, foreign/global/current deny no-effects, direct predecessor and service denial (bounded synthetic SQL; NOT native/issuer/physical proof)')

}finally{await db.close()}
