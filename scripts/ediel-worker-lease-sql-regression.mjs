// masterplan: TR-10, AT-TR-10, SC-063
// Actual current SQL owners, declared finite upstream actor/source/archive and
// claimed-queue ports. This is not genuine SMTP, native or whole-card proof.
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const migrations=new URL('../supabase/migrations/',import.meta.url)
let base=readFileSync(new URL('./ediel-prodat-recovery-phase-regression.mjs',import.meta.url),'utf8')
const marker=' console.log(JSON.stringify({checks,status:'
const stop=base.indexOf(marker);assert(stop>0)
base=base.slice(0,stop).replace('new URL(`../supabase/migrations/${name}`,import.meta.url)',`new URL(name,${JSON.stringify(migrations.href)})`)
const phase=String.raw`
 const baselineChecks=checks;
 await message(60,raw('LEASE',['A']));const leaseBinding=await binding(60,raw('LEASE',['A']));await archive(60,leaseBinding);
 const leaseOwner={kind:'worker',outboxId:id(61),sendAttemptId:id(62),workerId:'finite-worker'};
 await db.query("INSERT INTO public.ediel_outbox(id,ediel_message_id,company_id,environment,status,current_send_attempt_id,locked_by,locked_at)VALUES($1,$2,$3,'test','sending',$4,'finite-worker',now())",[id(61),id(60),id(1),id(62)]);
 for(const clock of ["now()-interval '1 hour'","NULL","now()+interval '1 hour'"]){
  await db.exec('UPDATE public.ediel_outbox SET locked_at='+clock+' WHERE id=\''+id(61)+'\'');
  await assert.rejects(journal(60,3,63,'prepare',{owner:leaseOwner,binding:leaseBinding}),/worker_fence_lost/);checks++;
  assert.equal((await db.query('SELECT count(*)n FROM gridex_ediel_transport.attempts WHERE message_id=$1',[id(60)])).rows[0].n,0);checks++;
 }
 await db.query('UPDATE public.ediel_outbox SET locked_at=now() WHERE id=$1',[id(61)]);
 assert.equal((await journal(60,3,63,'prepare',{owner:leaseOwner,binding:leaseBinding})).rows[0].b.proceed,true);checks++;
 await db.query("UPDATE public.ediel_outbox SET locked_at=now()-interval '1 hour' WHERE id=$1",[id(61)]);
 await assert.rejects(journal(60,3,63,'enter'),/worker_fence_lost/);checks++;
 assert.equal((await db.query('SELECT entered_at FROM gridex_ediel_transport.attempts WHERE id=$1',[id(63)])).rows[0].entered_at,null);checks++;
 assert.equal((await db.query('SELECT state FROM gridex_ediel_transport.reservations WHERE message_id=$1',[id(60)])).rows[0].state,'prepared');checks++;
 await db.query('UPDATE public.ediel_outbox SET locked_at=now() WHERE id=$1',[id(61)]);
 assert.equal((await journal(60,3,63,'enter')).rows[0].b.proceed,true);checks++;
 // A late actual observation records the same attempt after the public lease
 // is held; expiry cannot erase entry or authorize a different attempt.
 await db.query("UPDATE public.ediel_outbox SET locked_at=NULL,locked_by=NULL,status='delivery_uncertain' WHERE id=$1",[id(61)]);
 assert.equal((await journal(60,3,63,'observe',{result:{accepted:['peer@example.invalid'],rejected:[],messageId:'<late-finite>'}})).rows[0].b.classification,'accepted');checks++;
 assert.equal((await journal(60,3,64,'prepare',{owner:leaseOwner,binding:leaseBinding})).rows[0].b.proceed,false);checks++;
 assert.equal((await db.query('SELECT count(*)n FROM gridex_ediel_transport.attempts WHERE message_id=$1',[id(60)])).rows[0].n,1);checks++;
 console.log(JSON.stringify({status:'PASS',checks,baselineChecks,leaseChecks:checks-baselineChecks,scope:'actual prepare/entry fence, absent/future/expired lease, zero premature attempt, late same-attempt observation and no resend; upstream ports synthetic'}));
}catch(error){console.error(JSON.stringify({status:'FAIL',checks,message:error.message,code:error.code,where:error.where}));process.exitCode=1}finally{await db.close()}
`
try{await import('data:text/javascript;base64,'+Buffer.from(base+phase).toString('base64'))}catch(error){console.error(error.message);process.exitCode=1}
