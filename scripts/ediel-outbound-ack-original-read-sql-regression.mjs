// Focused current SQL read predicates over minimal schema boundaries. Declared
// synthetic born witnesses/bytes are not native replay or legal market proof.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite();let checks=0
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,company=uid(1),source=uid(2),ack=uid(3),hash=raw=>createHash('sha256').update(raw).digest('hex')
const file=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')
function wire(type,body,reverse=false,app='23-DDQ-E66-T'){
 const seg=[`UNB+UNOC:3+${reverse?'B:ZZ:R+A:ZZ:S':'A:ZZ:S+B:ZZ:R'}+261001:0000+${reverse?'ACK-I':'SOURCE-I'}++${app}++++1`,`UNH+1+${type}`,...body]
 return "UNA:+.? '"+[...seg,`UNT+${body.length+2}+1`,`UNZ+1+${reverse?'ACK-I':'SOURCE-I'}`].join("'")+"'"
}
const raw=wire('UTILTS:D:02B:UN:E5SE5A',['BGM+E66::260+SOURCE-D+9+AB','NAD+MS+A:SVK:260','NAD+MR+B:SVK:260','IDE+24+OWN','IDE+24+SIBLING'])
const response=(tx='OWN',doc='SOURCE-D')=>wire('APERAK:D:04A:UN:E5SE5A',['BGM+312+ACK-D+9',`DOC+E66:SVK:260+${doc}`,'NAD+MS+B:SVK:260','NAD+MR+A:SVK:260','ERC+100::260',`RFF+ACW:${tx}`],true)
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ack_authority;CREATE SCHEMA gridex_ediel_technical_ack;CREATE SCHEMA gridex_ediel_common_header;CREATE SCHEMA gridex_ediel_outbound_owner;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,related_message_id uuid,status text,ack_outcome text,immutable_rendered_at timestamptz,immutable_payload_hash text,created_at timestamptz DEFAULT now());
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid,company_id uuid,environment text,payload_hash text,raw_payload text);
 CREATE TABLE gridex_ediel_technical_ack.sources(source_message_id uuid,company_id uuid,environment text,payload_sha256 text,status text);
 CREATE TABLE gridex_ediel_technical_ack.replies(source_message_id uuid,company_id uuid,environment text,payload_sha256 text,evidence jsonb);
 CREATE TABLE gridex_ediel_common_header.sources(source_message_id uuid,company_id uuid,environment text,payload_sha256 text,status text);
 CREATE TABLE gridex_ediel_common_header.negative_witnesses(id uuid,company_id uuid,environment text,source_message_id uuid,payload_sha256 text);
 CREATE TABLE gridex_ediel_common_header.negative_consumptions(witness_id uuid,ack_message_id uuid,company_id uuid,environment text,payload_sha256 text);
 CREATE TABLE gridex_ediel_outbound_owner.witnesses(id uuid,company_id uuid,environment text,payload_sha256 text,related_message_id uuid,family text,code text);
 CREATE TABLE gridex_ediel_outbound_owner.consumptions(witness_id uuid,source_message_id uuid,company_id uuid,environment text,payload_sha256 text);`)
 const lexer=file('20260923135706_ediel_utilts_consumption_binding_v1.sql');await db.exec(lexer.slice(lexer.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),lexer.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
 const original=file('20260930170932_ediel_inbound_ack_source_atomic_authority.sql');await db.exec(original.slice(original.indexOf('CREATE FUNCTION gridex_ack_authority.wire_v1'),original.indexOf('CREATE TABLE gridex_ack_authority.scope_outcomes')))
 const first14=file('20260930203615_ediel_ack_first14_and_committed_replay.sql');await db.exec(first14.slice(first14.indexOf('CREATE OR REPLACE FUNCTION gridex_ack_authority.source_match_v1'),first14.indexOf('CREATE TABLE gridex_ack_authority.applied_receipts')))
 const header=file('20260930221910_ediel_complete_technical_header_observation.sql');await db.exec(header.slice(header.indexOf('CREATE OR REPLACE FUNCTION'),header.indexOf('COMMIT;')))
 await db.exec(file('20260930223930_ediel_outbound_ack_original_read_authority.sql'));checks++
 async function message(id,bytes,direction='outbound',family='APERAK',code='312',tenant=company,related=source){await db.query('insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,related_message_id,status,ack_outcome,immutable_rendered_at,immutable_payload_hash) values($1,$2,\'test\',$3,$4,$5,$6,$7,\'failed\',\'negative\',now(),$8)',[id,tenant,direction,family,code,bytes,related,hash(bytes)])}
 async function born(id,bytes,related=source){await db.query('insert into gridex_ediel_outbound_owner.witnesses values($1,$2,\'test\',$3,$4,\'APERAK\',\'312\')',[id,company,hash(bytes),related]);await db.query('insert into gridex_ediel_outbound_owner.consumptions values($1,$1,$2,\'test\',$3)',[id,company,hash(bytes)])}
 async function read(family='APERAK',id=source){await db.exec('set role service_role');try{return(await db.query('select public.gridex_read_outbound_acks_for_source_v1($1,$2) r',[id,family])).rows[0].r}finally{await db.exec('reset role')}}
 await message(source,raw,'inbound','UTILTS','E66',company,null);await db.query('insert into gridex_received_sources.sources values($1,$2,\'test\',$3,$4)',[source,company,hash(raw),raw]);await message(ack,response());await born(ack,response())
 let r=await read();assert.equal(r.originals.length,1);assert.equal(r.originals[0].status,'qualified');assert.equal(r.originals[0].message.status,'failed');checks++
 await db.query('update public.ediel_messages set status=\'cancelled\',ack_outcome=\'positive\' where id=$1',[ack]);r=await read();assert.equal(r.originals[0].status,'qualified');assert.equal(r.originals[0].payloadHash,hash(response()));checks++
 await message(uid(4),response(),'inbound');assert.equal((await read()).originals.length,1);checks++
 await message(uid(5),response('SIBLING'));await born(uid(5),response('SIBLING'));r=await read();assert.equal(r.originals.length,2);assert.deepEqual(r.originals.map(o=>o.message.id),[ack,uid(5)]);checks++
 await message(uid(6),response('ABSENT'));await born(uid(6),response('ABSENT'));assert.equal((await read()).originals.length,2);checks++
 await message(uid(7),response('OWN','OTHER-D'));await born(uid(7),response('OWN','OTHER-D'));assert.equal((await read()).originals.length,2);checks++
 await message(uid(8),response(),'outbound','APERAK','312',uid(99));assert.equal((await read()).originals.length,2);checks++
 await message(uid(9),response());r=await read();assert.equal(r.originals.find(o=>o.message.id===uid(9)).status,'held');checks++
 await db.query('update gridex_ediel_outbound_owner.consumptions set payload_sha256=$1 where source_message_id=$2',['a'.repeat(64),ack]);assert.equal((await read()).originals.find(o=>o.message.id===ack).status,'held');checks++
 const sourceErr=wire('UTILTS:D:02B:UN:E5SE5A',['BGM+ERR::260+SOURCE-D+9+AB','NAD+MS+A:SVK:260','NAD+MR+B:SVK:260','IDE+24+OWN']),aperakErr=response().replace('DOC+E66:','DOC+ERR:');
 assert.equal((await db.query('select gridex_ack_authority.source_match_v1(gridex_ack_authority.wire_v1($1),gridex_ack_authority.wire_v1($2)) b',[aperakErr,sourceErr])).rows[0].b,true);checks++
 const errLoop=wire('UTILTS:D:02B:UN:E5SE5A',['BGM+ERR::260+ERR-D+9+AB','NAD+MS+B:SVK:260','NAD+MR+A:SVK:260','IDE+24+NEW','STS+E01::260+41+E51::260','RFF+TN:OWN','RFF+ERR:SOURCE-D'],true)
 assert.equal((await db.query('select gridex_ack_authority.source_match_v1(gridex_ack_authority.wire_v1($1),gridex_ack_authority.wire_v1($2)) b',[errLoop,sourceErr])).rows[0].b,false);checks++
 const malformed=wire('UTILTS:D:02B:UN:E5SE5A',['BGM+E66::260+D+9+AB'],false,'')+'?',ctrl=wire('CONTRL:2:2:UN',['UCI+SOURCE-I+A:ZZ:S+B:ZZ:R+4'],true,'');await message(uid(10),malformed,'inbound','UTILTS','E66',company,null);await message(uid(11),ctrl,'outbound','CONTRL','CONTRL',company,uid(10))
 const evidence=(await db.query('select gridex_ediel_technical_ack.envelope($1) h',[malformed])).rows[0].h;assert.ok(evidence);await db.query('insert into gridex_ediel_technical_ack.sources values($1,$2,\'test\',$3,\'ready\')',[uid(10),company,hash(malformed)]);await db.query('insert into gridex_ediel_technical_ack.replies values($1,$2,\'test\',$3,$4)',[uid(10),company,hash(malformed),JSON.stringify({originalUNB:evidence,syntaxDecision:'rejected'})]);assert.equal((await read('CONTRL',uid(10))).originals[0].status,'qualified');checks++
 await db.exec('set role authenticated');try{await assert.rejects(()=>db.exec('select public.gridex_read_outbound_acks_for_source_v1(null,null)'),/permission denied/);checks++}finally{await db.exec('reset role')}
 await db.exec('set role service_role');try{await assert.rejects(()=>db.exec('select * from gridex_ediel_outbound_owner.witnesses'),/permission denied/);checks++}finally{await db.exec('reset role')}
 console.log(`Outbound original ACK readonly/born/scope/failed-status/tenant/technical-negative/ACL: ${checks} PASS`)
}finally{await db.close()}
