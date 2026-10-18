// masterplan: AT-Z09B-SUPPLIER
// Dated BRP history through the real origination (20260930200545, 211156,
// 230653) and confirmation (20261011170000) SQL in embedded PostgreSQL, with a
// controlled wall clock (PGlite reads JS Date.now() for now()). Proves: two
// dated BRP versions of one supply period are both kept, the first unchanged,
// and history closes v1 exactly at v2; a same-company sibling period and a
// foreign tenant stay untouched; the exact one-calendar-month notice boundary
// in fixed UTC+1 (Etc/GMT-1), including month-end clamping; wrong grid area,
// agreement and actors are held; an AI list creates no version.
// The received supply-source helper and the ACK authority tables are declared
// fixtures with their installed shapes; this is not native/authentic evidence.
import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';import assert from'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const realNow=Date.now;let clock=null;Date.now=()=>clock??realNow()
const at=iso=>{clock=Date.parse(iso);if(!Number.isFinite(clock))throw Error(`bad clock ${iso}`)}
at('2027-01-10T09:00:00Z')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const quote=s=>"'"+s.replaceAll("'","''")+"'",json=x=>quote(JSON.stringify(x))+'::jsonb',migration=name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8')
let checks=0
try{
 assert.equal((await db.query('SELECT now()::text n')).rows[0].n,'2027-01-10 09:00:00+00');checks++
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE companies(id uuid PRIMARY KEY);CREATE TABLE customers(id uuid PRIMARY KEY,company_id uuid);CREATE TABLE customer_supply_periods(id uuid PRIMARY KEY,company_id uuid);CREATE TABLE metering_points(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,ediel_metering_point_id text,grid_owner_ediel_id text,grid_area_code text,site_id uuid);CREATE TABLE customer_sites(id uuid PRIMARY KEY,company_id uuid,customer_id uuid);
 CREATE TABLE user_profiles(id uuid PRIMARY KEY,user_status text);CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE sql AS 'SELECT true';
 CREATE TABLE platform_market_actors(id uuid PRIMARY KEY,status text,match_status text);CREATE TABLE platform_actor_roles(id uuid DEFAULT gen_random_uuid(),actor_id uuid,actor_role text,is_active bool);CREATE TABLE platform_actor_identifiers(id uuid DEFAULT gen_random_uuid(),actor_id uuid,identifier_type text,identifier_value text,is_verified bool,valid_from date,valid_to date);
 CREATE TABLE tenant_ediel_profiles(id uuid DEFAULT gen_random_uuid(),company_id uuid,environment text,market text,is_enabled bool,valid_from timestamptz,valid_to timestamptz);CREATE TABLE tenant_actor_roles(id uuid DEFAULT gen_random_uuid(),company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);CREATE TABLE tenant_actor_identifiers(id uuid DEFAULT gen_random_uuid(),company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE ediel_message_intents(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,operation_id uuid,customer_id uuid,metering_point_id text,validation_status text,application_reference text,communication_route_id uuid,route_profile_id uuid,interchange_reference text,message_reference text,transaction_reference text,sender_ediel_id text,receiver_ediel_id text,sender_subaddress text,receiver_subaddress text,customer_site_id uuid);
 CREATE TABLE outbound_requests(id uuid PRIMARY KEY,company_id uuid,request_type text,source_type text,source_id uuid,customer_id uuid,communication_route_id uuid,metering_point_id uuid,operation_id uuid,site_id uuid,payload jsonb);
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,intent_id uuid,raw_payload text,source_operation_id text,outbound_request_id uuid,customer_id uuid,metering_point_id uuid,communication_route_id uuid,route_profile_id uuid,sender_ediel_id text,receiver_ediel_id text,interchange_reference text,transaction_reference text,site_id uuid);
 CREATE SCHEMA gridex_received_sources;CREATE FUNCTION gridex_received_sources.permission_transition_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'source_immutable';END$$;
 -- Declared fixture of the shared supply-source owner, keyed by tenant and period.
 CREATE TABLE gridex_received_sources.supply_fixture(company_id uuid,supply_period_id uuid,basis jsonb,PRIMARY KEY(company_id,supply_period_id));
 CREATE FUNCTION gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz) RETURNS jsonb LANGUAGE sql AS 'SELECT basis FROM gridex_received_sources.supply_fixture WHERE company_id=$1 AND supply_period_id=$2';CREATE SCHEMA gridex_utilts_binding;`)
 await db.exec(migration('20260923135706_ediel_utilts_consumption_binding_v1.sql').match(/CREATE FUNCTION gridex_utilts_binding\.wire_tokens_v1[\s\S]*?END \$\$;/)[0])
 await db.exec(migration('20260930200545_ediel_brp_change_source_origination.sql'))
 await db.exec(migration('20260930211156_ediel_brp_approved_supply_physical_scope.sql'))
 await db.exec(migration('20260930230653_ediel_source_producer_physical_site_scope.sql'))
 await db.exec(`ALTER TABLE ediel_messages ADD COLUMN status text DEFAULT 'sent',ADD COLUMN contrl_status text DEFAULT 'pending',ADD COLUMN aperak_status text DEFAULT 'pending';
  CREATE SCHEMA gridex_ack_authority;
  CREATE TABLE gridex_ack_authority.source_correlations(ack_message_id uuid PRIMARY KEY,source_message_id uuid NOT NULL,company_id uuid NOT NULL,environment text NOT NULL,source_payload_hash text NOT NULL,ack_family text NOT NULL,ack_outcome text NOT NULL);
  CREATE TABLE gridex_ack_authority.scope_outcomes(source_message_id uuid,ack_family text,outcome text,ack_message_id uuid)`)
 await db.exec(migration('20261011170000_ediel_brp_change_ack_received_confirmation.sql'));checks++

 // Market registry: one DSO, two BRPs, and an actor that is not a BRP.
 await db.exec(`INSERT INTO platform_market_actors VALUES('${id(7)}','active','verified'),('${id(8)}','active','verified'),('${id(31)}','active','verified'),('${id(33)}','active','verified');
  INSERT INTO platform_actor_roles(actor_id,actor_role,is_active) VALUES('${id(7)}','grid_owner',true),('${id(8)}','balance_responsible',true),('${id(31)}','balance_responsible',true),('${id(33)}','grid_owner',true);
  INSERT INTO platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified,valid_from) VALUES('${id(7)}','EdielId','54321',true,'2000-01-01'),('${id(8)}','EdielId','11111',true,'2000-01-01'),('${id(31)}','EdielId','33333',true,'2000-01-01'),('${id(33)}','EdielId','44444',true,'2000-01-01')`)
 const tenant=async(c,actor,legal,legalEdiel)=>db.exec(`INSERT INTO companies VALUES('${c}');INSERT INTO auth.users VALUES('${actor}');INSERT INTO user_profiles VALUES('${actor}','active');INSERT INTO company_memberships VALUES('${c}','${actor}','active',true,'2026-01-01');
  INSERT INTO tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES('${c}','test','${legal}','EdielId','${legalEdiel}','2000-01-01');
  INSERT INTO tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES('${c}','test','${legal}','electricity_supplier','2000-01-01');
  INSERT INTO tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES('${c}','test','electricity',true,'2000-01-01')`)
 const A=id(1),B=id(2),actorA=id(20),actorB=id(21)
 await tenant(A,actorA,id(9),'12345');await tenant(B,actorB,id(29),'67890')
 const ground=(n,c,brp,area,version='SYNTHETIC-REGISTRY',validFrom='2000-01-01')=>db.exec(`INSERT INTO gridex_brp_changes.registry_grounds(id,company_id,environment,dso_actor_id,brp_actor_id,dso_ediel_id,brp_ediel_id,grid_area_code,registry_version,source_reference,source_sha256,registry_snapshot,approved_by,approved_at,valid_from)
  SELECT '${id(n)}','${c}','test','${id(7)}',a.id,'54321',i.identifier_value,'${area}','${version}','SYNTHETIC ORIGINAL ${n}',repeat('a',64),gridex_brp_changes.registry_snapshot_v1('${id(7)}',a.id),'${c===A?actorA:actorB}','2027-01-01','${validFrom}'
  FROM platform_market_actors a JOIN platform_actor_identifiers i ON i.actor_id=a.id WHERE a.id='${brp}'`)
 await ground(11,A,id(8),'TES');await ground(12,A,id(31),'TES');await ground(13,B,id(8),'TES')
 await ground(43,A,id(8),'XXX');await ground(44,A,id(8),'TES','FUTURE-REGISTRY','2027-06-01');await ground(45,A,id(33),'TES')
 // Supply periods: A's own, A's sibling period (another customer/point) and B's period on the same physical point id.
 const periods={}
 const period=async(key,c,{period,customer,mp,site,supplyMessage,point,legal})=>{periods[key]={c,period,customer,mp,site,supplyMessage,point,legal}
  await db.exec(`INSERT INTO customers VALUES('${customer}','${c}');INSERT INTO customer_supply_periods VALUES('${period}','${c}');INSERT INTO customer_sites VALUES('${site}','${c}','${customer}');
   INSERT INTO metering_points VALUES('${mp}','${c}','${customer}','${point}','54321','TES','${site}');
   INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code) VALUES('${supplyMessage}','${c}','test','inbound','PRODAT','Z04');
   INSERT INTO gridex_received_sources.supply_fixture VALUES('${c}','${period}',${json({qualified:true,companyId:c,siteId:site,customerId:customer,meteringPointId:mp,legalActorId:legal,sourceMessageId:supplyMessage,marketStateVersion:1,dsoEdielId:'54321',sourceObjects:[{point,identityAgency:'9',gridArea:'TES'}]})})`)}
 await period('A',A,{period:id(4),customer:id(3),mp:id(5),site:id(22),supplyMessage:id(6),point:'735123456789012345',legal:id(9)})
 await period('sibling',A,{period:id(24),customer:id(23),mp:id(25),site:id(26),supplyMessage:id(27),point:'735123456789012346',legal:id(9)})
 await period('B',B,{period:id(54),customer:id(53),mp:id(55),site:id(56),supplyMessage:id(57),point:'735123456789012345',legal:id(29)})
 // Events carry the effective local (UTC+1) minute; the stored instant is that minute in Etc/GMT-1.
 const events={}
 const event=(n,key,localEffective,{groundId=11,legal=periods[key].legal,legalEdiel=key==='B'?'67890':'12345',stateVersion=1}={})=>{events[n]={key,groundId,legalEdiel}
  const p=periods[key];return db.exec(`INSERT INTO gridex_brp_changes.events(id,company_id,environment,supply_period_id,customer_id,metering_point_id,legal_actor_id,legal_sender_id,point_id,identity_agency,registry_ground_id,supply_source_message_id,supply_state_version,effective_at,brp_contract_reference,brp_contract_sha256,brp_contract_version,market_decision_reference,source_reference,source_sha256,source_version,approved_by,approved_at)
   VALUES('${id(n)}','${p.c}','test','${p.period}','${p.customer}','${p.mp}','${legal}','${legalEdiel}','${p.point}','9','${id(groundId)}','${p.supplyMessage}',${stateVersion},timestamp '${localEffective}' AT TIME ZONE 'Etc/GMT-1','SYNTHETIC CONTRACT ${n}',repeat('b',64),'fixture','SYNTHETIC DECISION ${n}','SYNTHETIC EVENT ${n}',repeat('c',64),'fixture','${p.c===A?actorA:actorB}','2027-01-01')`)}
 const actorOf=n=>periods[events[n].key].c===A?actorA:actorB
 const source=(n,actor=actorOf(n))=>db.query(`SELECT ediel_brp_change_source_v1('${periods[events[n].key].c}','${id(n)}','${actor}') result`).then(r=>r.rows[0].result)
 const routeOf=k=>({intent:id(200+k),request:id(300+k),message:id(400+k)})
 const prepare=async(n,k)=>{const p=periods[events[n].key],r=routeOf(k),transport=p.c===A?'99111':'99222'
  await db.exec(`INSERT INTO ediel_message_intents VALUES('${r.intent}','${p.c}','test','outbound','PRODAT','Z09','${id(n)}','${p.customer}','${p.point}','validated','23-DDQ-PRODAT','${id(13)}','${id(14)}','UNB-${k}','1','LI-${k}','${transport}','54321',NULL,NULL,'${p.site}');
   INSERT INTO outbound_requests VALUES('${r.request}','${p.c}','customer_masterdata','manual','${r.intent}','${p.customer}','${id(13)}','${p.mp}','${id(n)}','${p.site}','{"environment":"test"}')`)}
 const reserve=(n,k)=>db.query(`SELECT ediel_reserve_brp_change_origin_v1('${periods[events[n].key].c}','${id(n)}','${actorOf(n)}','${routeOf(k).intent}','${routeOf(k).request}') result`).then(r=>r.rows[0].result)
 const wire=async(n,k)=>{const p=periods[events[n].key],e=events[n],transport=p.c===A?'99111':'99222'
  const brp=(await db.query(`SELECT brp_ediel_id FROM gridex_brp_changes.registry_grounds WHERE id='${id(e.groundId)}'`)).rows[0].brp_ediel_id
  const stamp=(await db.query(`SELECT to_char(effective_at AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI') value FROM gridex_brp_changes.events WHERE id='${id(n)}'`)).rows[0].value
  return `UNB+UNOC:3+${transport}:ZZ+54321:ZZ+270110:1000+UNB-${k}++23-DDQ-PRODAT'UNH+1+PRODAT:D:96B:UN:E2SE6A'BGM+Z09+UNB-${k}+9'NAD+FR+${e.legalEdiel}:160:SVK'NAD+DO+54321:160:SVK'LIN+1++${p.point}:SR::9'DTM+157:${stamp}:203'CCI++Z13'CAV+Z27'RFF+Z05:TES'RFF+LI:LI-${k}'NAD+Z02+${brp}:160:SVK'UNT+12+1'UNZ+1+UNB-${k}'`}
 const bind=async(n,k,{family='PRODAT',code='Z09',raw}={})=>{const p=periods[events[n].key],r=routeOf(k),transport=p.c===A?'99111':'99222'
  return db.exec(`INSERT INTO ediel_messages VALUES('${r.message}','${p.c}','test','outbound','${family}','${code}','${r.intent}',${quote(raw??await wire(n,k))},'${id(n)}','${r.request}','${p.customer}','${p.mp}','${id(13)}','${id(14)}','${transport}','54321','UNB-${k}','LI-${k}','${p.site}')`)}
 const originate=async(n,k)=>{await prepare(n,k);assert.equal((await reserve(n,k)).status,"reserved",JSON.stringify(await reserve(n,k)));await bind(n,k)}
 let ackN=500
 const ack=async(msg,c,family,outcome)=>{const a=id(ackN++),hash=(await db.query(`SELECT payload_hash h FROM gridex_brp_changes.origins WHERE message_id='${msg}'`)).rows[0]?.h??'f'.repeat(64)
  await db.exec(`BEGIN;INSERT INTO gridex_ack_authority.source_correlations VALUES('${a}','${msg}','${c}','test','${hash}','${family}','${outcome}');INSERT INTO gridex_ack_authority.scope_outcomes VALUES('${msg}','${family}','${outcome}','${a}');COMMIT`)}
 const confirm=async(msg,c)=>{await ack(msg,c,'CONTRL','positive');await ack(msg,c,'APERAK','positive')}
 const history=(c,p,actor=c===A?actorA:actorB)=>db.query(`SELECT ediel_brp_responsibility_history_v1('${c}','${p}','${actor}') result`).then(r=>r.rows[0].result.versions)
 const count=async table=>Number((await db.query(`SELECT count(*) n FROM ${table}`)).rows[0].n)
 const rowsOf=async(c,p)=>({
  versions:(await db.query(`SELECT * FROM gridex_brp_changes.period_versions WHERE company_id='${c}' AND supply_period_id='${p}' ORDER BY effective_at`)).rows,
  origins:(await db.query(`SELECT o.* FROM gridex_brp_changes.origins o JOIN gridex_brp_changes.events e ON e.id=o.event_id WHERE e.company_id='${c}' AND e.supply_period_id='${p}' ORDER BY o.event_id`)).rows,
  confirmations:(await db.query(`SELECT k.* FROM gridex_brp_changes.confirmations k JOIN gridex_brp_changes.events e ON e.id=k.event_id WHERE e.company_id='${c}' AND e.supply_period_id='${p}' ORDER BY k.event_id`)).rows,
  messages:(await db.query(`SELECT m.* FROM ediel_messages m JOIN gridex_brp_changes.origins o ON o.message_id=m.id JOIN gridex_brp_changes.events e ON e.id=o.event_id WHERE e.company_id='${c}' AND e.supply_period_id='${p}' ORDER BY m.id`)).rows})
 const instant=v=>new Date(v).toISOString()

 // v1 (BRP 11111) effective 2027-03-01 00:00 local; sibling and foreign versions are originated and confirmed first.
 await event(100,'A','2027-03-01 00:00');await event(102,'sibling','2027-03-01 00:00');await event(103,'B','2027-03-31 00:00',{groundId:13})
 assert.equal((await source(100)).status,'authorized');checks++
 await originate(100,1);await confirm(routeOf(1).message,A)
 await originate(102,2);await confirm(routeOf(2).message,A)
 await originate(103,3);await confirm(routeOf(3).message,B)
 assert.equal(await count('gridex_brp_changes.period_versions'),3);assert.equal(await count('gridex_brp_changes.confirmations'),3);checks++
 const h1=await history(A,id(4));assert.equal(h1.length,1);assert.equal(h1[0].status,'aperak_confirmed');assert.equal(h1[0].effectiveUntil,null);assert.equal(instant(h1[0].effectiveAt),'2027-02-28T23:00:00.000Z');checks++
 const v1Before=await rowsOf(A,id(4)),siblingBefore=await rowsOf(A,id(24)),foreignBefore=await rowsOf(B,id(54))
 const siblingHistoryBefore=await history(A,id(24)),foreignHistoryBefore=await history(B,id(54))
 assert.equal(v1Before.versions.length,1);assert.equal(v1Before.confirmations.length,1);assert.equal(siblingBefore.versions.length,1);assert.equal(foreignBefore.versions.length,1);checks++

 // (c) Exact notice boundary: SQL holds when now() > ((effective local) - interval '1 month') in Etc/GMT-1.
 // v1 2027-03-01 00:00 local: boundary 2027-02-01 00:00 local = 2027-01-31T23:00Z (not UTC midnight).
 at('2027-01-31T22:59:00Z');assert.equal((await source(100)).status,'authorized');checks++
 at('2027-01-31T23:00:00Z');assert.equal((await source(100)).status,'authorized');checks++
 at('2027-01-31T23:01:00Z');assert.deepEqual(await source(100),{status:'held',missing:['one_calendar_month_notice_boundary']});checks++
 at('2027-02-01T00:00:00Z');assert.deepEqual(await source(100),{status:'held',missing:['one_calendar_month_notice_boundary']});checks++
 // v2 (BRP 33333) effective 2027-03-31 00:00 local: interval '1 month' clamps to 2027-02-28 00:00 local = 2027-02-27T23:00Z.
 await event(101,'A','2027-03-31 00:00',{groundId:12})
 at('2027-02-27T22:59:00Z');assert.equal((await source(101)).status,'authorized');checks++
 at('2027-02-27T23:01:00Z');assert.deepEqual(await source(101),{status:'held',missing:['one_calendar_month_notice_boundary']});checks++
 // No day-overflow reading (2027-03-03) and no 2027-03-01 reading: both are already held.
 at('2027-02-28T23:00:00Z');assert.deepEqual(await source(101),{status:'held',missing:['one_calendar_month_notice_boundary']});checks++
 await prepare(101,4)
 // A held reservation creates no origin and no version.
 at('2027-02-27T23:01:00Z');assert.deepEqual(await reserve(101,4),{status:'held',missing:['one_calendar_month_notice_boundary']})
 assert.equal(await count(`gridex_brp_changes.origins WHERE event_id='${id(101)}'`),0);assert.equal(await count('gridex_brp_changes.period_versions'),3);checks++
 // At the exact boundary minute the real reservation and bind succeed.
 at('2027-02-27T23:00:00Z');assert.equal((await source(101)).status,'authorized');assert.equal((await reserve(101,4)).status,'reserved');checks++
 // (e) An AI list on v2's reserved intent cannot be bound as a BRP change; no version.
 await assert.rejects(bind(101,4,{family:'AI_LIST',code:'AI',raw:'SYNTHETIC AI LIST balansansvarsId=33333'}),/brp_change_exact_wire_basis_required/)
 assert.equal(await count('gridex_brp_changes.period_versions'),3);assert.equal((await db.query(`SELECT message_id FROM gridex_brp_changes.origins WHERE event_id='${id(101)}'`)).rows[0].message_id,null);checks++
 await db.exec(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload) VALUES('${id(98)}','${A}','test','outbound','AI_LIST','AI','SYNTHETIC AI LIST balansansvarsId=33333')`)
 await confirm(id(98),A);assert.equal(await count('gridex_brp_changes.period_versions'),3);assert.equal(await count('gridex_brp_changes.confirmations'),3);assert.equal((await history(A,id(4))).length,1);checks++
 // The bind evaluates the same boundary: one minute later the genuine Z09 is refused.
 at('2027-02-27T23:01:00Z');await assert.rejects(bind(101,4),/brp_change_exact_wire_basis_required/);assert.equal(await count('gridex_brp_changes.period_versions'),3);checks++
 at('2027-02-27T23:00:00Z');await bind(101,4);assert.equal(await count('gridex_brp_changes.period_versions'),4);checks++

 // (a) Two distinct dated versions: v2 declared, then confirmed by its own ACKs; v1 unchanged throughout.
 at('2027-02-28T09:00:00Z')
 let h=await history(A,id(4))
 assert.equal(h.length,2);assert.deepEqual(h.map(v=>v.eventId),[id(100),id(101)]);assert.deepEqual(h.map(v=>v.brpEdielId),['11111','33333'])
 assert.equal(instant(h[0].effectiveUntil),instant(h[1].effectiveAt));assert.equal(instant(h[1].effectiveAt),'2027-03-30T23:00:00.000Z');assert.equal(h[1].effectiveUntil,null)
 assert.deepEqual(h.map(v=>v.status),['aperak_confirmed','source_declared']);checks++
 await ack(routeOf(4).message,A,'CONTRL','positive');assert.equal((await history(A,id(4)))[1].status,'source_declared');checks++
 await ack(routeOf(4).message,A,'APERAK','positive')
 h=await history(A,id(4));assert.deepEqual(h.map(v=>v.status),['aperak_confirmed','aperak_confirmed']);assert.equal(h[1].confirmationMessageId,routeOf(4).message);assert.equal(h[0].confirmationMessageId,routeOf(1).message)
 assert.equal(instant(h[0].effectiveUntil),'2027-03-30T23:00:00.000Z');assert.equal(h[1].effectiveUntil,null);assert.ok(h.every(v=>v.marketActivationProven===false&&v.sourceRevoked===false));checks++
 const after=await rowsOf(A,id(4))
 assert.deepEqual(after.versions[0],v1Before.versions[0]);assert.deepEqual(after.origins[0],v1Before.origins[0]);assert.deepEqual(after.confirmations[0],v1Before.confirmations[0]);assert.deepEqual(after.messages[0],v1Before.messages[0]);checks++
 assert.equal(after.versions.length,2);assert.notEqual(after.versions[1].source_payload_hash,after.versions[0].source_payload_hash);checks++
 // The dated version is immutable and its date unique per tenant/environment/period.
 await assert.rejects(db.exec(`UPDATE gridex_brp_changes.period_versions SET effective_at=effective_at+interval '1 day' WHERE event_id='${id(100)}'`),/source_immutable/);checks++
 await assert.rejects(event(104,'A','2027-03-01 00:00',{groundId:12}),/duplicate key|unique/i);checks++

 // (b) The sibling period and the foreign tenant are untouched; v2 closes neither.
 assert.deepEqual(await rowsOf(A,id(24)),siblingBefore);assert.deepEqual(await history(A,id(24)),siblingHistoryBefore);assert.equal(siblingHistoryBefore[0].effectiveUntil,null);checks++
 assert.deepEqual(await rowsOf(B,id(54)),foreignBefore);assert.deepEqual(await history(B,id(54)),foreignHistoryBefore);assert.equal(foreignHistoryBefore[0].effectiveUntil,null);assert.equal(foreignHistoryBefore[0].brpEdielId,'11111');checks++
 // Same physical point id and same effective instant across tenants do not join histories.
 assert.equal(instant(foreignHistoryBefore[0].effectiveAt),instant(h[1].effectiveAt));assert.ok(!h.some(v=>v.eventId===id(103)));checks++
 await assert.rejects(history(B,id(54),actorA),/actor_forbidden/);await assert.rejects(history(A,id(4),actorB),/actor_forbidden/);checks++
 await assert.rejects(history(A,id(54)),/relation_unavailable/);checks++
 // Foreign ACK evidence for A's v2 message (other tenant) confirms nothing new for B.
 await ack(routeOf(4).message,B,'APERAK','positive');assert.deepEqual(await rowsOf(B,id(54)),foreignBefore);checks++

 // (d) Wrong area, agreement or actor is held and creates nothing (each its own dated event).
 const held=async(n,k,missing)=>{assert.deepEqual(await source(n),{status:'held',missing:[missing]});await prepare(n,k)
  assert.deepEqual(await reserve(n,k),{status:'held',missing:[missing]});assert.equal(await count(`gridex_brp_changes.origins WHERE event_id='${id(n)}'`),0);checks++}
 const versionsBefore=await count('gridex_brp_changes.period_versions')
 await event(110,'A','2027-05-01 00:00',{groundId:43});await held(110,10,'brp_change_owned_point_dso_and_grid')
 await event(111,'A','2027-05-02 00:00',{groundId:44});await held(111,11,'authentic_versioned_dso_brp_registry_ground')
 await event(112,'A','2027-05-03 00:00',{stateVersion:2});await held(112,12,'current_source_approved_supply_relation')
 await event(113,'A','2027-05-04 00:00',{legal:id(30)});await held(113,13,'current_source_approved_supply_relation')
 await event(114,'A','2027-05-05 00:00',{groundId:45});await held(114,14,'current_exact_verified_registry_actors_and_roles')
 await event(115,'A','2027-05-06 00:00',{legalEdiel:'99999'});await held(115,15,'current_unique_legal_supplier_profile')
 // A user who is not an active member of the tenant is refused outright.
 await assert.rejects(source(100,actorB),/actor_forbidden/);checks++
 // A correct-looking wire for a held (unreserved) event binds nothing: no origin, no version.
 await bind(110,10);assert.equal(await count(`gridex_brp_changes.origins WHERE event_id='${id(110)}'`),0);assert.equal(await count('gridex_brp_changes.period_versions'),versionsBefore);checks++
 // Nothing above altered the two dated versions or their confirmations.
 assert.deepEqual(await rowsOf(A,id(4)),after);assert.deepEqual(await rowsOf(A,id(24)),siblingBefore);assert.deepEqual(await rowsOf(B,id(54)),foreignBefore);checks++
 console.log(`PASS ${checks} AT-Z09B BRP dated history PostgreSQL checks; controlled clock, declared source/supply/ACK fixtures, not native/authentic evidence`)
}finally{await db.close();Date.now=realNow}
