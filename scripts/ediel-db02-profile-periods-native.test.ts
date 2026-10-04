// masterplan: DB-02, AT-DB-02
// Installed disposable Supabase/PG17 constraints and two real SQL sessions.
// Synthetic profile/tenant data; no market, issuer, SMTP or hosted write proof.
import {readFileSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'

const connection='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const migration=readFileSync('supabase/migrations/20261004223219_ediel_tenant_profile_interval_guard.sql','utf8')
const creation=readFileSync('supabase/migrations/20260713100000_ediel_completion_and_platform_contract.sql','utf8').match(/create table if not exists public\.tenant_ediel_profiles \([\s\S]*?\n\);/)![0]
const table='public.tenant_ediel_profiles'
const row=(id:string,company:string,from:string,to:string|null=null,enabled=true,environment='production')=>
 `INSERT INTO ${table}(id,company_id,environment,is_enabled,valid_from,valid_to) VALUES(${literal(id)},${literal(company)},${literal(environment)},${enabled},${literal(from)},${literal(to)});`
const denies=(statement:string,code:string)=>`DO $denial$ DECLARE state text;BEGIN
 BEGIN ${statement} EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE;END;
 IF state IS DISTINCT FROM '${code}' THEN RAISE EXCEPTION 'expected_sqlstate_${code}, got %',state;END IF;
 END $denial$;`
const companyInsert=(company:string)=>`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'SYNTHETIC DB02 profile integrity','active');`

it('installs a validated profile-only exclusion and date-order constraint with the genuine extension',()=>{
 const value=sql<{extension:string;constraints:Array<{name:string;kind:string;validated:boolean;definition:string}>}>(`SELECT jsonb_build_object(
 'extension',(SELECT extname FROM pg_extension WHERE extname='btree_gist'),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'kind',contype,'validated',convalidated,'definition',pg_get_constraintdef(oid)) ORDER BY conname)
 FROM pg_constraint WHERE conrelid='public.tenant_ediel_profiles'::regclass AND conname IN('tenant_ediel_profiles_enabled_period_excl','tenant_ediel_profiles_validity_order')));`)
 expect(value.extension).toBe('btree_gist')
 expect(value.constraints).toHaveLength(2)
 expect(value.constraints.map(c=>[c.kind,c.validated])).toEqual([['x',true],['c',true]])
 expect(value.constraints[0].definition).toContain('tstzrange')
 expect(value.constraints[0].definition).toContain('WHERE (is_enabled)')
})
it('actual profile writes enforce parent/date/half-open/disabled/update boundaries and roll back their fixture',()=>{
 const company=randomUUID(),foreign=randomUUID(),first=randomUUID(),second=randomUUID(),disabled=randomUUID(),foreignProfile=randomUUID(),testProfile=randomUUID()
 const value=sql<{count:number;enabled:number}>(`BEGIN;
 ${companyInsert(company)}${companyInsert(foreign)}
 ${row(first,company,'2026-01-01','2026-07-01T00:00:00.000001Z')}${row(second,company,'2026-07-01T00:00:00.000001Z')}
 ${denies(row(randomUUID(),company,'2026-07-01T00:00:00Z'),'23P01')}
 ${row(disabled,company,'2026-06-01',null,false)}
 ${denies(`UPDATE ${table} SET is_enabled=true WHERE id=${literal(disabled)};`,'23P01')}
 ${denies(row(randomUUID(),company,'2026-09-01','2026-08-01',false),'23514')}
 ${denies(`UPDATE ${table} SET valid_to='2025-12-31' WHERE id=${literal(first)};`,'23514')}
 ${row(randomUUID(),company,'2026-02-01','2026-02-01')}
 ${row(foreignProfile,foreign,'2026-06-01')}${row(testProfile,company,'2026-06-01',null,true,'test')}
 ${denies(`UPDATE ${table} SET company_id=${literal(company)} WHERE id=${literal(foreignProfile)};`,'23P01')}
 ${denies(`UPDATE ${table} SET environment='production' WHERE id=${literal(testProfile)};`,'23P01')}
 UPDATE ${table} SET metadata='{"sameRow":true}',valid_from='2026-02-01' WHERE id=${literal(first)};
 ${denies(`UPDATE ${table} SET valid_to=NULL WHERE id=${literal(first)};`,'23P01')}
 ${denies(row(randomUUID(),randomUUID(),'2026-01-01'),'23503')}
 ${denies(`INSERT INTO ${table}(company_id,environment,valid_from) VALUES(${literal(company)},'production',NULL);`,'23502')}
 SELECT jsonb_build_object('count',count(*),'enabled',count(*) FILTER(WHERE is_enabled)) FROM ${table} WHERE company_id IN(${literal(company)},${literal(foreign)});
 ROLLBACK;`)
 expect(value).toEqual({count:6,enabled:5})
 expect(sql(`SELECT to_jsonb(count(*)) FROM ${table} WHERE company_id IN(${literal(company)},${literal(foreign)})`)).toBe(0)
})

function session(){
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_only')
 const child=spawn('psql',[connection,'-XAtq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{stdio:['pipe','pipe','pipe']})
 let stdout='',stderr=''
 child.stdout.on('data',data=>{stdout+=String(data)})
 child.stderr.on('data',data=>{stderr+=String(data)})
 const done=new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}))})
 return {child,done,output:()=>stdout}
}
async function until(check:()=>boolean){
 const deadline=Date.now()+10_000
 while(!check()){
  if(Date.now()>deadline)throw Error('native_profile_wait_not_observed')
  await new Promise(resolve=>setTimeout(resolve,25))
 }
}
it.each(['commit','rollback'] as const)('two real sessions at repeatable-read preserve same-scope exclusion when first writer %s',async outcome=>{
 const company=randomUUID(),first=randomUUID(),second=randomUUID(),app=`db02_${randomUUID()}`
 sql(companyInsert(company))
 const a=session(),b=session()
 try{
  a.child.stdin.write(`BEGIN ISOLATION LEVEL REPEATABLE READ;${row(first,company,'2026-01-01')}SELECT 'first_written';\n`)
  await until(()=>a.output().includes('first_written'))
  b.child.stdin.end(`SET application_name=${literal(app)};SET statement_timeout='15s';BEGIN ISOLATION LEVEL REPEATABLE READ;
   SELECT count(*) FROM ${table} WHERE company_id=${literal(company)};SELECT 'snapshot_observed';
   ${row(second,company,'2026-06-01')}COMMIT;`)
  await until(()=>b.output().includes('snapshot_observed'))
  await until(()=>sql<number>(`SELECT to_jsonb(count(*)) FROM pg_stat_activity WHERE application_name=${literal(app)} AND wait_event_type='Lock' AND wait_event='transactionid'`)>0)
  a.child.stdin.end(outcome==='commit'?'COMMIT;':'ROLLBACK;')
  expect((await a.done).code).toBe(0)
  const completed=await b.done
  if(outcome==='commit'){
   expect(completed.code).not.toBe(0)
   expect(completed.stderr).toContain('23P01')
   expect(completed.stderr).toContain('tenant_ediel_profiles_enabled_period_excl')
  }else expect(completed.code,completed.stderr).toBe(0)
  expect(sql(`SELECT jsonb_agg(id ORDER BY id) FROM ${table} WHERE company_id=${literal(company)}`)).toEqual([outcome==='commit'?first:second])
 }finally{
  if(a.child.exitCode===null)a.child.kill('SIGTERM')
  if(b.child.exitCode===null)b.child.kill('SIGTERM')
  await Promise.allSettled([a.done,b.done])
  sql(`DELETE FROM ${table} WHERE company_id=${literal(company)};`)
 }
},30_000)

it.each(['reversed','overlap'] as const)('real migration preflight refuses legacy %s and leaves retained source rows intact',kind=>{
 const company=randomUUID(),namespace=`db02_${randomUUID().replaceAll('-','')}`
 const source=migration.replaceAll('public.tenant_ediel_profiles',`${namespace}.tenant_ediel_profiles`)
 sql(`${companyInsert(company)}CREATE SCHEMA ${namespace};${creation.replace('public.tenant_ediel_profiles',`${namespace}.tenant_ediel_profiles`)}`)
 try{
  const values=kind==='reversed'?`(gen_random_uuid(),${literal(company)},'production',false,'2026-09-01','2026-08-01')`:`(gen_random_uuid(),${literal(company)},'production',true,'2026-01-01',NULL),(gen_random_uuid(),${literal(company)},'production',true,'2026-06-01',NULL)`
  sql(`INSERT INTO ${namespace}.tenant_ediel_profiles(id,company_id,environment,is_enabled,valid_from,valid_to) VALUES${values}`)
  const before=sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM ${namespace}.tenant_ediel_profiles p`)
  expect(()=>sql(source)).toThrow(kind==='reversed'?'tenant_ediel_profile_existing_reversed_interval':'tenant_ediel_profile_existing_enabled_overlap')
  expect(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM ${namespace}.tenant_ediel_profiles p`)).toEqual(before)
  expect(sql(`SELECT to_jsonb(count(*)) FROM pg_constraint WHERE conrelid='${namespace}.tenant_ediel_profiles'::regclass AND conname IN('tenant_ediel_profiles_enabled_period_excl','tenant_ediel_profiles_validity_order')`)).toBe(0)
 }finally{sql(`DROP SCHEMA ${namespace} CASCADE;`)}
})
