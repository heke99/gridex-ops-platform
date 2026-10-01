// Focused source-edition mechanics. The minimal named checker below is an
// explicit boundary fixture: this does not claim native full replay, actor,
// legal identity or actual transport proof. The actual forward and qualified
// reason projection execute unchanged.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '/tmp/ediel-service-check/node_modules/@electric-sql/pglite/dist/index.js'
const db=new PGlite();let checks=0
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema gridex_ediel_ack_guide;create schema gridex_received_sources;
 create table gridex_ediel_ack_guide.editions(source_version text primary key,input_manifest jsonb,projection jsonb);
 create table gridex_ediel_ack_guide.edition_extensions(original_source_version text primary key,extended_source_version text);
 create function gridex_received_sources.reject_mutation() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
 create table public.ediel_messages(source_version text,rule_pack jsonb);
 create function gridex_ediel_ack_guide.projection_for_original_v1(p_source_version text) returns jsonb language sql as $$select projection from gridex_ediel_ack_guide.editions where source_version=p_source_version$$;
 create function gridex_ediel_ack_guide.require_before_prodat_scope_v1(m public.ediel_messages) returns jsonb language plpgsql as $$declare b record;basis jsonb;projection jsonb;begin select m.source_version source_version into b;basis:=jsonb_build_object('snapshot',jsonb_build_object('rulePack',m.rule_pack));projection:=gridex_ediel_ack_guide.projection_for_original_v1(b.source_version);return projection;end$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001002414_ediel_inherited_err_reason_guides.sql',import.meta.url),'utf8'))
 const fresh=(await db.query('select source_version,projection from gridex_ediel_ack_guide.editions')).rows[0];assert.ok(fresh.projection.utiltsErrReasonGuideScopes);checks++
 const original={...fresh.projection};delete original.utiltsErrReasonGuideScopes
 await db.query('insert into gridex_ediel_ack_guide.editions values($1,$2,$3)',['actual-protected-prior-edition',{},original])
 const check=async(version,revision)=>(await db.query("select gridex_ediel_ack_guide.require_before_prodat_scope_v1(row('actual-protected-prior-edition',jsonb_build_object('family','UTILTS','guide_version',$1::text,'guide_revision',$2::text))::public.ediel_messages) p",[version,revision])).rows[0].p
 const prior=await check('25-A-3','3'),current=await check('25-A-4','4')
 assert.ok(prior.utiltsErr.allowedReasons.includes('E19'));assert.ok(!current.utiltsErr.allowedReasons.includes('E19'));checks+=2
 assert.deepEqual(prior.constraints,original.constraints);assert.deepEqual(current.constraints,original.constraints);checks++
 assert.deepEqual((await db.query('select projection from gridex_ediel_ack_guide.editions where source_version=$1',['actual-protected-prior-edition'])).rows[0].projection,original);checks++
 await assert.rejects(check('FUTURE','3'),/ediel_original_err_reason_scope_unavailable/);await assert.rejects(check('25-A-3','4'),/ediel_original_err_reason_scope_unavailable/);checks+=2
 assert.ok(!fresh.projection.utiltsErr.allowedReasons.includes('E19'));checks++
 const altered={...original,utiltsErr:{...original.utiltsErr,documentCode:'OTHER'}}
 await db.query('insert into gridex_ediel_ack_guide.editions values($1,$2,$3)',['incompatible-frozen-edition',{},altered])
 await assert.rejects(db.query('select gridex_ediel_ack_guide.projection_for_original_v1($1)',['incompatible-frozen-edition']),/ediel_original_err_reason_scope_unavailable/);checks++
 await assert.rejects(db.exec('delete from gridex_ediel_ack_guide.err_reason_source_editions'),/immutable/);checks++
 const acl=(await db.query("select has_function_privilege('service_role','gridex_ediel_ack_guide.qualify_err_reason_projection_v1(jsonb,jsonb)','execute') direct,has_table_privilege('service_role','gridex_ediel_ack_guide.err_reason_source_editions','insert') write")).rows[0];assert.deepEqual(acl,{direct:false,write:false});checks++
 console.log(`PASS ${checks} focused inherited ERR reason SQL checks; synthetic named-checker boundary, no native replay claim`)
}finally{await db.close()}
