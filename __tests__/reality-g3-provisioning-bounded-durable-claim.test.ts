import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const original=readFileSync('supabase/migrations/20260810193450_canonical_access_provisioning_runtime_v1.sql','utf8')
const candidate=readFileSync('supabase/migrations/20261024110000_g3_provisioning_revalidate_coalesce_fair_claim.sql','utf8')
const claimSource=original.slice(original.indexOf('create or replace function public.canonical_claim_company_provisioning_jobs('),original.indexOf('create or replace function public.canonical_complete_company_provisioning_job('))
const donor=process.env.GRIDEX_G3_BOUNDED_SOURCE==='donor'
const selected=donor?readFileSync(process.env.GRIDEX_G3_DONOR_MIGRATION!,'utf8'):candidate
if(donor&&createHash('sha256').update(selected,'utf8').digest('hex')!=='a86a6c6d2b6a9753d6dc7c8bd0431e336095923352a49911605ee11de6e2f74e')throw new Error('qualified_d547_donor_required')
const companies=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555']
type Job={id:string;company_id:string;idempotency_key:string;lease_token:string;attempt_count:number}
async function fixture(apply=true){
 const db=new PGlite()
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create table companies(id uuid primary key,status text not null);
 create table company_provisioning_jobs(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),job_key text not null,status text not null default 'pending',idempotency_key text not null,attempt_count int not null default 0,last_error_code text,last_error_details jsonb not null default '{}',available_at timestamptz not null default now(),claimed_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),max_attempts int not null default 5,started_at timestamptz,locked_at timestamptz,locked_by text,lease_token uuid,last_error_message text,dead_letter_at timestamptz,unique(company_id,job_key,idempotency_key));
 create function canonical_tenant_operation_decision(uuid,text) returns table(allowed boolean) language sql as $$select $1 <> '${companies[4]}'::uuid and $2='tenant.provisioning.execute'$$;
 grant select on companies,company_provisioning_jobs to authenticated;grant all on companies,company_provisioning_jobs to service_role;`)
 await db.exec(claimSource)
 await db.exec(`revoke all on function public.canonical_claim_company_provisioning_jobs(text,integer,integer) from public,anon,authenticated;
 grant execute on function public.canonical_claim_company_provisioning_jobs(text,integer,integer) to service_role;
 comment on function public.canonical_claim_company_provisioning_jobs(text,integer,integer) is 'preserve-existing-comment';`)
 for(const c of companies)await db.query('insert into companies values($1,$2)',[c,'active'])
 if(apply)await db.exec(selected)
 const enqueue=async(company:string,key:string,age:number,kind='auth_invite',status='pending',delay=-1,attempt=0)=>db.query(`insert into company_provisioning_jobs(company_id,job_key,idempotency_key,created_at,available_at,status,attempt_count) values($1,$2,$3,now()-make_interval(mins=>$4),now()+make_interval(mins=>$5),$6,$7)`,[company,kind,key,age,delay,status,attempt])
 const claim=async(limit=20)=>{await db.exec('set role service_role');try{return(await db.query<Job>(`select * from canonical_claim_company_provisioning_jobs('worker',$1,300)`,[limit])).rows}finally{await db.exec('reset role')}}
 return{db,enqueue,claim}
 }catch(error){await db.close();throw error}
}
const scope=async(fn:(f:Awaited<ReturnType<typeof fixture>>)=>Promise<void>,apply=true)=>{const f=await fixture(apply);try{await fn(f)}finally{await f.db.close()}}
const complete=async(db:PGlite,rows:Job[])=>{for(const r of rows)await db.query(`update company_provisioning_jobs set status='completed',locked_at=null,locked_by=null,lease_token=null where id=$1`,[r.id])}

describe('bounded supersession and durable provisioning turns',()=>{
 it.each([120,300])('p_limit1 with %i rows coalesces at most100 and claims newest before full cleanup',total=>scope(async({db,claim})=>{
   await db.query(`insert into company_provisioning_jobs(company_id,job_key,idempotency_key,created_at,available_at) select $1,'ediel_readiness_revalidate','snapshot-'||n,now()-make_interval(mins=>500-n),now()-interval '1 minute' from generate_series(0,$2::integer-1) n`,[companies[0],total])
   expect((await claim(1)).map(r=>r.idempotency_key)).toEqual(['snapshot-'+(total-1)])
   expect((await db.query<{completed:number;pending:number;processing:number}>(`select count(*) filter(where status='completed')::int completed,count(*) filter(where status='pending')::int pending,count(*) filter(where status='processing')::int processing from company_provisioning_jobs`)).rows[0]).toEqual({completed:100,pending:total-101,processing:1})
   expect(await claim(1)).toEqual([])
   expect((await db.query<{n:number}>(`select count(*)::int n from company_provisioning_jobs where status='pending'`)).rows[0].n).toBe(Math.max(0,total-201))
 }))
 for(const sameTimestamp of [false,true])it(`all four companies advance across limit2 calls (one transaction=${sameTimestamp})`,()=>scope(async({db,enqueue,claim})=>{
   for(let c=0;c<3;c++)for(let n=0;n<8;n++)await enqueue(companies[c],`busy-${c}-${n}`,1000-c*20-n)
   await enqueue(companies[3],'fresh',1)
   if(sameTimestamp)await db.exec('begin')
   try{const first=await claim(2);await complete(db,first);const second=await claim(2)
     expect(new Set([...first,...second].map(r=>r.company_id))).toEqual(new Set(companies.slice(0,4)))
     expect(second.some(r=>r.idempotency_key==='fresh')).toBe(true)
     expect([...first,...second].every(r=>r.attempt_count===1&&Boolean(r.lease_token))).toBe(true)
   }finally{if(sameTimestamp)await db.exec('rollback')}
 }))
 it('retains newer-future-retry backoff even when cleanup leaves older rows pending',()=>scope(async({db,enqueue,claim})=>{
   for(let n=0;n<130;n++)await enqueue(companies[0],`old-${n}`,300-n,'ediel_readiness_revalidate')
   await enqueue(companies[0],'future',1,'ediel_readiness_revalidate','retry',1440)
   expect(await claim(1)).toEqual([])
   expect((await db.query<{n:number}>(`select count(*)::int n from company_provisioning_jobs where status='pending'`)).rows[0].n).toBe(30)
   expect((await db.query<{status:string}>(`select status from company_provisioning_jobs where idempotency_key='future'`)).rows[0].status).toBe('retry')
 }))
 it('retains tenant operation/lifecycle eligibility, live leases and exhausted rows',()=>scope(async({db,enqueue,claim})=>{
   await enqueue(companies[4],'denied',10);await db.query(`update companies set status='suspended' where id=$1`,[companies[2]]);await enqueue(companies[2],'suspended',10)
   await enqueue(companies[0],'leased',50,'ediel_readiness_revalidate','processing',-1,1);await db.query(`update company_provisioning_jobs set locked_at=now(),locked_by='other',lease_token=gen_random_uuid() where idempotency_key='leased'`)
   const before=(await db.query<{r:unknown}>(`select to_jsonb(j) r from company_provisioning_jobs j where idempotency_key='leased'`)).rows[0].r
   await enqueue(companies[0],'exhausted',40,'ediel_readiness_revalidate','retry',-1,5);await enqueue(companies[1],'allowed',10)
   expect((await claim(20)).map(r=>r.idempotency_key)).toEqual(['allowed'])
   expect((await db.query<{r:unknown}>(`select to_jsonb(j) r from company_provisioning_jobs j where idempotency_key='leased'`)).rows[0].r).toEqual(before)
   expect((await db.query<{status:string}>(`select status from company_provisioning_jobs where idempotency_key='exhausted'`)).rows[0].status).toBe('retry')
 }))
 it.skipIf(donor)('rollback restores job state and claim turns while sequence gaps remain safe',()=>scope(async({db,enqueue,claim})=>{
   await enqueue(companies[0],'one',5);await db.exec('begin');expect(await claim(1)).toHaveLength(1);await db.exec('rollback')
   expect((await db.query<{status:string;attempt_count:number;claim_turn:string}>(`select status,attempt_count,claim_turn::text from company_provisioning_jobs`)).rows[0]).toEqual({status:'pending',attempt_count:0,claim_turn:'0'})
   expect(await claim(1)).toHaveLength(1);expect((await db.query<{turn:string}>(`select claim_turn::text turn from company_provisioning_jobs`)).rows[0].turn).toBe('2');expect(await claim(1)).toEqual([])
 }))
 it.skipIf(donor)('preserves all function/comment/table ACL metadata and keeps the sequence owner-only',()=>scope(async({db})=>{
   const read=async()=> (await db.query<{function:unknown;comment:unknown;acl:unknown}>(`select to_jsonb(p)-'prosrc' function,obj_description(p.oid,'pg_proc') comment,(select relacl from pg_class where oid='public.company_provisioning_jobs'::regclass) acl from pg_proc p where oid='public.canonical_claim_company_provisioning_jobs(text,integer,integer)'::regprocedure`)).rows[0]
   const before=await read();await db.exec(candidate);expect(await read()).toEqual(before)
   for(const role of ['anon','authenticated','service_role'])for(const privilege of ['usage','select','update'])expect((await db.query<{allowed:boolean}>(`select has_sequence_privilege($1,'public.gridex_provisioning_claim_turn_seq',$2) allowed`,[role,privilege])).rows[0].allowed).toBe(false)
   expect((await db.query<{a:boolean;b:boolean;s:boolean}>(`select has_function_privilege('anon','public.canonical_claim_company_provisioning_jobs(text,integer,integer)','execute') a,has_function_privilege('authenticated','public.canonical_claim_company_provisioning_jobs(text,integer,integer)','execute') b,has_function_privilege('service_role','public.canonical_claim_company_provisioning_jobs(text,integer,integer)','execute') s`)).rows[0]).toEqual({a:false,b:false,s:true})
 },false))
 it.skipIf(donor).each(['body','security','configuration','owner'])('unknown predecessor %s drift refuses before any scheduling state',kind=>scope(async({db})=>{
   const f=(await db.query<{def:string;body:string}>(`select pg_get_functiondef(oid) def,prosrc body from pg_proc where oid='public.canonical_claim_company_provisioning_jobs(text,integer,integer)'::regprocedure`)).rows[0]
   if(kind==='body')await db.exec(f.def.replace(f.body,()=>f.body+'\n-- unknown drift'))
   if(kind==='security')await db.exec('alter function public.canonical_claim_company_provisioning_jobs(text,integer,integer) security invoker')
   if(kind==='configuration')await db.exec('alter function public.canonical_claim_company_provisioning_jobs(text,integer,integer) set search_path=pg_catalog')
   if(kind==='owner')await db.exec('create role fixture_other_owner;alter function public.canonical_claim_company_provisioning_jobs(text,integer,integer) owner to fixture_other_owner')
   await expect(db.exec(candidate)).rejects.toMatchObject({code:'P0U01'});await db.exec('rollback')
   expect((await db.query<{sequence:boolean;column:boolean}>(`select to_regclass('public.gridex_provisioning_claim_turn_seq') is null sequence,not exists(select 1 from pg_attribute where attrelid='public.company_provisioning_jobs'::regclass and attname='claim_turn') column`)).rows[0]).toEqual({sequence:true,column:true})
 },false))
 it.skipIf(donor)('unexpected sequence default privileges refuse and roll back all new state',()=>scope(async({db})=>{
   await db.exec('create role fixture_unexpected;alter default privileges in schema public grant usage on sequences to fixture_unexpected')
   await expect(db.exec(candidate)).rejects.toMatchObject({code:'P0U01',message:'g3_provisioning_claim_turn_acl_changed'});await db.exec('rollback')
   expect((await db.query<{absent:boolean}>(`select to_regclass('public.gridex_provisioning_claim_turn_seq') is null absent`)).rows[0].absent).toBe(true)
   expect((await db.query<{absent:boolean}>(`select not exists(select 1 from pg_attribute where attrelid='public.company_provisioning_jobs'::regclass and attname='claim_turn') absent`)).rows[0].absent).toBe(true)
 },false))
})
