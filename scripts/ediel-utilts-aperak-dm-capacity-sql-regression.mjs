// Focused PostgreSQL mechanics: actual lexer/source matcher/three consumers.
// Stored positive/header authority are declared private IO fixtures. This is
// not native replay, transport acceptance, authentic registry or legal proof.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required; pinned @electric-sql/pglite@0.3.14')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const sql=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')
const own='APE'+'F'.repeat(32)
function envelope({family='UTILTS',revision='02B',association='E5SE5A',sender='REMOTE',receiver='LOCAL',body,interchange='ORIGINAL'}={}){
 const message=`UNH+1+${family}:D:${revision}:UN:${association}'${body}`
 return `UNB+UNOC:3+${sender}:14+${receiver}:14+261001:1200+${interchange}++23-DDQ-E66-T++++1'${message}UNT+${message.split("'").filter(Boolean).length+1}+1'UNZ+1+${interchange}'`
}
const source=code=>envelope({body:`BGM+${code}::260+DOC+9+AB'NAD+MS+REMOTE::9'NAD+MR+LOCAL::9'IDE+24+FIRST'IDE+24+SECOND'`})
const ack=(dm,negative=false)=>envelope({family:'APERAK',revision:'04A',sender:'LOCAL',receiver:'REMOTE',interchange:'ACK',body:`BGM+${negative?'313':'312'}+ACKDOC+9'DOC+E66:SVK:260+DOC'NAD+MS+LOCAL::9'NAD+MR+REMOTE::9'ERC+${negative?'42':'100'}::260'FTX+AAO+${negative?'+505::260+INCORRECT DATA X':'++OK'}'RFF+DM:${dm}'RFF+ACW:FIRST'`})
let checks=0
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema gridex_ediel_ack_guide;create schema gridex_ediel_wire_namespace;create schema gridex_utilts_binding;create schema gridex_ack_authority;create schema gridex_ediel_outbound_owner;create schema gridex_received_sources;
 create table gridex_ediel_ack_guide.editions(source_version text primary key,input_manifest jsonb,projection jsonb);create table gridex_ediel_ack_guide.edition_extensions(original_source_version text primary key,extended_source_version text);
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,raw_payload text,related_message_id uuid);
 create table public.ediel_ack_transaction_results(company_id uuid,environment text,source_message_id uuid,source_transaction_id text,disposition text,planned_response_type text,final_response_type text,response_message_id uuid,finalized_at timestamptz);
 create table gridex_received_sources.fixture_header(company_id uuid,source_message_id uuid,errors jsonb);
 create function gridex_received_sources.require_utilts_header_v1(c uuid,s uuid)returns jsonb language plpgsql as $$declare h jsonb;begin select errors into h from gridex_received_sources.fixture_header where company_id=c and source_message_id=s;if h is null then raise exception 'fixture_header_source_required';end if;return jsonb_build_object('applicationErrors',h);end$$;
 create table gridex_received_sources.fixture_positive(company_id uuid,environment text,source_message_id uuid,transaction_id text,ack_id uuid,raw_sha text);
 create function public.gridex_require_utilts_positive_ack_authority_v1(c uuid,e text,s uuid,t text,a uuid default null,r text default null)returns jsonb language plpgsql as $$begin if not exists(select from gridex_received_sources.fixture_positive where company_id=c and environment=e and source_message_id=s and transaction_id=t and (a is null or (ack_id=a and raw_sha=encode(sha256(convert_to(r,'UTF8')),'hex'))))then raise exception 'fixture_positive_source_required';end if;return '{"qualifiedPrivateBoundary":true}'::jsonb;end$$;`)
 const lexer=sql('20260923135706_ediel_utilts_consumption_binding_v1.sql')
 await db.exec(lexer.slice(lexer.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),lexer.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
 const wire=sql('20260930170932_ediel_inbound_ack_source_atomic_authority.sql')
 await db.exec(wire.slice(wire.indexOf('CREATE FUNCTION gridex_ack_authority.wire_v1'),wire.indexOf('CREATE TABLE gridex_ack_authority.scope_outcomes')))
 const groups=sql('20260930202616_ediel_native_aperak_own_erc_scope.sql')
 await db.exec(groups.slice(groups.indexOf('CREATE OR REPLACE FUNCTION gridex_ack_authority.wire_v1'),groups.indexOf('CREATE OR REPLACE FUNCTION gridex_ediel_outbound_owner.require_positive_utilts_ack_v1')))
 const retained=sql('20260930223930_ediel_outbound_ack_original_read_authority.sql')
 await db.exec(retained.slice(retained.indexOf('DO $$DECLARE body text;needle text:'),retained.indexOf('-- A technical syntax reply')))
 const publication=sql('20261001034855_ediel_prodat_aperak_unused_document_fields.sql')
 await db.exec(publication.slice(publication.indexOf('-- BEGIN CANONICAL RESPONSE GUIDE PROJECTION'),publication.indexOf('-- END CANONICAL RESPONSE GUIDE PROJECTION')))
 await db.exec(sql('20261001051413_ediel_utilts_aperak_dm_source_capacity.sql'));checks++
 const keys=async raw=>(await db.query('select gridex_ediel_wire_namespace.keys($1) r',[raw])).rows[0].r
 for(const reference of [own+'-1','D'.repeat(70)]){assert.ok((await keys(ack(reference))).some(k=>k.kind==='DM'&&k.value===reference));checks++}
 await assert.rejects(keys(ack('D'.repeat(71))),/ediel_wire_reference_source_invalid/);checks++
 await assert.rejects(keys(ack(own+'-1').replace('APERAK:D:04A:UN:E5SE5A','APERAK:D:96A:UN:E2SE6A')),/ediel_wire_reference_source_invalid/);checks++
 await assert.rejects(keys(ack('DM').replace('BGM+312+ACKDOC','BGM+312+'+'D'.repeat(36))),/ediel_wire_reference_source_invalid/);checks++
 await assert.rejects(keys(source('E66').replace('IDE+24+FIRST','IDE+24+'+'I'.repeat(36))),/ediel_wire_reference_source_invalid/);checks++
 await db.query("insert into ediel_messages values($1,$2,'test','inbound','UTILTS',$3,null)",[uid(10),uid(1),source('E66')])
 await db.query("insert into gridex_received_sources.fixture_positive values($1,'test',$2,'FIRST',null,null)",[uid(1),uid(10)])
 const guard=async(raw,sourceId=10,sending=false)=>db.query('select gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(m,$2) from (select $1::uuid id,$3::uuid company_id,\'test\'::text environment,\'outbound\'::text direction,\'APERAK\'::text message_family,$4::text raw_payload,$5::uuid related_message_id)m',[uid(20),sending,uid(1),raw,uid(sourceId)])
 for(const reference of [own+'-1','D'.repeat(70)]){await guard(ack(reference));checks++}
 await assert.rejects(guard(ack('D'.repeat(71))),/utilts_positive_ack_storage_unavailable/);checks++
 await assert.rejects(guard(ack(own+'-1').replace('RFF+ACW:FIRST','RFF+ACW:SECOND')),/fixture_positive_source_required/);checks++
 await db.query("insert into ediel_ack_transaction_results values($1,'test',$2,'FIRST','guide_rejected','negative_aperak',null,null,null)",[uid(1),uid(10)])
 await guard(ack(own+'-1',true));checks++
 await assert.rejects(guard(ack(own+'-1',true),10,true),/utilts_negative_ack_reservation_unavailable/);checks++
 await db.query("update ediel_ack_transaction_results set final_response_type='positive_aperak',response_message_id=$1,finalized_at=now()",[uid(99)])
 await assert.rejects(guard(ack(own+'-1',true)),/utilts_negative_ack_reservation_unavailable/);checks++
 assert.equal((await db.query('select final_response_type v from ediel_ack_transaction_results')).rows[0].v,'positive_aperak');checks++
 await db.query("insert into ediel_messages values($1,$2,'test','inbound','UTILTS_ERR',$3,null)",[uid(11),uid(1),source('ERR')])
 await db.query("insert into gridex_received_sources.fixture_positive values($1,'test',$2,'FIRST',null,null)",[uid(1),uid(11)])
 for(const reference of [own+'-2','D'.repeat(70)]){await guard(ack(reference).replace('DOC+E66','DOC+ERR'),11);checks++}
 await assert.rejects(guard(ack('D'.repeat(71)).replace('DOC+E66','DOC+ERR'),11),/utilts_err_application_response_authority_unavailable/);checks++
 await assert.rejects(guard(ack(own+'-2').replace('DOC+E66','DOC+ERR'),11,true),/fixture_positive_source_required/);checks++
 const acl=(await db.query("select has_function_privilege('service_role','gridex_ediel_wire_namespace.keys(text)','execute') direct_keys,has_function_privilege('authenticated','gridex_ediel_ack_guide.utilts_reference_constraints_v1()','execute') caller_cfg,has_function_privilege('service_role','gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(public.ediel_messages,boolean)','execute') direct_guard")).rows[0]
 assert.deepEqual(acl,{direct_keys:false,caller_cfg:false,direct_guard:false});checks++
 console.log(`Focused actual lexical/native DM source-limit/reservation/immutable-outcome/ACL mechanics: ${checks} PASS`)
}finally{await db.close()}
