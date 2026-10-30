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
// Fixture: self-seeded synthetic tenant, point and E66 originals (wire shape
// of the campaign's DDQ-E66 test originals, cf. utiltsTestEnvironmentWire in
// __tests__/helpers/utiltsNativeSourceFixture.ts). Series are persisted by the
// real private owner persist_series_v2; no stack fixture is required.
const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const MIGRATION=join(__dirname,'..','supabase','migrations','20261030130900_utilts_series_current_only_when_accepted.sql')
const PREIMAGE='afd313aca7c2ba1ef5022c766eb2852669042b6fc37c7fd3e8dffeb9624d712f'
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

const point=()=>'7359992'+String(Math.floor(Math.random()*1e11)).padStart(11,'0')
const wire=(ref:string,tx:string,mp:string,qty:number)=>`UNB+UNOC:3+70007:ZZ+16724:ZZ+261030:1507+${ref}I++23-DDQ-E66-T++1++1'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+${ref}D+9+AB'DTM+137:202610301507:203'DTM+735:?+0200:406'MKS+23+E02::260'NAD+MS+70007:SVK:260'NAD+MR+16724:SVK:260'NAD+DDQ'IDE+24+${tx}'LOC+172+${mp}::9'LOC+239+TES:SVK:260'LIN+++8716867000030:::9'DTM+324:202607010000202607010015:719'DTM+354:15:806'STS+7++E88::260'MEA+AAZ++KWH'SEQ++1'QTY+136:${qty}'UNT+19+1'UNZ+1+${ref}I'`
type Tx={msg:string;tx:string;qty:number;reg:string}
const item=(t:Tx,mp:string)=>`jsonb_build_object('transactionId',${lit(t.tx)},'disposition','accepted','responseType','positive_aperak','seriesKind','actual','externalMeteringPointId',${lit(mp)},'gridAreaId','TES','periodStart','2026-06-30T22:00:00Z','periodEnd','2026-06-30T22:15:00Z','resolution','15','productId','8716867000030','unit','KWH','registrationDate',${lit(t.reg)},'quantities',jsonb_build_array(jsonb_build_object('readingAt','2026-06-30T22:00:00Z','value',${t.qty})))`
function chain(company:string,mp:string,qtys:number[],regs:string[]):Tx[]{return qtys.map((qty,i)=>{const ref='T'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase();return{msg:randomUUID(),tx:ref+'T',qty,reg:regs[i]}})}
const seed=(company:string,mp:string,txs:Tx[])=>`SET LOCAL session_replication_role=replica;
INSERT INTO public.companies(id,name,status) VALUES(${lit(company)},'T3-017 disposable','active') ON CONFLICT DO NOTHING;
${txs.map(t=>`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload) VALUES(${lit(t.msg)},${lit(company)},'test','inbound','edifact','UTILTS','E66','received',${lit(wire(t.tx.slice(0,-1),t.tx,mp,t.qty))});`).join('\n')}
SET LOCAL session_replication_role=origin;
`
const persist=(company:string,mp:string,t:Tx)=>`SELECT gridex_utilts_binding.persist_series_v2(${lit(company)},'test',${lit(t.msg)},'E66',jsonb_build_array(${item(t,mp)})) IS NOT NULL AS ok \\gset
`
const cohort=(company:string,mp:string)=>`(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'tx',source_transaction_reference,'v',version_no,'cur',is_current,'sup',supersedes_series_id,'hash',immutable_hash,'raw',raw_transaction) ORDER BY version_no,created_at),'[]') FROM public.meter_reading_series WHERE company_id=${lit(company)} AND external_metering_point_id=${lit(mp)})`
const reviews=(company:string)=>`(SELECT coalesce(jsonb_agg(jsonb_build_object('company',company_id,'msg',ediel_message_id,'status',status,'payload',payload)),'[]') FROM public.ediel_manual_review_items WHERE issue_type='utilts_series_version_conflict' AND company_id=${lit(company)})`
type Series={id:string;tx:string;v:number;cur:boolean;sup:string|null;hash:string;raw:Record<string,unknown>}
type Review={company:string;msg:string;status:string;payload:{conflicts:Array<Record<string,string>>}}
const T1='2026-06-30T22:20:00Z',T2='2026-06-30T22:40:00Z'

// v1(500,T1) -> v2(600,T2) -> v3(qty3,reg3), persisted in order; returns state before and after v3.
function run(qty3:number,reg3:string,extra=''){
 const company=randomUUID(),mp=point()
 const [v1,v2,v3]=chain(company,mp,[500,600,qty3],[T1,T2,reg3])
 const out=rolledBack<{before:Series[];after:Series[];reviews:Review[];coverage:string[]}>(seed(company,mp,[v1,v2,v3])+persist(company,mp,v1)+persist(company,mp,v2)+`
SELECT ${cohort(company,mp)} AS before \\gset b_
`+persist(company,mp,v3)+extra+`
SET LOCAL session_replication_role=replica;
INSERT INTO gridex_vh_history.deliveries(company_id,permission_id,environment,customer_id,opening_source_message_id,original_message_id,opening_payload_hash,original_payload_hash,legal_esco_id,legal_dso_id)
 VALUES(${lit(company)},'00000000-0000-4000-8000-000000003017','test',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),repeat('a',64),repeat('b',64),'esco','dso');
INSERT INTO gridex_vh_history.objects(company_id,permission_id,site_id,point,product,permission_reference,period_start,period_end,approved_site,authorization_basis,basis_hash)
 VALUES(${lit(company)},'00000000-0000-4000-8000-000000003017','00000000-0000-4000-8000-000000003018',${lit(mp)},'8716867000030','t3-017','2026-06-30T00:00:00Z','2026-07-02T00:00:00Z','{}','{}',encode(sha256(convert_to(jsonb_build_array('{}'::jsonb,'{}'::jsonb)::text,'UTF8')),'hex'));
SET LOCAL session_replication_role=origin;
SELECT jsonb_build_object('before',:'b_before'::jsonb,'after',${cohort(company,mp)},'reviews',${reviews(company)},
 'coverage',to_jsonb(ARRAY(SELECT DISTINCT x[1] FROM regexp_matches(gridex_vh_history.coverage_v1(${lit(company)},'00000000-0000-4000-8000-000000003017','00000000-0000-4000-8000-000000003018')::text,'"seriesId": "([0-9a-f-]+)"','g') x)));`)
 const by=(tx:string,l:Series[])=>l.find(s=>s.tx===tx)!
 return {...out,company,mp,v1,v2,v3,by}
}

describe('UTILTS series is_current only when strictly newer (claude-track3/017)',()=>{
 it('(a)+(b) equal 532, other content: stored as history, conflict opened, VH coverage keeps the 600 head',()=>{
  const o=run(700,T2)
  const v2Before=o.by(o.v2.tx,o.before),v2After=o.by(o.v2.tx,o.after),stored=o.by(o.v3.tx,o.after)
  expect(stored).toMatchObject({cur:false,sup:null,v:3})
  expect(o.after.filter(s=>s.cur).map(s=>s.id)).toEqual([v2After.id])
  expect(v2After).toEqual(v2Before)
  expect(o.reviews).toHaveLength(1)
  expect(o.reviews[0]).toMatchObject({company:o.company,msg:o.v3.msg,status:'open'})
  expect(o.reviews[0].payload.conflicts).toEqual([expect.objectContaining({seriesId:stored.id,currentSeriesId:v2After.id,seriesHash:stored.hash,currentSeriesHash:v2Before.hash})])
  expect(o.coverage).toEqual([v2After.id])
 })

 it('(c) equal 532 and identical content: history only, no new head and no conflict',()=>{
  const o=run(600,T2)
  expect(o.by(o.v3.tx,o.after)).toMatchObject({cur:false,sup:null})
  expect(o.after.filter(s=>s.cur).map(s=>s.tx)).toEqual([o.v2.tx])
  expect(o.reviews).toEqual([])
 })

 it('(d) strictly newer 532 still becomes current and supersedes the head',()=>{
  const o=run(700,'2026-06-30T23:00:00Z')
  const v2=o.by(o.v2.tx,o.after),v3=o.by(o.v3.tx,o.after)
  expect(v3).toMatchObject({cur:true,sup:v2.id})
  expect(o.after.filter(s=>s.cur).map(s=>s.id)).toEqual([v3.id])
  expect(o.coverage).toEqual([v3.id])
  expect(o.reviews).toEqual([])
 })

 it('(e) another tenant with the same point is neither read nor changed',()=>{
  const other=randomUUID(),mp=point(),[b1]=chain(other,mp,[600],[T2])
  const company=randomUUID(),[a1,a2]=chain(company,mp,[600,700],[T2,T2])
  const out=rolledBack<{other:Series[];heads:Series[];reviews:Review[];otherReviews:Review[]}>(seed(other,mp,[b1])+seed(company,mp,[a1,a2])+persist(other,mp,b1)+`
SELECT ${cohort(other,mp)} AS ob \\gset
`+persist(company,mp,a1)+persist(company,mp,a2)+`
SELECT jsonb_build_object('other',:'ob'::jsonb,'heads',${cohort(company,mp)},'reviews',${reviews(company)},'otherReviews',${reviews(other)});`)
  expect(out.other).toHaveLength(1)
  expect(out.other[0]).toMatchObject({cur:true,v:1})
  expect(out.heads.filter(s=>s.cur).map(s=>s.tx)).toEqual([a1.tx])
  expect(out.reviews).toHaveLength(1)
  expect(out.otherReviews).toEqual([])
 })
})
