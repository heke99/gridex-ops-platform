// Historical metadata normalization in an isolated fixture, never production repair.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const source='migrations/20260520_user_profiles_auth_action_constraint_hardfix.sql';
const prerequisite='bootstrap/20260519_user_profiles_foundation.sql';
const {PGlite}=await import(pathToFileURL(process.env.GRIDEX_PGLITE_MODULE).href);
for(const legacy of [false,true]) {
  const db=new PGlite();
  try {
    await db.exec('create schema auth; create table auth.users(id uuid primary key);');
    const bootstrap=read('supabase/'+prerequisite);const start=bootstrap.indexOf('create table if not exists public.user_profiles (');assert(start>=0);
    // Actual table/ALTER/index statements. pgcrypto installation is outside this scoped fixture.
    await db.exec(bootstrap.slice(start));
    assert.equal((await db.query("select count(*)::int n from pg_trigger where tgrelid='user_profiles'::regclass and not tgisinternal")).rows[0].n,0,'no application triggers at this foundation boundary');
    if(legacy) await db.exec('alter table user_profiles drop constraint user_profiles_last_auth_email_action_check');
    const values=legacy ? ['   ',' Legacy-Action:V1.2! ', 'A'.repeat(140),null] : ['invite_sent','auth_callback_completed',null];
    for(let i=0;i<values.length;i++) {
      const id=`10000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`;
      await db.query('insert into auth.users values ($1)',[id]);
      await db.query('insert into user_profiles(id,email,full_name,last_auth_email_action) values ($1,$2,$3,$4)',[id,`synthetic${i}@example.invalid`,'preserve',values[i]]);
    }
    const before=(await db.query('select * from user_profiles order by id')).rows;
    const expected=legacy ? [null,'legacy_action:v1.2_','a'.repeat(120),null] : values;
    for(let pass=1;pass<=2;pass++) {
      await db.exec(read('supabase/'+source));
      assert.deepEqual((await db.query('select * from user_profiles order by id')).rows,before.map((row,i)=>({...row,last_auth_email_action:expected[i]})),'only tracking metadata normalized; identity/status/timestamps unchanged');
      const c=(await db.query("select convalidated from pg_constraint where conrelid='user_profiles'::regclass and conname='user_profiles_last_auth_email_action_check'")).rows;
      assert.deepEqual(c,[{convalidated:true}]);
    }
    for(const invalid of ['UPPERCASE','space value','a'.repeat(121),'']) await assert.rejects(db.query('update user_profiles set last_auth_email_action=$1',[invalid]),/user_profiles_last_auth_email_action_check/);
    await db.query('update user_profiles set last_auth_email_action=$1',['custom.action:v2']);
    assert.equal((await db.query("select count(*)::int n from pg_constraint where conrelid='user_profiles'::regclass and contype='f'")).rows[0].n,2,'auth ownership foreign keys preserved');
    console.log(`PASS: whole profile source twice (${legacy?'legacy values':'valid original values'}); deterministic normalization; identity/status/timestamps/FKs preserved`);
  } finally {await db.close();}
}
const result=spawnSync('python3',[new URL('scripts/gridex-replay-input-accounting.py',root).pathname],{encoding:'utf8'});const report=JSON.parse(result.stdout);assert.deepEqual(report.errors,[]);
const row=report.migrations.find(row=>row.path===source);assert.equal(row?.classification,'FULL_FILE_SELECTED');assert.equal(row.execution[0].stage,'foundation');
const order=JSON.parse(read('scripts/gridex-aud-003-foundation-order.json')).foundation;assert.equal(order.indexOf(source),order.indexOf(prerequisite)+1);
for(const name of order.slice(0,order.indexOf(prerequisite))) assert(!read('supabase/'+name).includes('user_profiles'),'earlier profile reference requires fresh trigger review');
assert(!/create\s+(?:or\s+replace\s+)?(?:function|trigger)/i.test(read('supabase/'+prerequisite)),'profile bootstrap trigger/function change requires review');
console.log('PASS: full profile source selected at reviewed trigger-free foundation boundary');
