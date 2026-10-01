const {test}=require('node:test')
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const {randomUUID}=require('node:crypto')
const {createResumeCore}=require('./ediel-resume-tenant-progress-20261001-core.cjs')
const file=resolve(__dirname,'../supabase/migrations/20261001012959_ediel_resume_tenant_fair_claim.sql')
const source=readFileSync(file,'utf8')
const call=async(f,name,args)=>{const result=await f.service.rpc(name,args);if(result.error)throw Object.assign(new Error(result.error.message),{code:result.error.code});return result.data}
const claim=(f,phase='validated',limit=25,company=null,token=randomUUID())=>call(f,'gridex_claim_ediel_resume_intents_fair_v1',{p_phase:phase,p_company_id:company,p_limit:limit,p_claim_token:token})
const check=(f,c,token=c.claimToken)=>call(f,'gridex_check_ediel_resume_claim_v1',{p_company_id:c.intent.company_id,p_intent_id:c.intent.id,p_phase:c.phase,p_claim_token:token})
const finish=(f,c,token=c.claimToken,outcome='processed')=>call(f,'gridex_finish_ediel_resume_claim_v1',{p_company_id:c.intent.company_id,p_intent_id:c.intent.id,p_phase:c.phase,p_claim_token:token,p_outcome:outcome,p_reason:null})
const snapshot=async f=>Object.fromEntries(await Promise.all(['public.ediel_message_intents','private.ediel_resume_claims','private.ediel_resume_tenant_turns'].map(async table=>[table,(await f.db.query(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`)).rows])))
for(const phase of['validated','draft']){
 test(`${phase}: actual SQL capped noisy/quiet batch and persisted limit-one phase rotation`,async()=>{
  const f=await createResumeCore();try{await f.seed(phase);const before=(await snapshot(f))['public.ediel_message_intents'];const rows=await claim(f,phase,100)
   assert.equal(rows.filter(c=>c.intent.company_id===f.A).length,5);assert.equal(rows.filter(c=>c.intent.company_id===f.B).length,1)
   assert.deepEqual((await snapshot(f))['public.ediel_message_intents'],before)
   for(const row of rows)assert.equal(await finish(f,row),true)
   assert.equal((await claim(f,phase,1))[0].intent.company_id,f.A)
   // Same initial batch stamped both turns. A limit-one claim advances only A.
   assert.equal((await claim(f,phase,1))[0].intent.company_id,f.B)
  }finally{await f.db.close()}
 })
 test(`${phase}: current phase, stamp, company and token denial does not change evidence`,async()=>{
  const f=await createResumeCore();try{await f.seed(phase,0,1);const c=(await claim(f,phase,1,f.B))[0];assert.equal(await check(f,c),true)
   const before=await snapshot(f);assert.equal(await check(f,c,randomUUID()),false);assert.equal(await finish(f,c,randomUUID()),false);assert.deepEqual(await snapshot(f),before)
   await f.db.query("update public.ediel_message_intents set updated_at=clock_timestamp() where id=$1",[c.intent.id]);assert.equal(await check(f,c),false)
   await f.db.query("update public.companies set status='paused' where id=$1",[f.B]);assert.equal(await check(f,c),false);assert.equal(await finish(f,c),false)
   assert.deepEqual(await claim(f,phase,1,f.B),[])
  }finally{await f.db.close()}
 })
}
test('eligibility exactly preserves stored validated/draft phases; inactive or missing prerequisites never claim',async()=>{
 const f=await createResumeCore();try{
  const ids=await f.seed('validated',2,1);await f.db.query("update ediel_message_intents set render_status='rendered'where id=$1",[ids.A[0]])
  await f.db.query("update ediel_message_intents set outbox_status='queued'where id=$1",[ids.A[1]])
  await f.db.query("update companies set status=null where id=$1",[f.B]);assert.deepEqual(await claim(f),[])
  await f.db.query("update companies set status='active'where id=$1",[f.B]);const draft=await f.seed('draft',2,0)
  await f.db.query("update ediel_message_intents set direction='inbound_response'where id=$1",[draft.A[0]])
  await f.db.query("insert into ediel_messages(id)values($1)",[draft.A[1]]);await f.db.query("update ediel_message_intents set ediel_message_id=$1 where id=$1",[draft.A[1]])
  assert.deepEqual(await claim(f,'draft'),[]);assert.equal((await claim(f,'validated'))[0].intent.company_id,f.B)
 }finally{await f.db.close()}
})
test('active leases are disjoint and unfinished expiry cutoff survives actual current-row UPSERT CAS',async()=>{
 const f=await createResumeCore();try{await f.seed('validated',1,0);const c=(await claim(f,'validated',1))[0];assert.deepEqual(await claim(f,'validated',1),[])
  const fragment=source.match(/\), leases as\(([\s\S]*?)\n \), turns as\(/)?.[1];assert(fragment,'actual production lease boundary required')
  const at='2026-10-01T00:00:00Z',newToken=randomUUID();await f.db.query("update private.ediel_resume_claims set claimed_at=$1::timestamptz-interval '1 minute',expires_at=$1::timestamptz where intent_id=$2",[at,c.intent.id])
  const concrete=fragment.replaceAll('p_phase',"'validated'").replaceAll('p_claim_token',`'${newToken}'::uuid`).replaceAll('v_now',`'${at}'::timestamptz`)
  const statement=`with chosen as(select id,company_id,updated_at from ediel_message_intents where id='${c.intent.id}'),leases as(${concrete})select * from leases`
  assert.deepEqual((await f.db.query(statement)).rows,[]);assert.equal((await f.db.query('select claim_token from private.ediel_resume_claims')).rows[0].claim_token,c.claimToken)
  await f.db.query("update private.ediel_resume_claims set expires_at=expires_at-interval '1 microsecond'where intent_id=$1",[c.intent.id])
  assert.equal((await f.db.query(statement)).rows.length,1);assert.equal((await f.db.query('select claim_token from private.ediel_resume_claims')).rows[0].claim_token,newToken)
 }finally{await f.db.close()}
})
test('expired lease reclaims with a new token; stale check/completion cannot replace it',async()=>{
 const f=await createResumeCore();try{await f.seed('validated',0,1);const c=(await claim(f,'validated',1,f.B))[0]
  await f.db.query("update private.ediel_resume_claims set claimed_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute'where intent_id=$1",[c.intent.id])
  const next=(await claim(f,'validated',1,f.B))[0],before=await snapshot(f);assert.notEqual(next.claimToken,c.claimToken)
  assert.equal(await check(f,c),false);assert.equal(await finish(f,c),false);assert.deepEqual(await snapshot(f),before)
  assert.equal(await check(f,next),true);assert.equal(await finish(f,next),true);assert.equal(await finish(f,next),false)
 }finally{await f.db.close()}
})
test('service-only low-role/input guards and late tenant-turn error roll all new claims back',async()=>{
 const f=await createResumeCore();try{await f.seed('validated',1,1);const before=await snapshot(f)
  for(const role of['anon','authenticated']){await f.db.exec('reset role;set role '+role);await assert.rejects(()=>claim(f),e=>e.code==='42501');await f.db.exec('reset role;set role service_role')}
  await assert.rejects(()=>claim(f,'untrusted'),e=>e.code==='22023')
  await f.db.exec("reset role;create function private.synthetic_turn_fault()returns trigger language plpgsql as $$begin if new.company_id='"+f.B+"'then raise exception 'synthetic_turn_fault';end if;return new;end$$;create trigger synthetic_turn_fault before insert or update on private.ediel_resume_tenant_turns for each row execute function private.synthetic_turn_fault();set role service_role")
  await assert.rejects(()=>claim(f),/synthetic_turn_fault/);assert.deepEqual(await snapshot(f),before)
 }finally{await f.db.close()}
})
test('late completion expiry rolls back private completion and reaches the actual final-update hook',async()=>{
 const f=await createResumeCore();try{await f.seed('validated',0,1);const c=(await claim(f,'validated',1,f.B))[0]
  await f.db.exec("reset role;create sequence private.synthetic_finish_reached;grant usage on sequence private.synthetic_finish_reached to service_role;create function private.synthetic_finish_delay()returns trigger language plpgsql as $$begin if new.finished_at is not null then perform nextval('private.synthetic_finish_reached');perform pg_sleep(0.3);end if;return new;end$$;create trigger synthetic_finish_delay before update on private.ediel_resume_claims for each row execute function private.synthetic_finish_delay();set role service_role")
  await f.db.query("update private.ediel_resume_claims set claimed_at=clock_timestamp()-interval '1 second',expires_at=clock_timestamp()+interval '0.2 seconds'where intent_id=$1",[c.intent.id])
  const before=await snapshot(f);await assert.rejects(()=>finish(f,c),/ediel_resume_claim_expired/);assert.deepEqual(await snapshot(f),before)
  await f.db.exec('reset role');assert.deepEqual((await f.db.query('select is_called,last_value::int from private.synthetic_finish_reached')).rows[0],{is_called:true,last_value:1})
 }finally{await f.db.close()}
})
