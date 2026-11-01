import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {describe,expect,it} from 'vitest'

// claude-track3/005: retained CONTRL original discovery must stay linear.
// Disposable native Supabase only. Every scenario runs in ONE psql transaction
// that ends in ROLLBACK, so the stack keeps no fixture. Fixture rows are seeded
// with session_replication_role=replica (synthetic, no provider traffic); the
// function under test runs with triggers back on, unmocked.
// If the stack still carries the pre-fix catalog body, the forward migration is
// applied inside the same rolled-back transaction. CONTRL_LINEAR_BASELINE=1
// skips that to show the pre-fix failure of the scaling case.
const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const MIGRATION=join(__dirname,'..','supabase','migrations','20261030130400_ediel_contrl_retained_source_linear.sql')
const PREIMAGE='142f25b2cfdb260e7183a2ceb5fcb309498bd0bc9b86ce297738743f9434707e'
const lit=(v:unknown)=>"'"+String(v).replaceAll("'","''")+"'"

function rolledBack<T>(body:string):T {
 if(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_native_local_only')
 const migration=process.env.CONTRL_LINEAR_BASELINE==='1'?'':readFileSync(MIGRATION,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')
 const apply=migration?`DO $$BEGIN PERFORM set_config('gridex.t3005_apply',(SELECT (encode(sha256(convert_to(prosrc,'UTF8')),'hex')=${lit(PREIMAGE)})::text FROM pg_proc WHERE oid='gridex_ack_authority.read_outbound_originals_v1(uuid,text)'::regprocedure),true);END$$;
SELECT current_setting('gridex.t3005_apply')='true' AS apply \\gset
\\if :apply
${migration}
\\endif
`:''
 const input=`\\set ON_ERROR_STOP on
BEGIN;
${apply}
SET LOCAL track_functions='all';
${body}
ROLLBACK;
`
 const out=execFileSync('psql',[DB,'-XAtq'],{input,encoding:'utf8',timeout:120000}).trim().split('\n').filter(Boolean)
 return JSON.parse(out[out.length-1]) as T
}

const unb=(sender:string,receiver:string,ref:string)=>`UNB+UNOC:3+${sender}:ZZ+${receiver}:ZZ+261029:2050+${ref}++23-DDQ-E66-T++1++1'`
// UTILTS source with the release character '?+' (the case that defeated the prefilter).
const sourceRaw=(ref:string)=>`UNA:+.? '${unb('70007','16700',ref)}UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+M${ref}+9+AB'DTM+137:202610292050:203'DTM+735:?+0200:406'NAD+MS+70007:SVK:260'NAD+MR+16700:SVK:260'UNT+7+1'UNZ+1+${ref}'`
const contrlRaw=(uciRef:string,ack:string)=>`UNA:+.? 'UNB+UNOC:3+16700:ZZ+70007:ZZ+261029:2150+${ack}++23-DDQ-E66-T++++1'UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+${uciRef}+70007:ZZ+16700:ZZ+1'UNT+3+1'UNZ+1+${ack}'`
const ref=()=>'I'+randomUUID().replaceAll('-','').slice(0,13)

type Row={id:string;company:string;env:'test'|'production';raw:string}
// Seeds a ready technical source chain (sources+replies) and retained CONTRL
// candidates (outbound, related_message_id NULL, wire-namespace coverage).
function seed(companies:string[],sources:Row[],acks:Row[]){
 const msg=(r:Row,dir:string,fam:string)=>`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload) VALUES(${lit(r.id)},${lit(r.company)},${lit(r.env)},${lit(dir)},'edifact',${lit(fam)},${lit(fam==='CONTRL'?'CONTRL':'E66')},${lit(dir==='inbound'?'received':'sent')},${lit(r.raw)});`
 const hash=(r:Row)=>`encode(sha256(convert_to(${lit(r.raw)},'UTF8')),'hex')`
 return `SET LOCAL session_replication_role=replica;
${companies.map(c=>`INSERT INTO public.companies(id,name,status) VALUES(${lit(c)},'T3-005 disposable','active');`).join('\n')}
${sources.map(s=>msg(s,'inbound','UTILTS')+`
INSERT INTO gridex_ediel_technical_ack.sources(source_message_id,source_company_id,company_id,environment,payload_sha256,observed_at,status,evidence) VALUES(${lit(s.id)},${lit(s.company)},${lit(s.company)},${lit(s.env)},${hash(s)},now(),'ready','{}');
INSERT INTO gridex_ediel_technical_ack.replies(source_message_id,company_id,environment,payload_sha256,canonical_assessment_id,evidence) VALUES(${lit(s.id)},${lit(s.company)},${lit(s.env)},${hash(s)},gen_random_uuid(),jsonb_build_object('originalUNB',gridex_ediel_technical_ack.envelope(${lit(s.raw)}),'syntaxDecision','accepted'));`).join('\n')}
${acks.map(a=>msg(a,'outbound','CONTRL')+`
INSERT INTO gridex_ediel_wire_namespace.coverage(source_message_id,payload_sha256,company_id,environment) VALUES(${lit(a.id)},${hash(a)},${lit(a.company)},${lit(a.env)});`).join('\n')}
SET LOCAL session_replication_role=origin;`
}
const read=(source:string)=>`(SELECT coalesce(jsonb_agg(x->'message'->>'id' ORDER BY x->'message'->>'id'),'[]') FROM jsonb_array_elements(gridex_ack_authority.read_outbound_originals_v1(${lit(source)},'CONTRL')->'originals')x)`

describe('retained CONTRL original discovery (claude-track3/005)',()=>{
 it('finds only the own-tenant, own-environment CONTRL with the exact uciRef, also with ?+ in the source',()=>{
  const a=randomUUID(),b=randomUUID(),r=ref(),other=ref()
  const src:Row={id:randomUUID(),company:a,env:'test',raw:sourceRaw(r)}
  const own:Row={id:randomUUID(),company:a,env:'test',raw:contrlRaw(r,ref())}
  const wrongRef:Row={id:randomUUID(),company:a,env:'test',raw:contrlRaw(other,ref())}
  const otherTenant:Row={id:randomUUID(),company:b,env:'test',raw:contrlRaw(r,ref())}
  const otherEnv:Row={id:randomUUID(),company:a,env:'production',raw:contrlRaw(r,ref())}
  const noContrl:Row={id:randomUUID(),company:a,env:'test',raw:sourceRaw(ref())}
  const tenantB:Row={id:randomUUID(),company:b,env:'test',raw:sourceRaw(ref())}
  const out=rolledBack<Record<string,string[]>>(seed([a,b],[src,noContrl,tenantB],[own,wrongRef,otherTenant,otherEnv])+`
SELECT jsonb_build_object('own',${read(src.id)},'none',${read(noContrl.id)},'tenantB',${read(tenantB.id)});`)
  expect(src.raw).toContain('?+')
  expect(out.own).toEqual([own.id])
  expect(out.own).not.toContain(wrongRef.id);expect(out.own).not.toContain(otherTenant.id);expect(out.own).not.toContain(otherEnv.id)
  expect(out.none).toEqual([])
  expect(out.tenantB).toEqual([])
 })

 it.each([10,50,200])('scales linearly with N=%i ready sources and CONTRL candidates',n=>{
  const c=randomUUID(),sources:Row[]=[],acks:Row[]=[]
  for(let i=0;i<n;i++){const r=ref();sources.push({id:randomUUID(),company:c,env:'test',raw:sourceRaw(r)});acks.push({id:randomUUID(),company:c,env:'test',raw:contrlRaw(r,ref())})}
  const probe=sources[Math.floor(n/2)].id
  const out=rolledBack<{ids:string[];ms:number;envelopeCalls:number}>(seed([c],sources,acks)+`
SELECT pg_stat_clear_snapshot();
CREATE TEMP TABLE t3005 ON COMMIT DROP AS SELECT coalesce((SELECT calls FROM pg_stat_xact_user_functions WHERE schemaname='gridex_ediel_technical_ack' AND funcname='envelope'),0) c0,clock_timestamp() t0;
CREATE TEMP TABLE t3005r ON COMMIT DROP AS SELECT ${read(probe)} ids;
SELECT jsonb_build_object('ids',(SELECT ids FROM t3005r),'ms',extract(epoch FROM clock_timestamp()-(SELECT t0 FROM t3005))*1000,
 'envelopeCalls',coalesce((SELECT calls FROM pg_stat_xact_user_functions WHERE schemaname='gridex_ediel_technical_ack' AND funcname='envelope'),0)-(SELECT c0 FROM t3005));`)
  expect(out.ids).toEqual([acks[Math.floor(n/2)].id])
  expect(out.envelopeCalls).toBeLessThanOrEqual(4*n+10)
  if(n===200)expect(out.ms).toBeLessThan(2000)
 },180000)
})
