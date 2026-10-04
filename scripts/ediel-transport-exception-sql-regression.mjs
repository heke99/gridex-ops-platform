// Execute prospective TR09 SQL over a bounded synthetic schema. The actual
// permission resolver is retained; transport predecessor/canonical source and
// external issuer evidence are declared fixture boundaries, not native proof.
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
 const now=Date.now(),from=new Date(now-60000).toISOString(),to=new Date(now+600000).toISOString()
 const original={schema:'gridex_transport_exception_incident_v1',normativeSha256:'5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951',companyId:uid(1),messageId:uid(4),environment:'test',originalHash:sha('bounded synthetic outbound PRODAT'),routeId:uid(5),senderEdielId:'43210',receiverEdielId:'76543',receiverEmail:'synthetic@example.invalid',case:'temporary_encryption_failure',
  tls:{required:true,allRelayHopsVerified:true,certificateVerified:true,minimumVersion:'TLS1.2',originalReference:'synthetic://bounded-tls-owner',originalSha256:'a'.repeat(64),validFrom:from,validTo:to},
  counterparty:{receiverEdielId:'76543',temporaryReserveConfirmed:true,originalReference:'synthetic://bounded-counterparty-owner',originalSha256:'b'.repeat(64),validFrom:from,validTo:to},
  incident:{temporaryOnly:true,failureCode:'cms_encryption_failed',originalSha256:'c'.repeat(64),observedAt:from}}
 const approval=s=>({schema:'gridex_transport_exception_approval_v1',sourceDigest:sha(JSON.stringify(s)),companyId:uid(1),messageId:uid(4),case:s.case,approved:true,approvedBy:uid(3),approvalReference:'synthetic://bounded-reviewer-only',validFrom:from,validTo:to,maximumAttempts:2})
 const publish=(s=original,a=approval(s))=>'SELECT public.ediel_publish_transport_exception_v1('+[literal(uid(1)),literal(uid(4)),literal(uid(2)),"convert_to("+literal(JSON.stringify(s))+",'UTF8')","convert_to("+literal(JSON.stringify(a))+",'UTF8')"].join(',')+') id;'
 const read=id=>'SELECT public.ediel_read_transport_exception_v1('+[1,4,2].map(n=>literal(uid(n))).concat(literal(id)).join(',')+') r;'
 assert.equal((await as('service_role',read(uid(99)))).r.status,'held');checks++
 const acl=(await db.query("SELECT rolcanlogin login,(SELECT count(*)::int FROM pg_auth_members WHERE roleid=r.oid) members FROM pg_roles r WHERE rolname='gridex_ediel_transport_exception_owner'")).rows[0];assert.deepEqual(acl,{login:false,members:0});checks++
 await assert.rejects(as('service_role',publish()),/permission denied/);await assert.rejects(as('authenticated',read(uid(99))),/permission denied/);checks++
 for(const s of [{...original,case:'disable_tls'},{...original,tls:{...original.tls,required:false}},{...original,tls:{...original.tls,allRelayHopsVerified:null}},{...original,originalHash:'f'.repeat(64)}]){
  await assert.rejects(as('gridex_ediel_transport_exception_owner',publish(s)),/transport_exception/);checks++
 }
 const id=(await as('gridex_ediel_transport_exception_owner',publish())).id,authorized=(await as('service_role',read(id))).r;assert.equal(authorized.status,'authorized');assert.equal(authorized.sourceDigest,sha(JSON.stringify(original)));checks++
 const binding=Object.fromEntries(['approvalId','originalHash','case','sourceDigest','approvalDigest','tlsEvidenceDigest','priorCrlSha256','certificateAuthorityId','cdpLocations'].map(k=>[k,authorized[k]]))
 const input=(action,attempt=40,b=binding)=>({companyId:uid(1),messageId:uid(4),environment:'test',actorUserId:uid(2),attemptId:uid(attempt),action,binding:{mimeMode:'ediel-singlepart-base64',transportException:b}})
 const mutate=i=>'SELECT gridex_ediel_transport.mutate_v1('+json(i)+') r;'
 await as('service_role',mutate(input('prepare')));assert.equal((await db.query('SELECT count(*)::int n FROM gridex_transport_exception.alarms')).rows[0].n,1);checks++
 await db.exec("UPDATE user_permissions SET is_active=false WHERE permission_id='"+uid(21)+"'")
 await assert.rejects(as('service_role',mutate(input('enter'))),/current_actor_required/);assert.equal((await db.query("SELECT count(*)::int n FROM gridex_ediel_transport.fixture_predecessor_effects WHERE action='enter'")).rows[0].n,0);checks++
 await db.exec("UPDATE user_permissions SET is_active=true WHERE permission_id='"+uid(21)+"'")
 await as('service_role',mutate(input('enter')));await as('service_role',mutate(input('observe')));checks++
 await assert.rejects(as('service_role',mutate(input('prepare',41,{...binding,tlsEvidenceDigest:'f'.repeat(64)}))),/fresh_exact_attempt_binding/);assert.equal((await db.query('SELECT count(*)::int n FROM gridex_transport_exception.operations')).rows[0].n,1);checks++
 await as('service_role',mutate(input('prepare',42)));await assert.rejects(as('service_role',mutate(input('prepare',43))),/budget_exhausted/);checks++
 await assert.rejects(db.exec("UPDATE gridex_transport_exception.approvals SET source_digest='"+'f'.repeat(64)+"'"),/journal_immutable/);checks++
 const revoke={schema:'gridex_transport_exception_revocation_v1',approvalId:id,companyId:uid(1),reasonReference:'synthetic://bounded-withdrawal'}
 await as('gridex_ediel_transport_exception_owner',"SELECT public.ediel_revoke_transport_exception_v1("+literal(id)+','+literal(uid(3))+",convert_to("+literal(JSON.stringify(revoke))+",'UTF8'));")
 assert.equal((await as('service_role',read(id))).r.status,'held');await assert.rejects(as('service_role',mutate(input('enter',42))),/fresh_entry_authority/);checks++
 const ownAlarms=(await as('service_role','SELECT public.ediel_transport_exception_alarms_v1('+literal(uid(1))+','+literal(uid(3))+') r;')).r;assert.equal(ownAlarms.length,2);assert(ownAlarms.every(a=>a.facts.mandatoryTls===true&&a.facts.administratorAlarm===true));checks++
 const noCert={...original,case:'recipient_certificate_unavailable',incident:{directorySearchCompleted:true,resultCount:0,originalSha256:'d'.repeat(64),observedAt:from}}
 const noCertId=(await as('gridex_ediel_transport_exception_owner',publish(noCert))).id;assert.equal((await as('service_role',read(noCertId))).r.case,'recipient_certificate_unavailable');checks++
 await assert.rejects(as('gridex_ediel_transport_exception_owner',publish({...noCert,incident:{...noCert.incident,directorySearchCompleted:false}})),/completed_no_certificate_search/);checks++
 await db.query('INSERT INTO gridex_certificate_trust.authority_versions VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(90),uid(1),'test','76543',from,to,JSON.stringify(['synthetic bounded previous CRL original'])])
 await assert.rejects(as('service_role',read(noCertId)),/completed_no_certificate_search/);checks++
 const crl={...original,case:'crl_refresh_failure',incident:{observedAt:from,allCertificateCdpsAttempted:true,nearestPreviousCachedCrl:true,certificateAuthorityId:uid(90),
  cdpResults:[{cdp:'https://synthetic.example.invalid/current.crl',result:'failed',originalSha256:'e'.repeat(64)}],
  priorCrlSha256:[sha('synthetic bounded previous CRL original')]}}
 const crlId=(await as('gridex_ediel_transport_exception_owner',publish(crl))).id,crlRead=(await as('service_role',read(crlId))).r
 assert.equal(crlRead.certificateAuthorityId,uid(90));assert.deepEqual(crlRead.priorCrlSha256,crl.incident.priorCrlSha256);assert.deepEqual(crlRead.cdpLocations,['https://synthetic.example.invalid/current.crl']);checks++
 await assert.rejects(as('gridex_ediel_transport_exception_owner',publish({...crl,incident:{...crl.incident,allCertificateCdpsAttempted:null}})),/all_cdp_failure/);checks++
 await assert.rejects(as('gridex_ediel_transport_exception_owner',publish({...crl,incident:{...crl.incident,priorCrlSha256:['f'.repeat(64)]}})),/previous_crl_original_changed/);checks++
 console.log('TR09 actual publisher/ACL/current grants/immutable sources/native stage rollback/attempt budget/alarm SQL: '+checks+' PASS; bounded synthetic transport and issuer boundaries, not native or external approval')
}finally{await db.close()}
