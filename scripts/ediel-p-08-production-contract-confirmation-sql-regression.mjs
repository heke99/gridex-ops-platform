// masterplan: P-08, AT-P-08
// Embedded PostgreSQL over the real 20261004190000 migration with minimal
// declared stubs of the pre-existing production-contract ledger. Not native replay.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw new Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE public.companies(id uuid PRIMARY KEY);
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,aperak_status text,contrl_status text);
 CREATE SCHEMA gridex_received_sources;
 CREATE FUNCTION gridex_received_sources.permission_transition_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'permission_transition_is_immutable';END$$;
 CREATE TABLE gridex_received_sources.production_contract_events(id uuid PRIMARY KEY,company_id uuid,environment text);
 CREATE TABLE gridex_received_sources.production_contract_revocations(event_id uuid PRIMARY KEY);
 CREATE TABLE gridex_received_sources.production_contract_origins(event_id uuid PRIMARY KEY,message_id uuid UNIQUE);`)
await db.exec(readFileSync(new URL('../supabase/migrations/20261004190000_ediel_production_contract_ack_confirmation.sql',import.meta.url),'utf8'))
const A=uid(1),B=uid(2)
await db.exec(`INSERT INTO public.companies VALUES('${A}'),('${B}')`)
let n=100
const sent=async({company=A,env='test',code='Z09',bound=true,revoked=false}={})=>{const ev=uid(++n),msg=uid(++n)
 await db.query('INSERT INTO gridex_received_sources.production_contract_events VALUES($1,$2,$3)',[ev,company,env])
 await db.query("INSERT INTO public.ediel_messages VALUES($1,$2,$3,'outbound','PRODAT',$4,'pending','pending')",[msg,company,env,code])
 if(bound)await db.query('INSERT INTO gridex_received_sources.production_contract_origins VALUES($1,$2)',[ev,msg])
 if(revoked)await db.query('INSERT INTO gridex_received_sources.production_contract_revocations VALUES($1)',[ev])
 return {ev,msg}}
const ack=(msg,status,col='aperak_status')=>db.query(`UPDATE public.ediel_messages SET ${col}=$2 WHERE id=$1`,[msg,status])
const confirmations=async ev=>(await db.query('SELECT event_id,company_id,message_id FROM gridex_received_sources.production_contract_confirmations WHERE event_id=$1',[ev])).rows
const total=async()=>(await db.query('SELECT count(*)::int n FROM gridex_received_sources.production_contract_confirmations')).rows[0].n
const check=async fn=>{await fn();checks++}

await check(async()=>{const s=await sent();await ack(s.msg,'accepted');assert.deepEqual(await confirmations(s.ev),[{event_id:s.ev,company_id:A,message_id:s.msg}])})
await check(async()=>{const s=await sent(),before=await total();await ack(s.msg,'rejected');assert.equal(await total(),before)})
await check(async()=>{const s=await sent(),before=await total();await ack(s.msg,'accepted','contrl_status');assert.equal(await total(),before)})
await check(async()=>{const s=await sent({bound:false}),before=await total();await ack(s.msg,'accepted');assert.equal(await total(),before)})
await check(async()=>{const s=await sent({revoked:true}),before=await total();await ack(s.msg,'accepted');assert.equal(await total(),before)})
await check(async()=>{const s=await sent({code:'Z03'}),before=await total();await ack(s.msg,'accepted');assert.equal(await total(),before)})
// A bound event of another tenant or environment never confirms through this message.
await check(async()=>{const s=await sent();await db.query("UPDATE public.ediel_messages SET company_id=$2 WHERE id=$1",[s.msg,B]);const before=await total();await ack(s.msg,'accepted');assert.equal(await total(),before)})
// Idempotent: a repeated accepted transition keeps exactly one confirmation; the row is immutable.
await check(async()=>{const s=await sent();await ack(s.msg,'accepted');await ack(s.msg,'pending');await ack(s.msg,'accepted');assert.equal((await confirmations(s.ev)).length,1)
 await assert.rejects(db.query('DELETE FROM gridex_received_sources.production_contract_confirmations WHERE event_id=$1',[s.ev]),/immutable/)})
await check(async()=>{const acl=(await db.query("SELECT has_table_privilege('service_role','gridex_received_sources.production_contract_confirmations','INSERT') w")).rows[0].w;assert.equal(acl,false)})
console.log('P-08 production contract confirmation SQL: '+checks+' PASS; declared ledger stubs, NOT native/legal approval proof')
