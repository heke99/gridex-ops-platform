// Focused actual native H provider preparation, with an explicit synthetic
// midnight clock only. No native clean replay or external send is performed.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required; pinned @electric-sql/pglite@0.3.14')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite();const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;let checks=0
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema gridex_ediel_transport;create schema gridex_received_sources;create schema gridex_utilts_binding;
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_code text,message_family text,message_standard text,raw_payload text,immutable_rendered_at timestamptz,immutable_payload_hash text,rule_profile_key text,rule_profile_version_id uuid,canonical_rule_pack_id uuid,rule_pack_checksum text,rule_profile_version text,communication_route_id uuid,receiver_email text,sender_ediel_id text,receiver_ediel_id text,metering_point_id uuid,site_id uuid);
 create table public.ediel_message_profiles(id uuid primary key,profile_key text,is_enabled boolean,rule_pack_id uuid);create table public.ediel_rule_packs(id uuid primary key,status text,valid_from date,valid_to date,family text,guide_version text,guide_revision text,source_hash text);
 create table public.user_profiles(id uuid,user_status text);create table public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);create table public.ediel_outbox(id uuid,ediel_message_id uuid,company_id uuid,environment text,status text,current_send_attempt_id uuid,locked_by text);
 -- Authentication/tenant-policy are explicit boundaries for this clock test.
 -- PGlite's WASM build lacks PostgreSQL's LATIN1 conversion module. This
 -- explicit byte-codec boundary fixture covers all ISO8859-1 scalars, while
 -- actual native original/attempt/equality/observation SQL executes unchanged.
 create schema fixture;create function fixture.latin1_v1(v text) returns bytea language sql immutable as $$select decode(string_agg(lpad(to_hex(ascii(c)),2,'0'),'' order by n),'hex') from regexp_split_to_table(v,'') with ordinality chars(c,n)$$;
 create function gridex_ediel_transport.dsn_sending_mailbox_v1(uuid,text,text) returns uuid language sql as $$select case when $3='local@example.invalid' then '${uid(9)}'::uuid else null end$$;
 create function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select true';create function public.canonical_tenant_operation_decision(uuid,text) returns table(allowed boolean) language sql as 'select true';
 insert into user_profiles values('${uid(2)}','active');insert into company_memberships values('${uid(1)}','${uid(2)}','active',true,now());insert into ediel_rule_packs values('${uid(3)}','active','2026-10-01',null,'PRODAT','26.A','3',repeat('a',64));insert into ediel_message_profiles values('${uid(4)}','PRODAT:Z08:H:26.A:r3',true,'${uid(3)}');`)
 const codec=readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql',import.meta.url),'utf8')
 await db.exec(codec.slice(codec.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),codec.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
 await db.exec('create function gridex_received_sources.closure_wire_tokens_v1(text) returns jsonb language sql immutable as $$select gridex_utilts_binding.wire_tokens_v1($1)$$')
 const original=readFileSync(new URL('../supabase/migrations/20260924031626_correction_outbound_dispatch_fence_v1.sql',import.meta.url),'utf8');await db.exec(original)
 await db.exec('alter function gridex_outbound_dispatch.mutate_v1(jsonb) rename to mutate_before_observed_clock_v1')
 const forward=readFileSync(new URL('../supabase/migrations/20260930211852_ediel_h_dispatch_exact_original_latin1_bytes.sql',import.meta.url),'utf8')
 const actual=forward.slice(forward.indexOf('CREATE OR REPLACE FUNCTION gridex_outbound_dispatch.mutate_before_observed_clock_v1'),forward.indexOf('REVOKE ALL ON FUNCTION'))
 // This one replacement is solely a declared test clock. All preparation,
 // binding, immutable journal and date expressions execute the actual SQL;
 // only the unavailable encoding conversion uses its declared boundary above.
 await db.exec(actual.replace('observed timestamptz:=clock_timestamp();',"observed timestamptz:='2026-09-30T22:30:00Z';").replace("convert_to(m.raw_payload,'LATIN1')","fixture.latin1_v1(m.raw_payload)"));checks++
 const raw="UNB+UNOC:3+LOCAL:14+REMOTE:14+260930:2230+HREF++23-DDQ-Z08-T++++1'UNH+H1+PRODAT:D:96B:UN:E2SE6A'BGM+Z08+HD+9'CCI++Z13'CAV+Z25'UNT+5+H1'UNZ+1+HREF'"
 const bytes=Buffer.from(raw,'latin1');const hash=createHash('sha256').update(bytes).digest('hex')
 const create=async(id,ownRaw=raw)=>db.query("insert into ediel_messages values($1,$2,'test','outbound','Z08','PRODAT','edifact',$3,now(),$4,'PRODAT:Z08:H:26.A:r3',$5,$6,$7,'26.A:r3',$8,'remote@example.invalid','LOCAL','REMOTE',null,null)",[uid(id),uid(1),ownRaw,createHash('sha256').update(Buffer.from(ownRaw,'utf8')).digest('hex'),uid(4),uid(3),'a'.repeat(64),uid(5)])
 const input=id=>({action:'prepare',companyId:uid(1),environment:'test',actorUserId:uid(2),messageId:uid(id),attemptId:uid(id+100),owner:{kind:'direct'},binding:{originalHash:hash,routeId:uid(5),to:'remote@example.invalid',from:'local@example.invalid',sourceMailboxId:uid(999),encoding:'latin1',mimeMode:'attachment',payloadBase64:bytes.toString('base64'),payloadHash:hash,payloadLength:bytes.length}})
 await create(10);assert.equal((await db.query('select gridex_outbound_dispatch.mutate_before_observed_clock_v1($1) r',[input(10)])).rows[0].r.proceed,true);checks++
 assert.equal((await db.query("select binding->>'sourceMailboxId' mailbox from gridex_outbound_dispatch.attempts where message_id=$1",[uid(10)])).rows[0].mailbox,uid(9));checks++
 assert.equal((await db.query("select '2026-09-30T22:30:00Z'::timestamptz::date < valid_from utc_would_hold,('2026-09-30T22:30:00Z'::timestamptz at time zone 'Europe/Stockholm')::date = valid_from stockholm_active from ediel_rule_packs")).rows[0].utc_would_hold,true);checks++
 await db.exec("update ediel_rule_packs set valid_from='2000-01-01',valid_to='2026-09-30'");await create(11);await assert.rejects(db.query('select gridex_outbound_dispatch.mutate_before_observed_clock_v1($1)',[input(11)]),/outbound_dispatch_sealed_original_unavailable/);assert.equal((await db.query('select count(*)::int n from gridex_outbound_dispatch.originals where message_id=$1',[uid(11)])).rows[0].n,0);checks++
 await db.exec("update ediel_rule_packs set valid_to=null,guide_revision='4'");await create(12);await assert.rejects(db.query('select gridex_outbound_dispatch.mutate_before_observed_clock_v1($1)',[input(12)]),/outbound_dispatch_sealed_original_unavailable/);checks++
 await db.exec("update ediel_rule_packs set guide_revision='3'");await create(13);const forged=input(13);forged.binding.payloadHash='f'.repeat(64);await assert.rejects(db.query('select gridex_outbound_dispatch.mutate_before_observed_clock_v1($1)',[forged]),/outbound_dispatch_physical_bytes_invalid/);checks++
 await create(14);const noMailbox=input(14);noMailbox.binding.from='unconfigured@example.invalid';assert.equal((await db.query('select gridex_outbound_dispatch.mutate_before_observed_clock_v1($1) r',[noMailbox])).rows[0].r.proceed,true);assert.equal((await db.query("select binding->>'sourceMailboxId' mailbox from gridex_outbound_dispatch.attempts where message_id=$1",[uid(14)])).rows[0].mailbox,null);checks++
 await create(15);const wrongBytes=input(15);const foreignBytes=Buffer.from(raw.replace('HD','FORGED-DOCUMENT'),'latin1');wrongBytes.binding.payloadBase64=foreignBytes.toString('base64');wrongBytes.binding.payloadHash=createHash('sha256').update(foreignBytes).digest('hex');wrongBytes.binding.payloadLength=foreignBytes.length;await assert.rejects(db.query('select gridex_outbound_dispatch.mutate_before_observed_clock_v1($1)',[wrongBytes]),/outbound_dispatch_physical_bytes_invalid/);assert.equal((await db.query('select count(*)::int n from gridex_outbound_dispatch.originals where message_id=$1',[uid(15)])).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from gridex_outbound_dispatch.attempts where message_id=$1',[uid(15)])).rows[0].n,0);checks++
 const swedishRaw=raw.replace("UNT+5+H1'", "FTX+AAO+++Räknare ö Å'UNT+6+H1'");await create(16,swedishRaw);const exactSwedish=input(16);exactSwedish.binding.originalHash=createHash('sha256').update(Buffer.from(swedishRaw,'utf8')).digest('hex');exactSwedish.binding.payloadBase64=Buffer.from(swedishRaw,'latin1').toString('base64');exactSwedish.binding.payloadHash=createHash('sha256').update(Buffer.from(swedishRaw,'latin1')).digest('hex');exactSwedish.binding.payloadLength=Buffer.from(swedishRaw,'latin1').length;assert.equal((await db.query('select gridex_outbound_dispatch.mutate_before_observed_clock_v1($1) r',[exactSwedish])).rows[0].r.proceed,true);checks++
 const observe=async(id,result)=>{await create(id);await db.query('select gridex_outbound_dispatch.mutate_before_observed_clock_v1($1)',[input(id)]);const own={companyId:uid(1),environment:'test',actorUserId:uid(2),messageId:uid(id),attemptId:uid(id+100)};await db.query('select gridex_outbound_dispatch.mutate_before_observed_clock_v1($1)',[{...own,action:'enter'}]);return (await db.query('select gridex_outbound_dispatch.mutate_before_observed_clock_v1($1) r',[{...own,action:'result',result}])).rows[0].r.facts.classification}
 assert.equal(await observe(17,{accepted:[],rejected:['foreign@example.invalid']}),'uncertain');checks++
 assert.equal(await observe(18,{accepted:['remote@example.invalid'],rejected:['foreign@example.invalid']}),'uncertain');checks++
 assert.equal(await observe(19,{accepted:[],rejected:['REMOTE@example.invalid']}),'all_rejected');checks++
 assert.equal(await observe(20,{accepted:['REMOTE@example.invalid'],rejected:[]}),'accepted');checks++
 console.log(`Focused actual native H Stockholm guide date, source-exact Latin1 bytes, native mailbox and recipient-bound observation: ${checks} PASS`)
} catch(e){console.error(e.stack,e.where??'');process.exitCode=1} finally {await db.close()}
