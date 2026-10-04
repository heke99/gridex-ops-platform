// masterplan: TR-08, AT-TR-08
// TR-08 relay-trace SQL over the bounded synthetic schema copied from the TR09
// regression. Synthetic headers only; no mail traffic. Run:
// EDIEL_PGLITE_MODULE=$PWD/node_modules/@electric-sql/pglite/dist/index.js node --experimental-strip-types scripts/ediel-tr-08-relay-trace-sql-regression.mjs
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const literal=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'"
const json=v=>literal(JSON.stringify(v))+'::jsonb',sha=v=>createHash('sha256').update(v).digest('hex')
const migration=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')
const extract=(file,name)=>{const sql=migration(file),start=sql.indexOf('create or replace function public.'+name+'('),end=sql.indexOf('$function$;',start);assert(start>=0&&end>start);return sql.slice(start,end+11)}
async function as(role,sql){try{return (await db.exec('set role '+role+';'+sql))[1].rows[0]}finally{await db.exec('reset role')}}
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.companies(id uuid PRIMARY KEY,status text,is_active boolean);
 CREATE TABLE public.user_profiles(id uuid,user_status text);
 CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 CREATE TABLE public.admin_users(user_id uuid,is_active boolean,role text);
 CREATE TABLE public.roles(id uuid,is_active boolean,key text,name text);
 CREATE TABLE public.user_roles(user_id uuid,role_id uuid,company_id uuid,is_active boolean,status text,role text);
 CREATE TABLE public.permissions(id uuid,key text,name text);
 CREATE TABLE public.role_permissions(role_id uuid,permission_id uuid,effect text);
 CREATE TABLE public.user_permissions(user_id uuid,permission_id uuid,company_id uuid,status text,is_active boolean,effect text);
 CREATE TABLE public.tenant_actor_identifiers(id uuid,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.tenant_actor_roles(id uuid,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.platform_actor_identifiers(id uuid,actor_id uuid,identifier_type text,identifier_value text,is_verified boolean,valid_from date,valid_to date);
 CREATE TABLE public.platform_actor_roles(id uuid,actor_id uuid,actor_role text,is_active boolean);
 CREATE TABLE public.communication_routes(id uuid,company_id uuid,is_active boolean);
 CREATE TABLE public.ediel_route_profiles(id uuid,company_id uuid,communication_route_id uuid,environment text,is_enabled boolean,is_active boolean,tls_required boolean,sender_ediel_id text,receiver_ediel_id text,smtp_to text,receiver_email text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,raw_payload text,immutable_payload_hash text,communication_route_id uuid,route_profile_id uuid,sender_ediel_id text,receiver_ediel_id text,receiver_email text);
 CREATE SCHEMA gridex_ediel_outbound_owner;
 CREATE TABLE gridex_ediel_outbound_owner.fixture_canonical_boundary(company_id uuid,message_id uuid,original_hash text);
 CREATE FUNCTION gridex_ediel_outbound_owner.require_v1(c uuid,m uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
  IF NOT EXISTS(SELECT FROM gridex_ediel_outbound_owner.fixture_canonical_boundary b JOIN public.ediel_messages e ON e.id=b.message_id AND e.company_id=b.company_id
    WHERE b.company_id=c AND b.message_id=m AND b.original_hash=e.immutable_payload_hash) THEN RAISE EXCEPTION 'fixture_canonical_boundary_missing';END IF;
  RETURN jsonb_build_object('fixtureBoundaryOnly',true);END$$;
 CREATE SCHEMA gridex_certificate_trust;
 CREATE TABLE gridex_certificate_trust.authority_versions(id uuid,company_id uuid,environment text,receiver_ediel_id text,valid_from timestamptz,valid_to timestamptz,crls jsonb);
 CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_outbound_dispatch;
 GRANT USAGE ON SCHEMA gridex_ediel_transport,gridex_outbound_dispatch TO service_role;
 CREATE TABLE gridex_ediel_transport.fixture_predecessor_effects(attempt_id uuid,action text);
 CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
  INSERT INTO gridex_ediel_transport.fixture_predecessor_effects VALUES((i->>'attemptId')::uuid,i->>'action');
  RETURN jsonb_build_object('proceed',true,'classification','accepted','observedAt',clock_timestamp());END$$;
 CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
  INSERT INTO gridex_ediel_transport.fixture_predecessor_effects VALUES((i->>'attemptId')::uuid,i->>'action');
  RETURN jsonb_build_object('scoped',true,'proceed',true,'classification','accepted');END$$;`)
 const normalizer=migration('20260727010000_contract_flow_integrity_completion.sql'),start=normalizer.indexOf('create or replace function public.gridex_normalize_platform_role('),end=normalizer.indexOf('$$;',start);assert(start>=0&&end>start);await db.exec(normalizer.slice(start,end+3))
 await db.exec(extract('20260924003724_company_direct_permission_scope_repair.sql','gridex_get_user_permissions_in_company'))
 await db.exec(extract('20260902100000_rpc_surface_and_permission_scope_corrections.sql','gridex_actor_has_company_permission'))
 await db.exec(`INSERT INTO companies VALUES('${uid(1)}','active',true);INSERT INTO auth.users VALUES('${uid(2)}',null,null),('${uid(3)}',null,null);
 INSERT INTO user_profiles VALUES('${uid(2)}','active'),('${uid(3)}','active');
 INSERT INTO company_memberships VALUES('${uid(1)}','${uid(2)}','active',true,clock_timestamp()),('${uid(1)}','${uid(3)}','active',true,clock_timestamp());
 INSERT INTO permissions VALUES('${uid(20)}','communication.write','communication.write'),('${uid(21)}','communication.send','communication.send');
 INSERT INTO user_permissions VALUES('${uid(2)}','${uid(20)}','${uid(1)}','active',true,'allow'),('${uid(2)}','${uid(21)}','${uid(1)}','active',true,'allow'),('${uid(3)}','${uid(20)}','${uid(1)}','active',true,'allow');
 INSERT INTO tenant_actor_identifiers VALUES('${uid(30)}','${uid(1)}','test','${uid(2)}','EdielId','43210','2020-01-01',null);
 INSERT INTO tenant_actor_roles VALUES('${uid(31)}','${uid(1)}','test','${uid(2)}','electricity_supplier','2020-01-01',null);
 INSERT INTO platform_actor_identifiers VALUES('${uid(32)}','${uid(33)}','EdielId','76543',true,'2020-01-01',null);
 INSERT INTO platform_actor_roles VALUES('${uid(34)}','${uid(33)}','grid_owner',true);
 INSERT INTO communication_routes VALUES('${uid(5)}','${uid(1)}',true);
 INSERT INTO ediel_route_profiles VALUES('${uid(6)}','${uid(1)}','${uid(5)}','test',true,true,true,'43210','76543','synthetic@example.invalid',null,null,null);
 INSERT INTO ediel_messages VALUES('${uid(4)}','${uid(1)}','test','outbound','edifact','PRODAT','Z03','bounded synthetic outbound PRODAT','${sha('bounded synthetic outbound PRODAT')}','${uid(5)}','${uid(6)}','43210','76543','synthetic@example.invalid');
 INSERT INTO gridex_ediel_outbound_owner.fixture_canonical_boundary VALUES('${uid(1)}','${uid(4)}','${sha('bounded synthetic outbound PRODAT')}');`)
 await db.exec(migration('20261001000609_ediel_source_owned_temporary_transport_exceptions.sql'));checks++
 await db.exec(migration('20261004190000_ediel_tr08_relay_trace_evidence.sql'));checks++
 const {verifyRelayTrace}=await import(new URL('../lib/ediel/transport/relayTrace.ts',import.meta.url).href)
 const probe='probe-0000-synthetic-tr08'
 const headers=tls=>[
  'Received: from mx.mailbox.example.invalid (localhost [127.0.0.1]) by mailbox.example.invalid with LMTP id a1; Sun, 4 Oct 2026 12:00:03 +0200',
  'Received: from relay.provider.example.invalid (relay.provider.example.invalid [192.0.2.20]) by mx.mailbox.example.invalid with '+(tls?'ESMTPS id b2 (version=TLS1_3 cipher=TLS_AES_256_GCM_SHA384)':'ESMTP id b2')+'; Sun, 4 Oct 2026 12:00:02 +0200',
  'Received: from smtp.own.example.invalid (smtp.own.example.invalid [192.0.2.10]) by relay.provider.example.invalid with ESMTPS id c3 (using TLSv1.3 with cipher TLS_AES_128_GCM_SHA256); Sun, 4 Oct 2026 12:00:01 +0200',
  'Received: from app.example.invalid ([198.51.100.5]) by smtp.own.example.invalid with ESMTPSA id d4 (TLSv1.2:ECDHE-RSA-AES256-GCM-SHA384); Sun, 4 Oct 2026 12:00:00 +0200',
  'Authentication-Results: mx.mailbox.example.invalid; spf=pass smtp.mailfrom=own.example.invalid',
  'X-Gridex-Relay-Probe: '+probe,'Subject: probe',''].join('\r\n')
 const ok=headers(true),bad=headers(false),own=['smtp.own.example.invalid']
 const vOk=verifyRelayTrace({rawHeaders:ok,probeId:probe,ownHosts:own}),vBad=verifyRelayTrace({rawHeaders:bad,probeId:probe,ownHosts:own})
 assert.equal(vOk.verified,true);assert.equal(vBad.verified,false);checks++
 const record=(raw,v,actor=uid(2))=>'SELECT public.ediel_record_relay_trace_v1('+[literal(uid(1)),"'test'",literal(actor),"convert_to("+literal(raw)+",'UTF8')",json(v)].join(',')+') id;'
 await assert.rejects(as('authenticated',record(ok,vOk)),/permission denied/);checks++
 await assert.rejects(as('service_role',record(ok,vOk,uid(98))),/current_actor_required/);checks++
 // A forged "verified" verdict over a trace with a plaintext hop is refused by the database.
 await assert.rejects(as('service_role',record(bad,{...vOk,rawHeadersSha256:vBad.rawHeadersSha256})),/relay_trace_verdict_inconsistent/);checks++
 // A verdict not bound to the stored original bytes is refused.
 await assert.rejects(as('service_role',record(bad,{...vBad,rawHeadersSha256:vOk.rawHeadersSha256})),/check constraint/);checks++
 const badId=(await as('service_role',record(bad,vBad))).id;assert.ok(badId);checks++
 const okId=(await as('service_role',record(ok,vOk))).id;assert.ok(okId);checks++
 await assert.rejects(db.exec("UPDATE gridex_relay_trace.observations SET verified=true WHERE id='"+badId+"'"),/relay_trace_evidence_immutable/);checks++
 const latest=(await as('service_role','SELECT public.ediel_read_relay_trace_v1('+literal(uid(1))+",'test',"+literal(uid(2))+') r;')).r
 assert.equal(latest.originalSha256,vOk.rawHeadersSha256);assert.equal(latest.rawHeaders,ok);checks++
 // allRelayHopsVerified is only accepted when bound to a verified persisted trace.
 const now=Date.now(),from=new Date(now-60000).toISOString(),to=new Date(now+600000).toISOString()
 const base={schema:'gridex_transport_exception_incident_v1',normativeSha256:'5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951',companyId:uid(1),messageId:uid(4),environment:'test',originalHash:sha('bounded synthetic outbound PRODAT'),routeId:uid(5),senderEdielId:'43210',receiverEdielId:'76543',receiverEmail:'synthetic@example.invalid',case:'temporary_encryption_failure',
  tls:{required:true,allRelayHopsVerified:true,certificateVerified:true,minimumVersion:'TLS1.2',originalReference:'synthetic://bounded-tls-owner',originalSha256:'a'.repeat(64),validFrom:from,validTo:to},
  counterparty:{receiverEdielId:'76543',temporaryReserveConfirmed:true,originalReference:'synthetic://bounded-counterparty-owner',originalSha256:'b'.repeat(64),validFrom:from,validTo:to},
  incident:{temporaryOnly:true,failureCode:'cms_encryption_failed',originalSha256:'c'.repeat(64),observedAt:from}}
 const approval=s=>({schema:'gridex_transport_exception_approval_v1',sourceDigest:sha(JSON.stringify(s)),companyId:uid(1),messageId:uid(4),case:s.case,approved:true,approvedBy:uid(3),approvalReference:'synthetic://bounded-reviewer-only',validFrom:from,validTo:to,maximumAttempts:2})
 const publish=s=>'SELECT public.ediel_publish_transport_exception_v1('+[literal(uid(1)),literal(uid(4)),literal(uid(2)),"convert_to("+literal(JSON.stringify(s))+",'UTF8')","convert_to("+literal(JSON.stringify(approval(s)))+",'UTF8')"].join(',')+') id;'
 const owner='gridex_ediel_transport_exception_owner'
 await assert.rejects(as(owner,publish(base)),/transport_relay_trace_evidence_required/);checks++
 await assert.rejects(as(owner,publish({...base,tls:{...base.tls,relayTraceSha256:vBad.rawHeadersSha256}})),/transport_relay_trace_evidence_required/);checks++
 await assert.rejects(as(owner,publish({...base,tls:{...base.tls,relayTraceSha256:'f'.repeat(64)}})),/transport_relay_trace_evidence_required/);checks++
 assert.ok((await as(owner,publish({...base,tls:{...base.tls,relayTraceSha256:vOk.rawHeadersSha256}}))).id);checks++
 console.log('TR-08 relay trace SQL (ACL, actor, DB-side verdict consistency, hash binding, immutability, approval binding): '+checks+' PASS; synthetic headers, no mail traffic')
}finally{await db.close()}
