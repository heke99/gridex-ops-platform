// masterplan: SC-037
// SC-037 (P-11): gridex_transition_supplier_switch_v2 applies the switch
// transition only when the row-locked status is in p_expected_statuses.
// Extends the existing normal-switch PGlite harness through marker insertion;
// the base script is unchanged. Loads the migration's v2 and the latest
// schema.sql gridex_assert_switch_writer_v1 (auth.role() and
// gridex_can_write_company are declared ports).
// Focused embedded PostgreSQL mechanics, not native replay or market evidence.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = readFileSync(new URL('./ediel-normal-switch-source-sql-regression.mjs', import.meta.url), 'utf8')
const marker = ' console.log(`PASS ${checks} focused normal switch'
assert.equal(base.split(marker).length, 2, 'normal-switch harness insertion seam must be unique')

const extension = String.raw`
 let v2=0
 const migration=readFileSync(new URL('../supabase/migrations/20261011124500_ediel_supplier_switch_transition_expected_status.sql',import.meta.url),'utf8')
 await db.exec("CREATE SCHEMA IF NOT EXISTS auth;"+
  "CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','') $f$;"+
  "CREATE OR REPLACE FUNCTION public.gridex_can_write_company(uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT coalesce(current_setting('request.jwt.claims',true)::jsonb->>'company',NULL)=$1::text $f$;"+
  "ALTER TABLE supplier_switch_requests ADD COLUMN IF NOT EXISTS failure_reason text,ADD COLUMN IF NOT EXISTS failed_at timestamptz,ADD COLUMN IF NOT EXISTS external_reference text;"+
  "CREATE TABLE IF NOT EXISTS supplier_switch_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,switch_request_id uuid,event_type text,event_status text,message text,payload jsonb,created_by uuid,created_at timestamptz DEFAULT now());")
 await db.exec(fn('../supabase/schema.sql','public.gridex_assert_switch_writer_v1').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
 await db.exec(migration)
 const pre=['draft','ready','ready_for_switch','ready_for_z03','z03_ready','prepared','waiting','queued','submitted','sent','processing']
 const claims=c=>db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify(c)])
 const seed=async(n,status)=>{await db.exec("INSERT INTO supplier_switch_requests(id,company_id,status,lifecycle_blocked) VALUES('"+id(n)+"','"+id(1)+"','"+status+"',false)");return id(n)}
 const t=(req,company=id(1))=>db.query("SELECT public.gridex_transition_supplier_switch_v2($1,$2,$3,$4,$5) r",[company,req,{status:'failed',failure_reason:'APERAK 27'},{event_type:'status_updated',event_status:'failed'},pre]).then(r=>r.rows[0].r)
 const row=async req=>(await db.query("SELECT s.status,s.failure_reason,(SELECT count(*)::int FROM supplier_switch_events e WHERE e.switch_request_id=s.id) events FROM supplier_switch_requests s WHERE s.id=$1",[req])).rows[0]
 await claims({role:'service_role'})

 // Expected status matches: transition and event happen together.
 for(const [n,status] of [[5001,'prepared'],[5002,'sent']]){const req=await seed(n,status),r=await t(req)
  assert.equal(r.applied,true,JSON.stringify(r));assert.deepEqual(await row(req),{status:'failed',failure_reason:'APERAK 27',events:1});v2++
  const ev=(await db.query("SELECT payload FROM supplier_switch_events WHERE switch_request_id=$1",[req])).rows[0].payload
  assert.equal(ev.previous_status,status);assert.equal(ev.new_status,'failed');v2++}

 // Locked status not in the set: no change, no event, current status reported.
 for(const [n,status] of [[5003,'accepted'],[5004,'completed'],[5005,'failed']]){const req=await seed(n,status),r=await t(req)
  assert.deepEqual({applied:r.applied,currentStatus:r.currentStatus},{applied:false,currentStatus:status});assert.deepEqual(await row(req),{status,failure_reason:null,events:0});v2++}

 // NULL-safe membership: NULL, empty and a non-matching set containing NULL all no-op.
 const tx=(req,expected)=>db.query("SELECT public.gridex_transition_supplier_switch_v2($1,$2,$3,$4,$5::text[]) r",[id(1),req,{status:'failed',failure_reason:'APERAK 27'},{event_type:'status_updated',event_status:'failed'},expected]).then(r=>r.rows[0].r)
 for(const [n,expected] of [[5011,null],[5012,[]],[5013,['prepared',null]]]){const req=await seed(n,'accepted'),r=await tx(req,expected)
  assert.equal(r.applied,false,JSON.stringify(r));assert.deepEqual(await row(req),{status:'accepted',failure_reason:null,events:0});v2++}
 { const req=await seed(5014,'sent');assert.equal((await tx(req,[null,'sent'])).applied,true);assert.equal((await row(req)).status,'failed');v2++ }

 // Writer assertion still enforced: a non-writer authenticated actor is refused
 // with no change; a writer of the same tenant is allowed; another tenant cannot
 // reach the row (not found for tenant).
 const guarded=await seed(5006,'sent')
 await claims({role:'authenticated',company:id(999)})
 await assert.rejects(t(guarded),/supplier_switch_write_not_allowed/);assert.deepEqual(await row(guarded),{status:'sent',failure_reason:null,events:0});v2++
 await claims({role:'authenticated'})
 await assert.rejects(t(guarded,null),/supplier_switch_company_required/);v2++
 await claims({role:'authenticated',company:id(999)})
 await assert.rejects(t(guarded,id(999)),/supplier_switch_not_found_for_tenant/);assert.equal((await row(guarded)).status,'sent');v2++
 await claims({role:'authenticated',company:id(1)})
 assert.equal((await t(guarded)).applied,true);assert.equal((await row(guarded)).status,'failed');v2++
 await claims({role:'service_role'})

 // Grants mirror v1.
 const acl=(await db.query("SELECT proacl::text a,prosecdef d FROM pg_proc WHERE proname='gridex_transition_supplier_switch_v2'")).rows[0]
 assert.equal(acl.d,true);assert.match(acl.a,/service_role=X/);assert.match(acl.a,/authenticated=X/);assert.doesNotMatch(acl.a,/(^|[{,])=X/);v2++
 console.log('SC037_TRANSITION_V2_RESULT '+JSON.stringify({checks:v2,boundary:'focused PGlite over migration v2 + latest schema.sql writer assertion',native:'NOT_EXERCISED'}))
`

const source = base.replace(marker, () => extension + marker)
const temp = fileURLToPath(new URL('./.ediel-sc037-transition-v2.tmp.mjs', import.meta.url))
writeFileSync(temp, source)
try {
  const result = spawnSync(process.execPath, [temp], { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  unlinkSync(temp)
}
