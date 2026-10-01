// Focused new-forward predicates/callback fences. Delegation, frozen legal and
// rule provenance use explicit fixtures: this is not native replay evidence.
import {pathToFileURL,fileURLToPath} from 'node:url'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),root=fileURLToPath(new URL('..',import.meta.url))
const company='11111111-1111-4111-8111-111111111111',source='22222222-2222-4222-8222-222222222222'
let count=0
const raw=(quantity,resolution='15:806',unit='KWH')=>`UNA:+.? 'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+D+9+AB'IDE+24+OWN'LIN+++8716867000030:::9'DTM+354:${resolution}'MEA+AAZ++${unit}'SEQ++1'${quantity}UNT+1+1'`
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema gridex_utilts_binding;create schema gridex_billing_source;create schema gridex_received_sources;create schema gridex_ediel_source_rules;create schema gridex_ediel_inbound_context;
 create table public.ediel_messages(id uuid,company_id uuid,environment text,message_code text,direction text,message_family text,raw_payload text);
 create table public.normalized_metering_values(id uuid,company_id uuid,source_message_id uuid,source_transaction_reference text);
 create table gridex_utilts_binding.receipts(source_message_id uuid,company_id uuid,environment text,raw_hash text);
 create table public.ediel_ack_transaction_results(source_message_id uuid,company_id uuid,environment text,source_transaction_id text,disposition text,persistence_status text,planned_response_type text,finalized_at timestamptz);
 create table public.fixture_owner(enabled boolean);insert into public.fixture_owner values(true);
 create function gridex_received_sources.require_utilts_transaction_v1(uuid,uuid,text,text,text,jsonb) returns void language plpgsql as $$begin if not (select enabled from public.fixture_owner) or $3 is distinct from 'OWN' or $4 is distinct from 'accepted' or $5 is distinct from 'positive_aperak' or $6 is distinct from '[]'::jsonb then raise exception 'fixture_owner_required';end if;end$$;
 create function gridex_ediel_source_rules.require_v1(uuid,uuid) returns jsonb language sql as $$select '{"qualified":true}'::jsonb$$;
 create function gridex_ediel_inbound_context.require_v1(uuid,uuid) returns jsonb language sql as $$select '{"qualified":true}'::jsonb$$;
 create table public.fixture_delegations(called boolean);insert into public.fixture_delegations values(false);
 create function public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) returns jsonb language plpgsql as $$begin update public.fixture_delegations set called=true;return $6;end$$;
 create function gridex_billing_source.basis_v1(uuid,uuid) returns jsonb language sql as $$select '{"qualified":false}'::jsonb$$;`)
 const old=fs.readFileSync(root+'/supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql','utf8')
 await db.exec(old.slice(old.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),old.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20260930191608_ediel_utilts_source_precision_guards.sql','utf8'))
 async function rules(input){return(await db.query('select gridex_utilts_binding.decimal_rules_v1(gridex_utilts_binding.wire_tokens_v1($1),$2,$3) r',[input,'OWN',input.startsWith('UNA')?input[5]:'.'])).rows[0].r}
 for(const [input,expected] of [[raw("QTY+136:1.123'"),{guide:[],functional:[]}],[raw("QTY+136:1.1234'"),{guide:[],functional:['E51']}],[raw("QTY+136:1.0000'"),{guide:[],functional:['E51']}],[raw("QTY+136:9007199254740993.001'"),{guide:[],functional:[]}],[raw("QTY+136:1.1'",'1:802'),{guide:[],functional:['E51']}],[raw("QTY+220:1.0'",'1:801'),{guide:[],functional:['E51']}],[raw("QTY+220:1.12345'"),{guide:[],functional:[]}],[raw("QTY+136:NULL'"),{guide:[],functional:[]}],[raw("QTY+136:1e3'"),{guide:['516'],functional:[]}],[raw("QTY+136:1'",'15:806','MWH'),{guide:[],functional:['E73']}],[raw("MOA+9:1.234:SEK'PRI+CAL:1.1234567'"),{guide:['522','523'],functional:[]}],[raw("QTY+136:1.1234'").replace('UNA:+.? ','UNA:+,? ').replace('1.1234','1,1234'),{guide:[],functional:['E51']}]]) {assert.deepEqual(await rules(input),expected);count++}
 const original=raw("QTY+136:1.1234'")
 await db.query("insert into public.ediel_messages values($1,$2,'test','E66','inbound','UTILTS',$3)",[source,company,original])
 async function call(transaction={transactionId:'OWN',disposition:'accepted',responseType:'positive_aperak',issueCodes:[]}){await db.exec('set role service_role');try{return await db.query("select public.gridex_persist_utilts_consumption_v1($1,'test',$2,'E66',$3,$4)",[company,source,original,[transaction]])}finally{await db.exec('reset role')}}
 await assert.rejects(call,/source_decimal_or_unit_rules_failed/);assert.equal((await db.query('select called from public.fixture_delegations')).rows[0].called,false);count++
 await db.query("insert into gridex_utilts_binding.receipts values($1,$2,'test',encode(sha256(convert_to($3,'UTF8')),'hex'))",[source,company,original])
 await db.query("insert into public.ediel_ack_transaction_results values($1,$2,'test','OWN','accepted','persisted','positive_aperak',null)",[source,company])
 await call();assert.equal((await db.query('select called from public.fixture_delegations')).rows[0].called,true);count++

 await db.exec('update public.fixture_delegations set called=false;update public.fixture_owner set enabled=false;delete from public.ediel_ack_transaction_results');
 await db.query("insert into public.ediel_ack_transaction_results values($1,$2,'test','OWN','processability_rejected','not_applicable','utilts_err',now())",[source,company]);
 const negative={transactionId:'OWN',disposition:'processability_rejected',responseType:'utilts_err',issueCodes:['E51']};
 await call(negative);assert.equal((await db.query('select called from public.fixture_delegations')).rows[0].called,true);count++;
 await db.exec('update public.fixture_delegations set called=false;update public.ediel_ack_transaction_results set finalized_at=null');
 await assert.rejects(call(negative),/fixture_owner_required/);assert.equal((await db.query('select called from public.fixture_delegations')).rows[0].called,false);count++;
 await db.exec("update public.ediel_ack_transaction_results set finalized_at=now(),disposition='accepted',planned_response_type='positive_aperak',persistence_status='persisted'");
 await assert.rejects(call(negative),/fixture_owner_required/);count++;
 await db.exec('set role authenticated');try{await assert.rejects(()=>db.query("select public.gridex_persist_utilts_consumption_v1(null,null,null,null,null,'[]')"),/permission denied/);count++}finally{await db.exec('reset role')}
 console.log(`Focused PostgreSQL precision/source-scope/callback/replay/ACL: ${count} PASS`)
} finally {await db.close()}
