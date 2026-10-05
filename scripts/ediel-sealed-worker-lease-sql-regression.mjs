// masterplan: TR-10, AT-TR-10, SC-063
// Actual sealed prepare/entry owner with declared upstream actor/pack/codec and
// calendar clock fixtures. No genuine native/archive/SMTP authority claimed.
import{readFileSync}from'node:fs'
import assert from'node:assert/strict'
const migrations=new URL('../supabase/migrations/',import.meta.url)
let base=readFileSync(new URL('./ediel-z08-stockholm-guide-clock-sql-regression.mjs',import.meta.url),'utf8')
const marker=' await create(10);';const stop=base.indexOf(marker);assert(stop>0)
base=base.slice(0,stop).replace(/new URL\('\.\.\/supabase\/migrations\/([^']+)',import.meta.url\)/g,(_,file)=>`new URL(${JSON.stringify(file)},${JSON.stringify(migrations.href)})`)
const phase=String.raw`
 await db.exec('ALTER TABLE public.ediel_outbox ADD locked_at timestamptz');
 if(process.env.EDIEL_WORKER_LEASE_BASELINE!=='1'){
  const forward=readFileSync(new URL('20261004204256_ediel_worker_lease_current_provider_entry.sql',${JSON.stringify(migrations.href)}),'utf8');
  await db.exec(forward.replace(') AS patches(signature,old_fragment,new_fragment)',') AS patches(signature,old_fragment,new_fragment) WHERE to_regprocedure(signature) IS NOT NULL'));
 }
 await create(20);
 const leaseOwner={kind:'worker',outboxId:uid(21),sendAttemptId:uid(22),workerId:'finite-sealed-worker'};
 await db.query("INSERT INTO public.ediel_outbox VALUES($1,$2,$3,'test','sending',$4,'finite-sealed-worker',now())",[uid(21),uid(20),uid(1),uid(22)]);
 const command=(action)=>db.query('SELECT gridex_outbound_dispatch.mutate_before_observed_clock_v1($1)b',[{...input(20),action,owner:leaseOwner}]);
 for(const clock of ["now()-interval '1 hour'","NULL","now()+interval '1 hour'"]){
  await db.exec('UPDATE public.ediel_outbox SET locked_at='+clock);
  await assert.rejects(command('prepare'),/worker_fence_lost/);checks++;
  assert.equal((await db.query('SELECT count(*)n FROM gridex_outbound_dispatch.attempts')).rows[0].n,0);checks++;
 }
 await db.exec('UPDATE public.ediel_outbox SET locked_at=now()');assert.equal((await command('prepare')).rows[0].b.proceed,true);checks++;
 await db.exec("UPDATE public.ediel_outbox SET locked_at=now()-interval '1 hour'");await assert.rejects(command('enter'),/worker_fence_lost/);checks++;
 assert.equal((await db.query("SELECT count(*)n FROM gridex_outbound_dispatch.events WHERE kind='provider_call_entered'")).rows[0].n,0);checks++;
 assert.equal((await db.query('SELECT state FROM gridex_outbound_dispatch.reservations')).rows[0].state,'prepared');checks++;
 await db.exec('UPDATE public.ediel_outbox SET locked_at=now()');assert.equal((await command('enter')).rows[0].b.proceed,true);checks++;
 assert.equal((await db.query("SELECT count(*)n FROM gridex_outbound_dispatch.events WHERE kind='provider_call_entered'")).rows[0].n,1);checks++;
 console.log(JSON.stringify({status:'PASS',checks,scope:'actual sealed prepare/entry stale/null/futurelease refusal, no prematureattempt/entry; synthetic actor/profile/codec/calendar fixtures'}));
}catch(error){console.error(JSON.stringify({status:'FAIL',checks,message:error.message,code:error.code,where:error.where}));process.exitCode=1}finally{await db.close()}
`
// This literal URL is expanded only into the isolated finite script.
const appended=phase.replace('${JSON.stringify(migrations.href)}',JSON.stringify(migrations.href))
try{await import('data:text/javascript;base64,'+Buffer.from(base+appended).toString('base64'))}catch(error){console.error(error.message);process.exitCode=1}
