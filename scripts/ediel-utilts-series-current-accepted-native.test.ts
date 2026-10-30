import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {describe,expect,it} from 'vitest'

// claude-track3/017: a UTILTS series becomes is_current only when its 532/512
// is strictly newer than the current one (what consumption accepts).
// Disposable native Supabase only. Every case runs in ONE psql transaction that
// ends in ROLLBACK. The real persistence owners run unmocked; only removal of
// the replayed v3 effects and synthetic other-tenant rows use replica mode.
// If the stack still has the pre-fix body, the forward migration is applied in
// the same rolled-back transaction. SERIES_CURRENT_BASELINE=1 skips that to
// show the pre-fix failure.
// Fixture: the campaign stack's three-version series (500/600/700, v2 and v3
// with equal 532) for tenant fc0f05d7, point 735999260755990230.
const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const MIGRATION=join(__dirname,'..','supabase','migrations','20261030130900_utilts_series_current_only_when_accepted.sql')
const PREIMAGE='afd313aca7c2ba1ef5022c766eb2852669042b6fc37c7fd3e8dffeb9624d712f'
const COMPANY='fc0f05d7-92cb-45c0-838a-f8eb6c6f72c0'
const V2='58253a35-cab8-47f9-ba2c-36c83d65d5d1'
const V3='4e22663e-ac70-434e-9e8c-4caeeaf9825b'
const ACTOR='b449b49e-f8a2-41da-ac6e-9d3bfcebce62'
const lit=(v:unknown)=>"'"+String(v).replaceAll("'","''")+"'"

function rolledBack<T>(body:string):T {
 if(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_native_local_only')
 const migration=process.env.SERIES_CURRENT_BASELINE==='1'?'':readFileSync(MIGRATION,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')
 const apply=migration?`DO $$BEGIN PERFORM set_config('gridex.t3017_apply',(SELECT (encode(sha256(convert_to(prosrc,'UTF8')),'hex')=${lit(PREIMAGE)})::text FROM pg_proc WHERE oid='gridex_utilts_binding.persist_series_v2(uuid,text,uuid,text,jsonb)'::regprocedure),true);END$$;
SELECT current_setting('gridex.t3017_apply')='true' AS apply \\gset
\\if :apply
${migration}
\\endif
`:''
 const input=`\\set ON_ERROR_STOP on
BEGIN;
${apply}
${body}
ROLLBACK;
`
 const out=execFileSync('psql',[DB,'-XAtq'],{input,encoding:'utf8',timeout:120000}).trim().split('\n').filter(Boolean)
 return JSON.parse(out[out.length-1]) as T
}

// Removes v3's persisted effects and restores v2 as head: the state just
// before the equal-532 v3 was persisted. v3's original message stays.
const resetToV2=`CREATE TEMP TABLE v3 AS SELECT s.*,m.raw_payload src_raw FROM public.meter_reading_series s JOIN public.ediel_messages m ON m.id=s.source_ediel_message_id WHERE s.id=${lit(V3)} AND s.company_id=${lit(COMPANY)};
CREATE TEMP TABLE v2 AS SELECT s.* FROM public.meter_reading_series s WHERE s.id=${lit(V2)} AND s.company_id=${lit(COMPANY)};
DO $$BEGIN IF (SELECT count(*) FROM pg_temp.v3)<>1 OR (SELECT count(*) FROM pg_temp.v2)<>1 THEN RAISE EXCEPTION 't3017_stack_fixture_missing';END IF;END$$;
GRANT SELECT ON v3,v2 TO service_role;
SET LOCAL session_replication_role=replica;
DELETE FROM public.meter_reading_values WHERE series_id=${lit(V3)};
DELETE FROM gridex_utilts_binding.contracts WHERE series_id=${lit(V3)};
DELETE FROM public.ediel_ack_transaction_results WHERE persisted_series_id=${lit(V3)};
DELETE FROM gridex_utilts_binding.receipts WHERE source_message_id=(SELECT source_ediel_message_id FROM v3);
DELETE FROM public.meter_reading_series WHERE id=${lit(V3)};
UPDATE public.meter_reading_series SET is_current=true WHERE id=${lit(V2)};
SET LOCAL session_replication_role=origin;
`
const cohort=`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'v',version_no,'cur',is_current,'sup',supersedes_series_id,'hash',immutable_hash,'raw',raw_transaction) ORDER BY version_no,created_at),'[]') FROM public.meter_reading_series WHERE company_id=${lit(COMPANY)} AND external_metering_point_id='735999260755990230'`
const reviews=`SELECT coalesce(jsonb_agg(jsonb_build_object('company',company_id,'msg',ediel_message_id,'status',status,'payload',payload)),'[]') FROM public.ediel_manual_review_items WHERE issue_type='utilts_series_version_conflict'`
// Direct private owner call (as the definer-owner), single transaction item.
const persist=(item:string)=>`gridex_utilts_binding.persist_series_v2(${lit(COMPANY)},'test',(SELECT source_ediel_message_id FROM v3),'E66',jsonb_build_array(${item}))`

type Series={id:string;v:number;cur:boolean;sup:string|null;hash:string;raw:Record<string,unknown>}
type Review={company:string;msg:string;status:string;payload:{conflicts:Array<Record<string,string>>}}

describe('UTILTS series is_current only when strictly newer (claude-track3/017)',()=>{
 it('(a)+(b) equal 532, other content: stored as history, conflict opened, every reader keeps the 600 head',()=>{
  const out=rolledBack<{before:Series[];persisted:Array<Record<string,unknown>>;after:Series[];reviews:Review[];sc046:Record<string,unknown>;consume:Record<string,unknown>;coverage:string[]}>(resetToV2+`
SELECT (${cohort}) AS before \\gset b_
CREATE TEMP TABLE probe(k text,v jsonb);GRANT ALL ON probe TO service_role;
SET LOCAL role service_role;
DO $p$DECLARE r jsonb;x record;y record;BEGIN SELECT * INTO x FROM pg_temp.v3;SELECT * INTO y FROM pg_temp.v2;
 r:=public.gridex_persist_utilts_consumption_v1(x.company_id,'test',x.source_ediel_message_id,'E66',x.src_raw,jsonb_build_array(x.raw_transaction),${lit(ACTOR)});
 INSERT INTO pg_temp.probe VALUES('persisted',r);
 BEGIN r:=public.gridex_persist_utilts_consumption_v1(y.company_id,'test',y.source_ediel_message_id,'E66',(SELECT raw_payload FROM public.ediel_messages WHERE id=y.source_ediel_message_id),jsonb_build_array(y.raw_transaction),${lit(ACTOR)});
  INSERT INTO pg_temp.probe VALUES('sc046',jsonb_build_object('versionState',r->0->'versionState','replay',r->0->'idempotentReplay'));
 EXCEPTION WHEN OTHERS THEN INSERT INTO pg_temp.probe VALUES('sc046',jsonb_build_object('error',SQLERRM));END;
 BEGIN r:=to_jsonb(public.gridex_consume_utilts_metering_v1(y.company_id,y.source_ediel_message_id,y.source_transaction_reference,0,${lit(ACTOR)},y.raw_transaction->'consumptionContract'));
  INSERT INTO pg_temp.probe VALUES('consume',jsonb_build_object('value',r->'value_kwh','src',r->'source_ediel_message_id'));
 EXCEPTION WHEN OTHERS THEN INSERT INTO pg_temp.probe VALUES('consume',jsonb_build_object('error',SQLERRM));END;
END$p$;
RESET role;
SET LOCAL session_replication_role=replica;
INSERT INTO gridex_vh_history.deliveries(company_id,permission_id,environment,customer_id,opening_source_message_id,original_message_id,opening_payload_hash,original_payload_hash,legal_esco_id,legal_dso_id)
 SELECT company_id,'00000000-0000-4000-8000-000000003017','test',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),repeat('a',64),repeat('b',64),'esco','dso' FROM v2;
INSERT INTO gridex_vh_history.objects(company_id,permission_id,site_id,point,product,permission_reference,period_start,period_end,approved_site,authorization_basis,basis_hash)
 SELECT company_id,'00000000-0000-4000-8000-000000003017','00000000-0000-4000-8000-000000003018',external_metering_point_id,product_id,'t3-017',period_start-interval '1 day',period_end+interval '1 day','{}','{}',encode(sha256(convert_to(jsonb_build_array('{}'::jsonb,'{}'::jsonb)::text,'UTF8')),'hex') FROM v2;
SET LOCAL session_replication_role=origin;
SELECT jsonb_build_object('before',:'b_before'::jsonb,'persisted',(SELECT v FROM probe WHERE k='persisted'),'after',(${cohort}),'reviews',(${reviews}),
 'sc046',(SELECT v FROM probe WHERE k='sc046'),'consume',(SELECT v FROM probe WHERE k='consume'),
 'coverage',to_jsonb(ARRAY(SELECT DISTINCT x[1] FROM regexp_matches(gridex_vh_history.coverage_v1(${lit(COMPANY)},'00000000-0000-4000-8000-000000003017','00000000-0000-4000-8000-000000003018')::text,'"seriesId": "([0-9a-f-]+)"','g') x)));`)
  const v2Before=out.before.find(s=>s.id===V2)!
  const v2After=out.after.find(s=>s.id===V2)!
  const stored=out.after.find(s=>s.v===3)!
  // (a) the equal-532 original is stored unchanged, but does not become current.
  expect(out.persisted[0]).toMatchObject({persistenceStatus:'persisted',versionState:'late_older_history',seriesId:stored.id})
  expect(stored).toMatchObject({cur:false,sup:null})
  expect(stored.raw.transactionId).toBe('T3S2610301506DDAC033T')
  expect(out.after.filter(s=>s.cur).map(s=>s.id)).toEqual([V2])
  expect(v2After).toEqual(v2Before)
  expect(out.reviews).toHaveLength(1)
  expect(out.reviews[0]).toMatchObject({company:COMPANY,status:'open'})
  expect(out.reviews[0].payload.conflicts).toEqual([expect.objectContaining({seriesId:stored.id,currentSeriesId:V2,seriesHash:stored.hash,currentSeriesHash:v2Before.hash})])
  // (b) readers: VH coverage builds from the 600 series; SC046 replay of v2 and
  // consumption of v2 keep the 600 head without head errors.
  expect(out.coverage).toEqual([V2])
  expect(out.sc046).toEqual({versionState:'current',replay:true})
  expect(out.consume).toMatchObject({value:600})
 })

 it('(c) equal 532 and identical content: history only, no new head and no conflict',()=>{
  const out=rolledBack<{r:Array<Record<string,unknown>>;after:Series[];reviews:Review[]}>(resetToV2+`
SELECT ${persist(`jsonb_set(jsonb_set((SELECT raw_transaction FROM v2),'{transactionId}',to_jsonb((SELECT source_transaction_reference FROM v3))),'{consumptionContract,transactionId}',to_jsonb((SELECT source_transaction_reference FROM v3)))`)} AS r \\gset
SELECT jsonb_build_object('r',:'r'::jsonb,'after',(${cohort}),'reviews',(${reviews}));`)
  expect(out.r[0]).toMatchObject({persistenceStatus:'persisted'})
  expect(out.after.filter(s=>s.cur).map(s=>s.id)).toEqual([V2])
  expect(out.after.find(s=>s.v===3)).toMatchObject({cur:false,sup:null})
  expect(out.reviews).toEqual([])
 })

 it('(d) strictly newer 532 still becomes current and supersedes the head',()=>{
  const out=rolledBack<{after:Series[];reviews:Review[]}>(resetToV2+`
SELECT ${persist(`jsonb_set((SELECT raw_transaction FROM v3),'{registrationDate}','"2026-06-30T23:00:00Z"')`)} AS r \\gset
SELECT jsonb_build_object('r',:'r'::jsonb,'after',(${cohort}),'reviews',(${reviews}));`)
  const v3=out.after.find(s=>s.v===3)!
  expect(v3).toMatchObject({cur:true,sup:V2})
  expect(out.after.filter(s=>s.cur).map(s=>s.id)).toEqual([v3.id])
  expect(out.reviews).toEqual([])
 })

 it('(e) another tenant with the same cohort is neither read nor changed',()=>{
  const other=randomUUID(),msg=randomUUID(),series=randomUUID()
  const out=rolledBack<{other:{cur:boolean;hash:string};hashBefore:string;reviews:Review[];heads:string[]}>(resetToV2+`
SET LOCAL session_replication_role=replica;
INSERT INTO public.companies(id,name,status) VALUES(${lit(other)},'T3-017 disposable','active');
INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload) VALUES(${lit(msg)},${lit(other)},'test','inbound','edifact','UTILTS','E66','received','UNA:+.? ''');
INSERT INTO public.meter_reading_series SELECT (jsonb_populate_record(NULL::public.meter_reading_series,to_jsonb(v2)||jsonb_build_object('id',${lit(series)},'company_id',${lit(other)},'source_ediel_message_id',${lit(msg)},'is_current',true,'supersedes_series_id',NULL,'version_no',1,'dedupe_key','t3017-'||${lit(series)},'metering_point_id',NULL))).* FROM v2;
SET LOCAL session_replication_role=origin;
SELECT immutable_hash AS h FROM public.meter_reading_series WHERE id=${lit(series)} \\gset
SELECT ${persist('(SELECT raw_transaction FROM v3)')} IS NOT NULL AS ok \\gset
SELECT jsonb_build_object('other',(SELECT jsonb_build_object('cur',is_current,'hash',immutable_hash) FROM public.meter_reading_series WHERE id=${lit(series)}),'hashBefore',:'h',
 'reviews',(${reviews}),'heads',(SELECT jsonb_agg(id) FROM public.meter_reading_series WHERE company_id=${lit(COMPANY)} AND external_metering_point_id='735999260755990230' AND is_current));`)
  expect(out.other).toEqual({cur:true,hash:out.hashBefore})
  expect(out.heads).toEqual([V2])
  expect(out.reviews.map(r=>r.company)).toEqual([COMPANY])
 })
})
