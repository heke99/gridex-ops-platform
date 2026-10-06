// masterplan: DB-02, AT-DB-02
// Actual immutable profile DDL and forward migration on finite PostgreSQL.
// Companies are synthetic; no RLS/session/native concurrency claim.
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist'
import {afterEach,beforeEach,expect,it} from 'vitest'

const creation=readFileSync('supabase/migrations/20260713100000_ediel_completion_and_platform_contract.sql','utf8')
const profileDdl=creation.match(/create table if not exists public\.tenant_ediel_profiles \([\s\S]*?\n\);/)![0]
const ownerDdl=readFileSync('supabase/migrations/20260930143025_ediel_service_assignment_grants_v1.sql','utf8').match(/create unique index if not exists ediel_service_profile_owner_key[^;]+;/)![0]
const migration=readFileSync('supabase/migrations/20261004223219_ediel_tenant_profile_interval_guard.sql','utf8')
const company='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let db:PGlite
async function oldDatabase(){
 const value=new PGlite({extensions:{btree_gist}})
 await value.exec(`CREATE SCHEMA extensions;CREATE TABLE public.companies(id uuid PRIMARY KEY);INSERT INTO companies VALUES('${company}'),('${other}');`)
 await value.exec(profileDdl);await value.exec(ownerDdl)
 return value
}
async function add(n:number,from:string|null,to:string|null=null,enabled=true,tenant=company,environment='production'){
 return db.query('INSERT INTO public.tenant_ediel_profiles(id,company_id,environment,is_enabled,valid_from,valid_to) VALUES($1,$2,$3,$4,$5,$6)',[id(n),tenant,environment,enabled,from,to])
}
beforeEach(async()=>{db=await oldDatabase();await db.exec(migration)})
afterEach(async()=>{await db.close()})

it('rejects a company UUID without its actual parent',async()=>{
 await expect(add(10,'2026-01-01',null,true,id(99))).rejects.toMatchObject({code:'23503'})
})
it('preserves existing same-scope/start uniqueness, even for disabled rows',async()=>{
 await add(10,'2026-01-01',null,false)
 await expect(add(11,'2026-01-01',null,false)).rejects.toMatchObject({code:'23505'})
})
it('rejects overlapping enabled INSERTs with different IDs and starts',async()=>{
 await add(10,'2026-01-01')
 await expect(add(11,'2026-06-01')).rejects.toMatchObject({code:'23P01'})
 expect((await db.query('SELECT count(*)::int n FROM tenant_ediel_profiles')).rows).toEqual([{n:1}])
})
it('also rejects future overlapping enabled periods',async()=>{
 await add(10,'2090-01-01')
 await expect(add(11,'2090-06-01')).rejects.toMatchObject({code:'23P01'})
})
it('permits adjacent half-open periods at exact microsecond precision',async()=>{
 await add(10,'2026-01-01','2026-07-01T00:00:00.000001Z')
 await add(11,'2026-07-01T00:00:00.000001Z')
 expect((await db.query('SELECT count(*)::int n FROM tenant_ediel_profiles')).rows).toEqual([{n:2}])
})
it('rejects one microsecond of overlap',async()=>{
 await add(10,'2026-01-01','2026-07-01T00:00:00.000001Z')
 await expect(add(11,'2026-07-01T00:00:00Z')).rejects.toMatchObject({code:'23P01'})
})
it('treats a NULL end as unbounded without accepting a NULL start',async()=>{
 await add(10,'2026-01-01')
 await expect(add(11,'2100-01-01')).rejects.toMatchObject({code:'23P01'})
 await expect(add(12,null)).rejects.toMatchObject({code:'23502'})
})
it('preserves empty equal-endpoint periods alongside a nonempty interval',async()=>{
 await add(10,'2026-01-01');await add(11,'2026-06-01','2026-06-01')
 expect((await db.query('SELECT count(*)::int n FROM tenant_ediel_profiles')).rows).toEqual([{n:2}])
})
it('permits disabled overlaps and disabling a current profile',async()=>{
 await add(10,'2026-01-01');await add(11,'2026-06-01',null,false)
 await db.query('UPDATE tenant_ediel_profiles SET is_enabled=false WHERE id=$1',[id(10)])
 expect((await db.query('SELECT count(*)::int n FROM tenant_ediel_profiles WHERE is_enabled')).rows).toEqual([{n:0}])
})
it('rejects re-enabling an overlapping disabled profile',async()=>{
 await add(10,'2026-01-01');await add(11,'2026-06-01',null,false)
 await expect(db.query('UPDATE tenant_ediel_profiles SET is_enabled=true WHERE id=$1',[id(11)])).rejects.toMatchObject({code:'23P01'})
})
it.each([true,false])('rejects reversed interval INSERT, enabled=%s',async enabled=>{
 await expect(add(10,'2026-09-01','2026-08-01',enabled)).rejects.toMatchObject({code:'23514'})
})
it.each([true,false])('rejects reversed interval UPDATE, enabled=%s',async enabled=>{
 await add(10,'2026-01-01',null,enabled)
 await expect(db.query("UPDATE tenant_ediel_profiles SET valid_to='2025-12-31' WHERE id=$1",[id(10)])).rejects.toMatchObject({code:'23514'})
})
it('rejects an UPDATE that moves an adjacent start into overlap',async()=>{
 await add(10,'2026-01-01','2026-07-01');await add(11,'2026-07-01')
 await expect(db.query("UPDATE tenant_ediel_profiles SET valid_from='2026-06-01' WHERE id=$1",[id(11)])).rejects.toMatchObject({code:'23P01'})
})
it('rejects an UPDATE that opens an adjacent interval end',async()=>{
 await add(10,'2026-01-01','2026-07-01');await add(11,'2026-07-01')
 await expect(db.query('UPDATE tenant_ediel_profiles SET valid_to=NULL WHERE id=$1',[id(10)])).rejects.toMatchObject({code:'23P01'})
})
it('excludes the same physical row when its metadata or bounds are updated safely',async()=>{
 await add(10,'2026-01-01','2026-07-01');await add(11,'2026-07-01')
 await db.query('UPDATE tenant_ediel_profiles SET metadata=$1,valid_from=$2 WHERE id=$3',[{note:'owned row'},'2026-02-01',id(10)])
 expect((await db.query('SELECT metadata FROM tenant_ediel_profiles WHERE id=$1',[id(10)])).rows).toEqual([{metadata:{note:'owned row'}}])
})
it.each(['company','environment'] as const)('keeps overlapping periods independent across %s',async scope=>{
 await add(10,'2026-01-01');await add(11,'2026-06-01',null,true,scope==='company'?other:company,scope==='environment'?'test':'production')
 expect((await db.query('SELECT count(*)::int n FROM tenant_ediel_profiles')).rows).toEqual([{n:2}])
})
it.each(['company','environment'] as const)('rejects a scope UPDATE that moves a profile into same-scope overlap: %s',async scope=>{
 await add(10,'2026-01-01');await add(11,'2026-06-01',null,true,scope==='company'?other:company,scope==='environment'?'test':'production')
 await expect(db.query(`UPDATE tenant_ediel_profiles SET ${scope==='company'?'company_id':'environment'}=$1 WHERE id=$2`,[scope==='company'?company:'production',id(11)])).rejects.toMatchObject({code:'23P01'})
})
it('preserves the real electricity market constraint',async()=>{
 await expect(db.query("INSERT INTO tenant_ediel_profiles(company_id,environment,market) VALUES($1,'production','gas')",[company])).rejects.toMatchObject({code:'23514'})
})
it('rolls back the entire attempted transaction after an overlap',async()=>{
 await db.exec('BEGIN')
 await add(10,'2026-01-01')
 await expect(add(11,'2026-06-01')).rejects.toMatchObject({code:'23P01'})
 await db.exec('ROLLBACK')
 expect((await db.query('SELECT count(*)::int n FROM tenant_ediel_profiles')).rows).toEqual([{n:0}])
})
it.each(['reversed','overlap'] as const)('legacy preflight holds %s without changing retained rows',async kind=>{
 const legacy=await oldDatabase()
 try{
  const values=kind==='reversed'?`('${id(20)}','${company}','production',false,'2026-09-01','2026-08-01')`:`('${id(20)}','${company}','production',true,'2026-01-01',NULL),('${id(21)}','${company}','production',true,'2026-06-01',NULL)`
  await legacy.exec(`INSERT INTO tenant_ediel_profiles(id,company_id,environment,is_enabled,valid_from,valid_to) VALUES${values}`)
  const before=(await legacy.query('SELECT * FROM tenant_ediel_profiles ORDER BY id')).rows
  await expect(legacy.exec(migration)).rejects.toMatchObject({code:'23514',message:kind==='reversed'?'tenant_ediel_profile_existing_reversed_interval':'tenant_ediel_profile_existing_enabled_overlap'})
  await legacy.exec('ROLLBACK')
  expect((await legacy.query('SELECT * FROM tenant_ediel_profiles ORDER BY id')).rows).toEqual(before)
  expect((await legacy.query("SELECT count(*)::int n FROM pg_constraint WHERE conrelid='tenant_ediel_profiles'::regclass AND conname='tenant_ediel_profiles_enabled_period_excl'")).rows).toEqual([{n:0}])
 }finally{await legacy.close()}
})
