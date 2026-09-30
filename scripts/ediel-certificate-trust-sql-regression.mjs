// Targeted embedded PostgreSQL checks of prospective source ownership. Public
// material and owner decisions here are synthetic contracts, never live Ediel
// registration, native replay, legal authority or production activation proof.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite(), company='00000000-0000-0000-0000-000000000001', actor='00000000-0000-0000-0000-000000000002'
const literal=v=>`'${String(v).replaceAll("'","''")}'`, json=v=>`${literal(JSON.stringify(v))}::jsonb`
let checks=0
const scope={companyId:company,environment:'test',receiverEdielId:'synthetic-receiver',registerVersion:'synthetic-v1',originalReference:'synthetic://unit-register',legalAuthorityReference:'synthetic://unit-legal',processAuthorityReference:'synthetic://unit-process',ownerRegisterReference:'synthetic://unit-owner',actorUserId:actor,validFrom:'2020-01-01T00:00:00Z',validTo:'2099-01-01T00:00:00Z'}
const materials={recipientFingerprints:['a'.repeat(64)],anchors:['synthetic-public-anchor'],intermediates:[],crls:['synthetic-public-crl']}
const publish=(s=scope,m=materials,original='synthetic immutable register')=>`select public.gridex_ediel_certificate_trust_publish_v1(${json(s)},convert_to(${literal(original)},'UTF8'),${json(m)}) id;`
const read=(receiver='synthetic-receiver',env='test',tenant=company)=>`select public.gridex_ediel_certificate_trust_read_v1('${tenant}',${literal(env)},${literal(receiver)}) result;`
async function as(role,sql){try{return (await db.exec(`set role ${role};${sql}`))[1].rows[0]}finally{await db.exec('reset role')}}
async function rejects(role,sql,re){await assert.rejects(as(role,sql),re);checks++}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create table companies(id uuid primary key);create table company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);create table user_profiles(id uuid,user_status text);create function gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select true';insert into companies values('${company}');insert into company_memberships values('${company}','${actor}','active',true,now());insert into user_profiles values('${actor}','active');`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930163734_ediel_versioned_certificate_trust_authority_v1.sql',import.meta.url),'utf8'));checks++
 assert.equal((await as('service_role',read())).result,null);checks++
 const ownership=(await db.query(`select rolcanlogin login,(select count(*)::int from pg_auth_members where roleid=r.oid) members from pg_roles r where rolname='gridex_ediel_certificate_authority_owner'`)).rows[0]
 assert.deepEqual(ownership,{login:false,members:0});checks++
 await rejects('service_role',publish(),/permission denied/)
 await rejects('authenticated',read(),/permission denied/)
 await rejects('gridex_ediel_certificate_authority_owner',publish({...scope,actorUserId:'00000000-0000-0000-0000-000000000099'}),/config_actor_not_authorized/)
 const id=(await as('gridex_ediel_certificate_authority_owner',publish())).id
 const result=(await as('service_role',read())).result
 assert.equal(result.registrationId,id);assert.equal(result.originalSha256,createHash('sha256').update('synthetic immutable register').digest('hex'));assert.deepEqual(result.recipientFingerprints,materials.recipientFingerprints);checks++
 assert.equal((await as('gridex_ediel_certificate_authority_owner',publish())).id,id);checks++
 await rejects('gridex_ediel_certificate_authority_owner',publish(scope,materials,'changed original'),/version_conflict/)
 await rejects('gridex_ediel_certificate_authority_owner',publish(scope,{...materials,recipientFingerprints:['b'.repeat(64)]}),/version_conflict/)
 await rejects('gridex_ediel_certificate_authority_owner',publish({...scope,registerVersion:'bad'}, {...materials,anchors:{claimed:'verified'}}),/public_originals_invalid/)
 await rejects('service_role',`update gridex_certificate_trust.authority_versions set valid_to=now();`,/permission denied/)
 await assert.rejects(db.exec(`update gridex_certificate_trust.authority_versions set valid_to=now();`),/authority_immutable/);checks++
 assert.equal((await as('service_role',read('other'))).result,null);assert.equal((await as('service_role',read('synthetic-receiver','production'))).result,null);assert.equal((await as('service_role',read('synthetic-receiver','test','00000000-0000-0000-0000-000000000099'))).result,null);checks++
 await as('gridex_ediel_certificate_authority_owner',publish({...scope,registerVersion:'synthetic-v2'}))
 await rejects('service_role',read(),/versions_overlap/)
 console.log(`PASS ${checks} targeted trust-owner PostgreSQL checks; synthetic authority contract only, no native replay or authentic mandate proof`)
}finally{await db.close()}
