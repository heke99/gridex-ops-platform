import { beforeAll, afterAll, describe, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs'; import assert from 'node:assert/strict';
const db=new PGlite();
const sql=fs.readFileSync(new URL('../supabase/migrations/20261023232112_ediel_bounded_recovery_work.sql', import.meta.url),'utf8');
const uid=(n: number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const company=uid(1);
async function q(s: string,p: unknown[]=[]){return (await db.query<Record<string, unknown>>(s,p)).rows}
async function rpc(name: string,args: unknown[]){return (await q(`SELECT public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args))[0].result as { scanned: number; claimed: Array<{id: string;sourceMessageId: string;recovery: {workId: string;token: string}}> ; attempt: number }}


async function asService<T>(fn: () => Promise<T>){await db.exec('SET ROLE service_role');try{return await fn()}finally{await db.exec('RESET ROLE')}}
async function source(n: number,status='processed',env='production') {await q(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,status,processing_status,tenant_resolution_status,inbound_email_message_id,created_at,updated_at) VALUES($1,$2,$3,'inbound','edifact','UTILTS',$4,$4,'tenant_resolved',$1,now()-interval '2 hours',now()-interval '1 hour')`,[uid(n),company,env,status]);await q(`INSERT INTO inbound_email_messages VALUES($1,$2,$3,'processed','matched')`,[uid(n),company,env]);}
beforeAll(async()=>{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,status text,processing_status text,tenant_resolution_status text,inbound_email_message_id uuid,related_message_id uuid,sender_ediel_id text,receiver_ediel_id text,created_at timestamptz,updated_at timestamptz,UNIQUE(company_id,id));
CREATE TABLE ediel_ack_transaction_results(company_id uuid,environment text,source_message_id uuid,disposition text,final_response_type text,finalized_at timestamptz,response_message_id uuid,id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz NOT NULL DEFAULT now()-interval '1 hour',updated_at timestamptz NOT NULL DEFAULT now()-interval '1 hour');
CREATE TABLE inbound_email_messages(id uuid PRIMARY KEY,company_id uuid,environment text,processing_status text,match_status text);
CREATE TABLE ediel_message_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,ediel_message_id uuid,event_type text,message text,payload jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
CREATE TABLE ediel_outbox(id uuid PRIMARY KEY,company_id uuid,ediel_message_id uuid,environment text,status text,source_message_id uuid);
CREATE TABLE companies(id uuid PRIMARY KEY,status text,is_active boolean DEFAULT true);
CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,membership_role text);
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
CREATE TABLE permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text,is_active boolean DEFAULT true);
CREATE TABLE admin_users(user_id uuid,is_active boolean,role text);
CREATE TABLE roles(id uuid,key text,name text);
CREATE TABLE user_roles(user_id uuid,company_id uuid,role_id uuid,status text,is_active boolean,role text);
CREATE TABLE user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);
CREATE TABLE user_permission_overrides(user_id uuid,company_id uuid,is_active boolean,effect text,permission_key text,valid_from timestamptz,valid_to timestamptz);
CREATE TABLE fixture_effective_permissions(user_id uuid,company_id uuid,key text);
CREATE FUNCTION gridex_get_user_permissions_in_company(uuid,uuid) RETURNS text[] LANGUAGE sql AS $$SELECT coalesce(array_agg(key),'{}'::text[]) FROM fixture_effective_permissions WHERE user_id=$1 AND company_id=$2$$;`);
const canonical=fs.readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8');
const actor=canonical.match(/CREATE FUNCTION public\.gridex_actor_has_company_permission\([\s\S]*?\n\$\$;/g);assert.equal(actor?.length,1);await db.exec(actor![0]);
await db.exec(sql);

});
afterAll(async()=>{await db.close()});
describe.sequential("durable bounded recovery owner",()=>{
it('anonymous cannot invoke recovery owner', async()=>{await db.exec('SET ROLE anon');await assert.rejects(()=>rpc('ediel_recovery_discover_v1',['stranded','production']),/permission denied/);await db.exec('RESET ROLE')});
it('frozen discovery advances through 1000 duplicate notes to eligible source',async()=>{await source(2);await source(3);await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload,created_at) SELECT $1,$2,'manual_note','{"blockedBy":"canonical_inbound_ack_guard","ackFamily":"CONTRL"}',now()-interval '90 minutes'+g*interval '1 millisecond' FROM generate_series(1,1000)g`,[company,uid(2)]);await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload,created_at) VALUES($1,$2,'manual_note','{"blockedBy":"canonical_inbound_ack_guard","ackFamily":"CONTRL"}',now()-interval '80 minutes')`,[company,uid(3)]);for(let i=0;i<6;i++){const r=await asService(()=>rpc('ediel_recovery_discover_v1',['technical','production']));assert.ok(r.scanned<=200)}const rows=await q(`SELECT source_id FROM gridex_ediel_recovery.work WHERE kind='technical'`);assert.equal(rows.length,2);assert.ok(rows.some(r=>r.source_id===uid(3))) });
let claim: {id: string;sourceMessageId: string;recovery: {workId: string;token: string}};
it('lease and mandatory start atomically consume exactly one attempt',async()=>{const r=await asService(()=>rpc('ediel_recovery_lease_v1',['technical','production']));assert.equal(r.claimed.length,2);claim=r.claimed[0];assert.equal((await q(`SELECT attempts FROM gridex_ediel_recovery.work WHERE id=$1`,[claim.recovery.workId]))[0].attempts,0);const start=await asService(()=>rpc('ediel_recovery_transition_v1',[claim.recovery.workId,claim.recovery.token,'start']));assert.equal(start.attempt,1);await assert.rejects(()=>asService(()=>rpc('ediel_recovery_transition_v1',[claim.recovery.workId,claim.recovery.token,'start'])),/start_refused/);});
it('running expired source cannot be reclaimed or cross-kind leased',async()=>{await q(`UPDATE gridex_ediel_recovery.source_claims SET lease_until=now()-interval '1 hour' WHERE source_id=$1`,[claim.sourceMessageId]);await q(`UPDATE gridex_ediel_recovery.work SET lease_until=now()-interval '1 hour' WHERE id=$1`,[claim.recovery.workId]);const r=await asService(()=>rpc('ediel_recovery_lease_v1',['technical','production']));assert.equal(r.claimed.length,0);assert.equal((await q(`SELECT state,attempts FROM gridex_ediel_recovery.work WHERE id=$1`,[claim.recovery.workId]))[0].state,'running');await assert.rejects(()=>asService(()=>rpc('ediel_recovery_transition_v1',[claim.recovery.workId,claim.recovery.token,'release'])),/started_release_refused/);});
it('uncertain transition retains source reservation',async()=>{await asService(()=>rpc('ediel_recovery_transition_v1',[claim.recovery.workId,claim.recovery.token,'uncertain','deadline']));assert.equal((await q(`SELECT count(*) n FROM gridex_ediel_recovery.source_claims WHERE source_id=$1`,[claim.sourceMessageId]))[0].n,1);});
it('missing terminal owner receipt keeps uncertain reservation and attempt',async()=>{await assert.rejects(()=>asService(()=>rpc('ediel_recovery_transition_v1',[claim.recovery.workId,claim.recovery.token,'finish','failed'])),/terminal_receipt_required/);const w=(await q(`SELECT attempts,state FROM gridex_ediel_recovery.work WHERE id=$1`,[claim.recovery.workId]))[0];assert.deepEqual(w,{attempts:1,state:'uncertain'});});
it('bounded lease inspection rotates beyond 200 ineligible oldest rows',async()=>{await q(`DELETE FROM gridex_ediel_recovery.source_claims`);await q(`DELETE FROM gridex_ediel_recovery.work`);await q(`DELETE FROM gridex_ediel_recovery.lease_cursors`);for(let i=100;i<301;i++)await source(i,i===300?'received':'processed');await q(`INSERT INTO gridex_ediel_recovery.work(kind,company_id,environment,source_id,target_id,max_attempts,created_at) SELECT 'stranded',company_id,environment,id,id,3,created_at+(substring(id::text from 25)::bigint)*interval '1 millisecond' FROM ediel_messages WHERE substring(id::text from 25)::bigint BETWEEN 100 AND 300`);const a=await asService(()=>rpc('ediel_recovery_lease_v1',['stranded','production']));assert.equal(a.scanned,200);assert.equal(a.claimed.length,0);const b=await asService(()=>rpc('ediel_recovery_lease_v1',['stranded','production']));assert.equal(b.scanned,1);assert.equal(b.claimed[0].id,uid(300));});
it('expired never-started token becomes stale after safe reclaim',async()=>{const w=(await q(`SELECT * FROM gridex_ediel_recovery.work WHERE source_id=$1`,[uid(300)]))[0];await q(`UPDATE gridex_ediel_recovery.source_claims SET lease_until=now()-interval '1 hour' WHERE source_id=$1`,[uid(300)]);await q(`UPDATE gridex_ediel_recovery.work SET lease_until=now()-interval '1 hour' WHERE id=$1`,[w.id]);await asService(()=>rpc('ediel_recovery_lease_v1',['stranded','production']));await assert.rejects(()=>asService(()=>rpc('ediel_recovery_transition_v1',[w.id,w.claim_token,'start'])),/stale_token/);assert.equal((await q(`SELECT attempts FROM gridex_ediel_recovery.work WHERE id=$1`,[w.id]))[0].attempts,0)});

it('all four F112 queued/foreign-lane and queue-failed/pre-F112 prefixes advance within 200 raw rows',async()=>{
 await db.exec(`DELETE FROM gridex_ediel_recovery.source_claims;DELETE FROM gridex_ediel_recovery.work;DELETE FROM gridex_ediel_recovery.cursors;DELETE FROM gridex_ediel_recovery.lease_cursors`);
 for(let j=0;j<4;j++){
  const prefix=500+j*10,eligible=prefix+2,pre=j>=2,foreign=j%2===1;await source(prefix,'processed',foreign?'test':'production');await source(eligible);
  for(const n of [prefix,eligible])await q(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,status,processing_status,related_message_id,created_at,updated_at) VALUES($1,$2,$3,'outbound','edifact','APERAK','draft','created',$4,now()-interval '2 hours',now()-interval '1 hour')`,[uid(n+1),company,n===prefix&&foreign?'test':'production',uid(n)]);
  if(!foreign)await q(`INSERT INTO ediel_outbox(id,company_id,ediel_message_id,environment,status) VALUES($1,$2,$3,'production','delivery_uncertain')`,[uid(prefix),company,uid(prefix+1)]);
  const payload=(n: number)=>JSON.stringify({ackMessageId:uid(n+1),...(pre?{}:{replyDispatch:'operational_outbox',outboxQueued:false}),outcome:'positive'});
  await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,message,payload,created_at) SELECT $1,$2,'aperak_sent','APERAK hanterad via canonical kernel.',$3::jsonb,now()-interval '100 minutes'+$4*interval '10 minutes'+g*interval '1 millisecond' FROM generate_series(1,1001)g`,[company,uid(prefix),payload(prefix),j]);
  await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,message,payload,created_at) VALUES($1,$2,'aperak_sent','APERAK hanterad via canonical kernel.',$3::jsonb,now()-interval '100 minutes'+$4*interval '10 minutes'+interval '2 seconds')`,[company,uid(eligible),payload(eligible),j]);
 }
 for(let k=0;k<21;k++){const r=await asService(()=>rpc('ediel_recovery_discover_v1',['runtime','production']));assert.ok(r.scanned<=200)}
 const rows=await q(`SELECT target_id FROM gridex_ediel_recovery.work WHERE kind='runtime' ORDER BY target_id`);assert.equal(rows.length,4);assert.deepEqual(rows.map(x=>x.target_id),[503,513,523,533].map(uid));
 const r=await asService(()=>rpc('ediel_recovery_lease_v1',['runtime','production']));assert.equal(r.claimed.length,4);assert.equal((await q(`SELECT count(*) n FROM ediel_outbox WHERE status='delivery_uncertain'`))[0].n,2);
});
it('legacy own and tenantless attempts import at cap, foreign attempts do not reset or inflate ownership',async()=>{
 await source(600);await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload,created_at) VALUES($1,$2,'manual_note','{"blockedBy":"canonical_inbound_ack_guard","ackFamily":"CONTRL"}',now()-interval '1 hour')`,[company,uid(600)]);
 for(const c of [company,null,company])await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload) VALUES($1,$2,'manual_note','{"resume":"missed_technical_ack","kind":"attempt"}')`,[c,uid(600)]);
 await db.exec(`DELETE FROM gridex_ediel_recovery.cursors WHERE kind='technical'`);
 for(let i=0;i<6;i++)await asService(()=>rpc('ediel_recovery_discover_v1',['technical','production']));
 const w=(await q(`SELECT state,attempts FROM gridex_ediel_recovery.work WHERE kind='technical' AND source_id=$1`,[uid(600)]))[0];assert.deepEqual(w,{state:'exhausted',attempts:3});
});
it('poison UUID note cannot pin durable runtime cursor',async()=>{
 await source(610);await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,message,payload,created_at) VALUES($1,$2,'aperak_sent','APERAK hanterad via canonical kernel.','{"ackMessageId":"------------------------------------","replyDispatch":"operational_outbox","outboxQueued":false}',now()-interval '30 minutes')`,[company,uid(610)]);
 await db.exec(`DELETE FROM gridex_ediel_recovery.cursors WHERE kind='runtime'`);for(let i=0;i<21;i++)await asService(()=>rpc('ediel_recovery_discover_v1',['runtime','production']));
 assert.equal((await q(`SELECT count(*) n FROM gridex_ediel_recovery.work WHERE source_id=$1`,[uid(610)]))[0].n,0);
});

it('explicit NULL discovery budget refuses before scanning and never advances cursor',async()=>{
 const before=await q(`SELECT * FROM gridex_ediel_recovery.cursors ORDER BY kind,environment,scope`);
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_discover_v1',['runtime','production',null,null])),/input_invalid/);
 assert.deepEqual(await q(`SELECT * FROM gridex_ediel_recovery.cursors ORDER BY kind,environment,scope`),before);
});
it('terminal evidence and exact tenant/token guard reconciliation, with audited receipt-backed completion',async()=>{
 await source(700,'received');await q(`INSERT INTO gridex_ediel_recovery.work(id,kind,company_id,environment,source_id,target_id,max_attempts,attempts,state,claim_token,lease_until) VALUES($1,'stranded',$2,'production',$3,$3,3,1,'uncertain',$4,now()-interval '1 hour')`,[uid(1700),company,uid(700),uid(2700)]);
 await q(`INSERT INTO gridex_ediel_recovery.source_claims VALUES($1,'production',$2,$3,now()-interval '1 hour')`,[company,uid(700),uid(2700)]);
 await q(`INSERT INTO companies(id,status) VALUES($1,'active') ON CONFLICT DO NOTHING`,[company]);await q(`INSERT INTO company_memberships VALUES($1,$2,'active',true,'operations')`,[company,uid(50)]);
 const command=[uid(1700),uid(2700),company,'uncertain',uid(50),'Qualify the correlated owner completion receipt'];
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_reconcile_v1',command)),/actor_denied/);
 await q(`INSERT INTO auth.users(id) VALUES($1)`,[uid(50)]);await q(`INSERT INTO permissions(key) VALUES('communication.write')`);await q(`INSERT INTO fixture_effective_permissions VALUES($1,$2,'communication.write')`,[uid(50),company]);
 // Exercise the actual canonical actor predicate, including target-company
 // explicit denies and lifecycle gates; the effective-permissions resolver is
 // a fixture input, not a replacement implementation in production.
 await q(`INSERT INTO user_permission_overrides(user_id,company_id,is_active,effect,permission_key) VALUES($1,$2,true,'deny','communication.write')`,[uid(50),company]);
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_reconcile_v1',command)),/actor_denied/);
 await q(`DELETE FROM user_permission_overrides WHERE user_id=$1`,[uid(50)]);
 await q(`UPDATE companies SET is_active=false WHERE id=$1`,[company]);
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_reconcile_v1',command)),/actor_denied/);
 await q(`UPDATE companies SET is_active=true WHERE id=$1`,[company]);
 await q(`UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=$1`,[uid(50)]);
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_reconcile_v1',command)),/actor_denied/);
 await q(`UPDATE auth.users SET banned_until=NULL WHERE id=$1`,[uid(50)]);
 const held=await asService(()=>rpc('ediel_recovery_reconcile_v1',command));assert.equal((held as unknown as {state:string}).state,'uncertain');
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_record_terminal_v1',[uid(1700),uid(2700),uid(2),'uncertain','completed'])),/terminal_stale/);
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_record_terminal_v1',[uid(1700),uid(2700),company,'uncertain','completed'])),/evidence_missing/);
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_record_terminal_v1',[uid(1700),uid(2700),company,'uncertain','no_effect'])),/evidence_missing/);
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_record_terminal_v1',[uid(1700),uid(2700),company,'uncertain','failed'])),/input_invalid/);
 await q(`UPDATE ediel_messages SET status='processed',processing_status='processed' WHERE id=$1`,[uid(700)]);
 await asService(()=>rpc('ediel_recovery_record_terminal_v1',[uid(1700),uid(2700),company,'uncertain','completed']));
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_reconcile_v1',[uid(1700),uid(2701),company,'uncertain',uid(50),'Qualify the correlated owner completion receipt'])),/reconcile_stale/);
 const done=await asService(()=>rpc('ediel_recovery_reconcile_v1',command));assert.equal((done as unknown as {state:string}).state,'done');
 assert.equal((await q(`SELECT attempts FROM gridex_ediel_recovery.work WHERE id=$1`,[uid(1700)]))[0].attempts,1);
 assert.equal((await q(`SELECT count(*) n FROM gridex_ediel_recovery.reconcile_audit WHERE work_id=$1`,[uid(1700)]))[0].n,1);
 assert.equal((await q(`SELECT count(*) n FROM gridex_ediel_recovery.source_claims WHERE source_id=$1`,[uid(700)]))[0].n,0);
});
it('source deletion cascades recovery work receipts and audits without blocking existing cleanup',async()=>{
 await q(`DELETE FROM ediel_messages WHERE id=$1`,[uid(700)]);
 for(const table of ['work','terminal_receipts','reconcile_audit'])assert.equal((await q(`SELECT count(*) n FROM gridex_ediel_recovery.${table} WHERE ${table==='work'?'id':'work_id'}=$1`,[uid(1700)]))[0].n,0);
});
it('expired A cleanup is scoped to its source even when B shares the batch token',async()=>{
 for(const n of [800,801]){await source(n);await q(`INSERT INTO gridex_ediel_recovery.work(id,kind,company_id,environment,source_id,target_id,max_attempts,state,claim_token,lease_until) VALUES($1,'runtime',$2,'production',$3,$3,3,'leased',$4,now()+interval '1 hour')`,[uid(n+1000),company,uid(n),uid(2800)]);await q(`INSERT INTO gridex_ediel_recovery.source_claims VALUES($1,'production',$2,$3,now()+$4*interval '1 hour')`,[company,uid(n),uid(2800),n===800?-1:1]);}
 await db.exec(`DELETE FROM gridex_ediel_recovery.lease_cursors WHERE kind='stranded'`);await asService(()=>rpc('ediel_recovery_lease_v1',['stranded','production']));
 assert.deepEqual((await q(`SELECT state,claim_token FROM gridex_ediel_recovery.work WHERE id=$1`,[uid(1800)]))[0],{state:'ready',claim_token:null});
 assert.equal((await q(`SELECT count(*) n FROM gridex_ediel_recovery.source_claims WHERE source_id=$1`,[uid(800)]))[0].n,0);
 assert.equal((await q(`SELECT count(*) n FROM gridex_ediel_recovery.source_claims WHERE source_id=$1 AND token=$2`,[uid(801),uid(2800)]))[0].n,1);
});
it('reclaim has an exact environment/source cursor index',async()=>{
 const definition=(await q(`SELECT indexdef FROM pg_indexes WHERE schemaname='gridex_ediel_recovery' AND indexname='ediel_recovery_claim_cursor_idx'`))[0].indexdef;assert.match(String(definition),/\(environment, source_id\)/);
});

it('SQL rejects a target cap above fifty before any lease',async()=>{
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_lease_v1',['runtime','production',null,[],1,51])),/input_invalid/);
});
it('tenant-scoped work scan advances beyond two hundred foreign-company ready rows',async()=>{
 await db.exec(`DELETE FROM gridex_ediel_recovery.source_claims;DELETE FROM gridex_ediel_recovery.work;DELETE FROM gridex_ediel_recovery.lease_cursors`);
 await q(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,status,processing_status,created_at,updated_at)
 SELECT ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,$1,'production','inbound','edifact','UTILTS','processed','processed',now()-interval '2 hours'+g*interval '1 millisecond',now()-interval '1 hour' FROM generate_series(2000,2199)g`,[uid(2)]);
 await q(`INSERT INTO gridex_ediel_recovery.work(kind,company_id,environment,source_id,target_id,max_attempts,created_at)
 SELECT 'technical',company_id,environment,id,id,3,created_at FROM ediel_messages WHERE company_id=$1`,[uid(2)]);
 await source(2200);await q(`INSERT INTO gridex_ediel_recovery.work(kind,company_id,environment,source_id,target_id,max_attempts,created_at) VALUES('technical',$1,'production',$2,$2,3,now()-interval '1 hour')`,[company,uid(2200)]);
 const one=await asService(()=>rpc('ediel_recovery_lease_v1',['technical','production',company]));assert.equal(one.scanned,200);assert.equal(one.claimed.length,0);
 const two=await asService(()=>rpc('ediel_recovery_lease_v1',['technical','production',company]));assert.equal(two.scanned,1);assert.equal(two.claimed.length,1);assert.equal(two.claimed[0].sourceMessageId,uid(2200));
});
it('legacy own/null attempts use tenant index seeks beyond ten thousand foreign attempts',async()=>{
 await source(900);const marker='missed_technical_ack';
 await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload) SELECT $1,$2,'manual_note',jsonb_build_object('resume',$3::text,'kind','attempt') FROM generate_series(1,10000)`,[uid(2),uid(900),marker]);
 for(const tenant of [company,null])await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload) VALUES($1,$2,'manual_note',jsonb_build_object('resume',$3::text,'kind','attempt'))`,[tenant,uid(900),marker]);
 await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload,created_at) VALUES($1,$2,'manual_note','{"blockedBy":"canonical_inbound_ack_guard","ackFamily":"CONTRL"}',now()-interval '1 hour')`,[company,uid(900)]);
 await db.exec(`DELETE FROM gridex_ediel_recovery.cursors WHERE kind='technical'`);for(let i=0;i<6;i++)await asService(()=>rpc('ediel_recovery_discover_v1',['technical','production']));
 assert.deepEqual((await q(`SELECT state,attempts FROM gridex_ediel_recovery.work WHERE kind='technical' AND source_id=$1`,[uid(900)]))[0],{state:'ready',attempts:2});
 await db.exec(`ANALYZE ediel_message_events;SET plan_cache_mode='force_generic_plan'`);
 // Plan the actual query extracted from the actual helper body, with its
 // local values parameterized. Do not replace it with a parallel model query.
 const owner=sql.match(/CREATE FUNCTION gridex_ediel_recovery\.put_v1\([\s\S]*?END \$\$;/g);assert.equal(owner?.length,1);
 const query=owner![0].match(/SELECT count\(\*\) INTO n FROM\([\s\S]*?\) attempts;/g);assert.equal(query?.length,1);
 const prepared=query![0].replace(' INTO n','').replace(/\bp_target_id\b/g,'$1').replace(/s\.company_id/g,'$2').replace(/\bmarker\b/g,'$3').replace(/\bp_max_attempts\b/g,'$4');
 await db.exec(`PREPARE bounded_attempts(uuid,uuid,text,integer) AS ${prepared}`);
 const plan=(await q(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE bounded_attempts('${uid(900)}','${company}','${marker}',3)`))[0]['QUERY PLAN'];
 const nodes: Array<Record<string,unknown>>=[];function walk(value:unknown){if(Array.isArray(value))value.forEach(walk);else if(value && typeof value==='object'){const row=value as Record<string,unknown>;if(row['Node Type'])nodes.push(row);Object.values(row).forEach(walk)}}walk(plan);
 const scans=nodes.filter(n=>n['Relation Name']==='ediel_message_events');assert.equal(scans.length,2);
 for(const scan of scans){assert.match(String(scan['Node Type']),/^Index/);assert.match(String(scan['Index Cond']),/company_id/);assert.ok(Number(scan['Actual Rows'])<=3);assert.equal(scan['Rows Removed by Filter']??0,0)}
});

it('held legacy own and tenantless notes preserve the twenty-attempt cap and ignore foreign notes',async()=>{
 await source(1900);await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,final_response_type,finalized_at,response_message_id) VALUES($1,'production',$2,'internal_review',NULL,NULL,NULL)`,[company,uid(1900)]);
 await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload) SELECT CASE WHEN g<=10 THEN $1::uuid ELSE NULL END,$2,'manual_note','{"resume":"held_utilts_resume","kind":"attempt"}' FROM generate_series(1,20)g`,[company,uid(1900)]);
 await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload) SELECT $1,$2,'manual_note','{"resume":"held_utilts_resume","kind":"attempt"}' FROM generate_series(1,100)g`,[uid(999),uid(1900)]);
 await q(`SELECT gridex_ediel_recovery.put_v1('held','production',$1,$1,'{}',20)`,[uid(1900)]);
 assert.deepEqual((await q(`SELECT attempts,max_attempts,state FROM gridex_ediel_recovery.work WHERE source_id=$1`,[uid(1900)]))[0],{attempts:20,max_attempts:20,state:'exhausted'});
 await source(1901);await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,final_response_type,finalized_at,response_message_id) VALUES($1,'production',$2,'internal_review',NULL,NULL,NULL)`,[company,uid(1901)]);
 await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload) VALUES($1,$2,'manual_note','{"resume":"held_utilts_resume","kind":"attempt"}')`,[uid(999),uid(1901)]);
 await q(`SELECT gridex_ediel_recovery.put_v1('held','production',$1,$1,'{}',6)`,[uid(1901)]);assert.equal((await q(`SELECT attempts FROM gridex_ediel_recovery.work WHERE source_id=$1`,[uid(1901)]))[0].attempts,0);
});
it('held completion requires actual correlated terminal source evidence, not a started note or foreign result',async()=>{
 const leased=await asService(()=>rpc('ediel_recovery_lease_v1',['held','production']));const t=leased.claimed.find(x=>x.sourceMessageId===uid(1901))!;assert.ok(t);
 await asService(()=>rpc('ediel_recovery_transition_v1',[t.recovery.workId,t.recovery.token,'start']));
 const receipt=[t.recovery.workId,t.recovery.token,company,'running','completed'];
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_record_terminal_v1',receipt)),/evidence_missing/);
 const note={resume:'held_utilts_resume',kind:'result',outcome:'processed',attempt:1,recoveryToken:t.recovery.token};
 await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload) VALUES($1,$2,'manual_note',$3)`,[uid(999),uid(1901),JSON.stringify(note)]);
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_record_terminal_v1',receipt)),/evidence_missing/);
 for(const patch of [{kind:'attempt'},{recoveryToken:uid(999)},{attempt:2},{outcome:'already_processing_or_done'}])await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload) VALUES($1,$2,'manual_note',$3)`,[company,uid(1901),JSON.stringify({...note,...patch})]);
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_record_terminal_v1',receipt)),/evidence_missing/);
 await asService(()=>rpc('ediel_recovery_transition_v1',[t.recovery.workId,t.recovery.token,'uncertain','backend request outcome unknown']));
 await q(`UPDATE gridex_ediel_recovery.source_claims SET lease_until=now()-interval '1 hour' WHERE source_id=$1`,[uid(1901)]);
 await q(`UPDATE gridex_ediel_recovery.work SET lease_until=now()-interval '1 hour' WHERE id=$1`,[t.recovery.workId]);
 const again=await asService(()=>rpc('ediel_recovery_lease_v1',['held','production']));assert.equal(again.claimed.length,0);
 assert.deepEqual((await q(`SELECT state,attempts FROM gridex_ediel_recovery.work WHERE id=$1`,[t.recovery.workId]))[0],{state:'uncertain',attempts:1});
 await q(`INSERT INTO ediel_message_events(company_id,ediel_message_id,event_type,payload) VALUES($1,$2,'manual_note',$3)`,[company,uid(1901),JSON.stringify(note)]);
 await asService(()=>rpc('ediel_recovery_record_terminal_v1',[t.recovery.workId,t.recovery.token,company,'uncertain','completed']));
 assert.equal((await q(`SELECT count(*) n FROM gridex_ediel_recovery.terminal_receipts WHERE work_id=$1`,[t.recovery.workId]))[0].n,1);
});

it('held lookback follows a recent ledger entry even when retained source predates the window',async()=>{
 await source(2900);await q(`UPDATE ediel_messages SET created_at=now()-interval '60 days' WHERE id=$1`,[uid(2900)]);
 await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,created_at,updated_at) VALUES($1,'production',$2,'internal_review',now()-interval '1 day',now()-interval '1 day')`,[company,uid(2900)]);
 assert.equal((await q(`SELECT count(*) n FROM ediel_ack_transaction_results WHERE source_message_id=$1 AND environment='production' AND disposition='internal_review' AND updated_at<now()-interval '5 minutes' AND created_at>now()-interval '45 days'`,[uid(2900)]))[0].n,1);
 await db.exec(`DELETE FROM gridex_ediel_recovery.cursors WHERE kind='held'`);
 for(let i=0;i<3;i++){const page=await asService(()=>rpc('ediel_recovery_discover_v1',['held','production',company,200,300,1080,6]));assert.ok(page.scanned<=200)}
 assert.equal((await q(`SELECT count(*) n FROM gridex_ediel_recovery.work WHERE kind='held' AND source_id=$1`,[uid(2900)]))[0].n,1);
 const lease=await asService(()=>rpc('ediel_recovery_lease_v1',['held','production',company]));assert.ok(lease.claimed.some(t=>t.sourceMessageId===uid(2900)));
});
it('held raw ledger cursor crosses duplicate and foreign prefixes within indexed pages and deduplicates source work',async()=>{
 await source(2910);await source(2911);await source(2912);await q(`UPDATE ediel_messages SET company_id=$1,created_at=now()-interval '90 days' WHERE id=$2`,[uid(999),uid(2910)]);await q(`UPDATE ediel_messages SET created_at=now()-interval '90 days' WHERE id IN($1,$2)`,[uid(2911),uid(2912)]);
 // Equal timestamps exercise the stable ledger id tie-breaker. Neither lane
 // nor tenant filtering may make a 200-row query walk an unbounded prefix.
 await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,created_at,updated_at) SELECT $1,'production',$2,'internal_review',now()-interval '2 days',now()-interval '2 days' FROM generate_series(1,10000)`,[uid(999),uid(2910)]);
 await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,created_at,updated_at) SELECT $1,'production',$2,'internal_review',now()-interval '1 day',now()-interval '1 day' FROM generate_series(1,1001)`,[company,uid(2911)]);
 await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,created_at,updated_at) VALUES($1,'production',$2,'internal_review',now()-interval '12 hours',now()-interval '12 hours')`,[company,uid(2912)]);
 await db.exec(`DELETE FROM gridex_ediel_recovery.cursors WHERE kind='held'`);
 for(let i=0;i<56;i++){const page=await asService(()=>rpc('ediel_recovery_discover_v1',['held','production',company,200,300,1080,6]));assert.ok(page.scanned<=200)}
 const work=await q(`SELECT source_id,count(*) n FROM gridex_ediel_recovery.work WHERE kind='held' AND source_id IN($1,$2,$3) GROUP BY source_id ORDER BY source_id`,[uid(2910),uid(2911),uid(2912)]);assert.deepEqual(work,[{source_id:uid(2911),n:1},{source_id:uid(2912),n:1}]);
 const query=sql.match(/SELECT x\.id,x\.created_at,x\.company_id,x\.source_message_id ediel_message_id[\s\S]*?ORDER BY x\.created_at,x\.id LIMIT p_page/)?.[0];assert.ok(query);
 await db.exec(`ANALYZE ediel_ack_transaction_results;SET plan_cache_mode=force_generic_plan;SET enable_seqscan=off`);
 const prepared=query.replaceAll('c.position_at','$1').replaceAll('c.position_id','$2').replaceAll('c.high_at','$3').replaceAll('c.high_id','$4').replace('p_page','$5');
 await db.exec(`PREPARE held_cursor_plan(timestamptz,uuid,timestamptz,uuid,integer) AS ${prepared}`);
 const plan=(await q(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE held_cursor_plan(now()-interval '45 days','00000000-0000-0000-0000-000000000000',now()-interval '5 minutes','ffffffff-ffff-ffff-ffff-ffffffffffff',200)`))[0]['QUERY PLAN'] as Array<{Plan:Record<string,unknown>}>;
 const nodes:Record<string,unknown>[]=[];const walk=(n:Record<string,unknown>)=>{nodes.push(n);for(const c of (n.Plans??[])as Record<string,unknown>[])walk(c)};walk(plan[0].Plan);
 const scan=nodes.find(n=>n['Index Name']==='ediel_recovery_held_cursor_idx');assert.ok(scan);assert.ok(Number(scan['Actual Rows'])<=200);assert.equal(scan['Rows Removed by Filter']??0,0);assert.match(String(scan['Index Cond']),/created_at/);
 await db.exec(`DEALLOCATE held_cursor_plan;RESET plan_cache_mode;RESET enable_seqscan`);
});
it('held ledger foreign scope and fresh holds advance the cursor without creating eligible work',async()=>{
 for(const n of [2920,2921,2922])await source(n);
 await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,created_at,updated_at) VALUES($1,'production',$2,'internal_review',now()-interval '1 hour',now()-interval '1 hour'),($3,'test',$4,'internal_review',now()-interval '1 hour',now()-interval '1 hour'),($3,'production',$5,'internal_review',now()-interval '1 hour',now())`,[uid(999),uid(2920),company,uid(2921),uid(2922)]);
 await db.exec(`DELETE FROM gridex_ediel_recovery.cursors WHERE kind='held'`);
 for(let i=0;i<57;i++)await asService(()=>rpc('ediel_recovery_discover_v1',['held','production',company,200,300,1080,6]));
 assert.equal((await q(`SELECT count(*) n FROM gridex_ediel_recovery.work WHERE kind='held' AND source_id IN($1,$2,$3)`,[uid(2920),uid(2921),uid(2922)]))[0].n,0);
});

it('held START rechecks current ledger grace and refuses a newly refreshed hold without consuming an attempt',async()=>{
 await source(2930);await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,created_at,updated_at) VALUES($1,'production',$2,'internal_review',now()-interval '1 day',now()-interval '1 day')`,[company,uid(2930)]);
 await q(`SELECT gridex_ediel_recovery.put_v1('held','production',$1,$1,'{}',6)`,[uid(2930)]);
 await db.exec(`DELETE FROM gridex_ediel_recovery.lease_cursors WHERE kind='held'`);
 const lease=await asService(()=>rpc('ediel_recovery_lease_v1',['held','production',company]));const t=lease.claimed.find(t=>t.sourceMessageId===uid(2930))!;assert.ok(t);
 await q(`UPDATE ediel_ack_transaction_results SET updated_at=now() WHERE source_message_id=$1`,[uid(2930)]);
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_transition_v1',[t.recovery.workId,t.recovery.token,'start'])),/start_refused/);
 assert.deepEqual((await q(`SELECT attempts,state FROM gridex_ediel_recovery.work WHERE id=$1`,[t.recovery.workId]))[0],{attempts:0,state:'leased'});
});

it('mixed held rows refreshed after selection refuse START without consuming any attempt',async()=>{
 await source(2940);
 await q(`INSERT INTO ediel_ack_transaction_results(id,company_id,environment,source_message_id,disposition,created_at,updated_at) VALUES($1,$3,'production',$4,'internal_review',now()-interval '1 day',now()-interval '1 day'),($2,$3,'production',$4,'internal_review',now()-interval '1 day',now()-interval '1 day')`,[uid(12940),uid(22940),company,uid(2940)]);
 await q(`SELECT gridex_ediel_recovery.put_v1('held','production',$1,$1,'{}',6)`,[uid(2940)]);
 await db.exec(`DELETE FROM gridex_ediel_recovery.lease_cursors WHERE kind='held'`);
 const lease=await asService(()=>rpc('ediel_recovery_lease_v1',['held','production',company]));const t=lease.claimed.find(t=>t.sourceMessageId===uid(2940))!;assert.ok(t);
 // Both rows passed the all-row JS selection guard. Only one becomes fresh
 // before START: the unchanged old row must not authorize the whole source.
 assert.equal((await q(`SELECT count(*) n FROM ediel_ack_transaction_results WHERE source_message_id=$1 AND updated_at>=now()-interval '5 minutes'`,[uid(2940)]))[0].n,0);
 await q(`UPDATE ediel_ack_transaction_results SET updated_at=clock_timestamp() WHERE id=$1`,[uid(22940)]);
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_transition_v1',[t.recovery.workId,t.recovery.token,'start'])),/start_refused/);
 assert.deepEqual((await q(`SELECT attempts,state FROM gridex_ediel_recovery.work WHERE id=$1`,[t.recovery.workId]))[0],{attempts:0,state:'leased'});
 await asService(()=>rpc('ediel_recovery_transition_v1',[t.recovery.workId,t.recovery.token,'release']));
});
it('held all-old START remains eligible and ignores fresh finalized foreign-tenant and foreign-lane rows',async()=>{
 await source(2941);
 await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,created_at,updated_at,final_response_type) VALUES($1,'production',$3,'internal_review',now()-interval '1 day',now()-interval '1 day',NULL),($1,'production',$3,'internal_review',now()-interval '1 day',now()-interval '1 day',NULL),($2,'production',$3,'internal_review',now()-interval '1 day',now(),NULL),($1,'test',$3,'internal_review',now()-interval '1 day',now(),NULL),($1,'production',$3,'internal_review',now()-interval '1 day',now(),'APERAK'),($1,'production',$3,'accepted',now()-interval '1 day',now(),NULL)`,[company,uid(999),uid(2941)]);
 await q(`SELECT gridex_ediel_recovery.put_v1('held','production',$1,$1,'{}',6)`,[uid(2941)]);
 await db.exec(`DELETE FROM gridex_ediel_recovery.lease_cursors WHERE kind='held'`);
 const lease=await asService(()=>rpc('ediel_recovery_lease_v1',['held','production',company]));const t=lease.claimed.find(t=>t.sourceMessageId===uid(2941))!;assert.ok(t);
 await asService(()=>rpc('ediel_recovery_transition_v1',[t.recovery.workId,t.recovery.token,'start']));
 assert.deepEqual((await q(`SELECT attempts,state FROM gridex_ediel_recovery.work WHERE id=$1`,[t.recovery.workId]))[0],{attempts:1,state:'running'});
});
it('fresh-held exclusion seeks beyond ten thousand old rows with source tenant lane and grace index bounds',async()=>{
 await source(2942);
 await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,created_at,updated_at) SELECT $1,'production',$2,'internal_review',now()-interval '1 day',now()-interval '1 day' FROM generate_series(1,10000)`,[company,uid(2942)]);
 await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,created_at,updated_at) VALUES($1,'production',$2,'internal_review',now()-interval '1 day',now())`,[company,uid(2942)]);
 const query=sql.match(/SELECT FROM public\.ediel_ack_transaction_results h WHERE h\.company_id=w\.company_id AND h\.environment=w\.environment AND h\.source_message_id=w\.source_id AND h\.updated_at>=statement_timestamp\(\)-make_interval\(secs=>grace_seconds\) AND h\.disposition='internal_review' AND h\.final_response_type IS NULL AND h\.finalized_at IS NULL AND h\.response_message_id IS NULL/)?.[0];assert.ok(query);
 const prepared=query.replace('SELECT FROM','SELECT 1 FROM').replaceAll('w.company_id','$1').replaceAll('w.environment','$2').replaceAll('w.source_id','$3').replace('grace_seconds','$4');
 await db.exec(`ANALYZE ediel_ack_transaction_results;SET plan_cache_mode=force_generic_plan;SET enable_seqscan=off`);
 await db.exec(`PREPARE fresh_hold_plan(uuid,text,uuid,integer) AS ${prepared}`);
 const plan=(await q(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE fresh_hold_plan('${company}','production','${uid(2942)}',300)`))[0]['QUERY PLAN'] as Array<{Plan:Record<string,unknown>}>;
 const nodes:Record<string,unknown>[]=[];const walk=(n:Record<string,unknown>)=>{nodes.push(n);for(const c of (n.Plans??[])as Record<string,unknown>[])walk(c)};walk(plan[0].Plan);
 const scan=nodes.find(n=>n['Index Name']==='ediel_recovery_held_source_idx');assert.ok(scan);assert.equal(scan['Actual Rows'],1);assert.equal(scan['Rows Removed by Filter']??0,0);assert.match(String(scan['Index Cond']),/company_id/);assert.match(String(scan['Index Cond']),/environment/);assert.match(String(scan['Index Cond']),/source_message_id/);assert.match(String(scan['Index Cond']),/updated_at/);
 await db.exec(`DEALLOCATE fresh_hold_plan;RESET plan_cache_mode;RESET enable_seqscan`);
});

it('a fresh held row inserted after selection refuses START without consuming an attempt',async()=>{
 await source(2943);
 await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,created_at,updated_at) VALUES($1,'production',$2,'internal_review',now()-interval '1 day',now()-interval '1 day')`,[company,uid(2943)]);
 await q(`SELECT gridex_ediel_recovery.put_v1('held','production',$1,$1,'{}',6)`,[uid(2943)]);
 await db.exec(`DELETE FROM gridex_ediel_recovery.lease_cursors WHERE kind='held'`);
 const lease=await asService(()=>rpc('ediel_recovery_lease_v1',['held','production',company]));const t=lease.claimed.find(t=>t.sourceMessageId===uid(2943))!;assert.ok(t);
 await q(`INSERT INTO ediel_ack_transaction_results(company_id,environment,source_message_id,disposition,created_at,updated_at) VALUES($1,'production',$2,'internal_review',now(),clock_timestamp())`,[company,uid(2943)]);
 await assert.rejects(()=>asService(()=>rpc('ediel_recovery_transition_v1',[t.recovery.workId,t.recovery.token,'start'])),/start_refused/);
 assert.deepEqual((await q(`SELECT attempts,state FROM gridex_ediel_recovery.work WHERE id=$1`,[t.recovery.workId]))[0],{attempts:0,state:'leased'});
 await asService(()=>rpc('ediel_recovery_transition_v1',[t.recovery.workId,t.recovery.token,'release']));
});

});
