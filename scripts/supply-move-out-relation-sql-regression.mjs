// reality-defects: (reality scenario H "the customer leaves", FINDINGS H7 and its own-closure relation rule)
// Which owner takes a received PRODAT Z05 LK (CAV Z23), on the real source-chain function: the predecessor
// body as 20261001085523 creates it (renamed into gridex_supply_rescission by 20261001115000), then the real
// forward migrations 20261022140000 and 20261022141000. The downstream owners are finite fixture ports that
// only say which path was taken; the tenant, environment, closure-operation, original and period rows are real
// tables with the columns the rule reads. PGlite, synthetic rows.
//   * a Z05 LK unrelated to any own Z08 LK takes the ordinary end (H7);
//   * a Z05 LK that relates to our own Z08 LK (open closure operation for the point, or an own original with
//     its LI, sent or unsent) must match exactly, otherwise it is held with no effect (AT-Z08LK-SUPPLIER, P-16);
//   * an exact match and a recorded replay stay with the closure owner; other tenants/environments never relate.
// Run: EDIEL_PGLITE_MODULE=$PWD/node_modules/@electric-sql/pglite/dist/index.js node scripts/supply-move-out-relation-sql-regression.mjs
import { pathToFileURL, fileURLToPath } from 'node:url'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const root = fileURLToPath(new URL('..', import.meta.url)), db = new PGlite()
const migration = name => fs.readFileSync(`${root}/supabase/migrations/${name}`, 'utf8')
let checks = 0
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', actor = '99999999-9999-4999-8999-999999999999'
const POINT = '735999000000000017', OTHER_POINT = '735999000000000024'
let serial = 0
const uuid = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create schema gridex_received_sources;create schema gridex_bilateral_prodat;create schema gridex_supply_rescission;
  create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,status text);
  create table public.metering_points(id uuid primary key,company_id uuid,metering_point_id text,ediel_metering_point_id text);
  create table public.customer_supply_periods(id uuid primary key,company_id uuid,metering_point_id uuid,source_end_message_id uuid);
  create table gridex_received_sources.supply_source_transitions(source_message_id uuid primary key,company_id uuid,payload_hash text,source_code text);
  create table gridex_bilateral_prodat.closure_operations(id uuid primary key,company_id uuid,environment text,period_id uuid);
  create table gridex_bilateral_prodat.outbound_operations(message_id uuid primary key,company_id uuid,environment text,capability jsonb);
  create table gridex_bilateral_prodat.closure_end_receipts(source_message_id uuid,company_id uuid);
  -- Fixture ports: the parsed wire, the exact-match decision and the two downstream owners.
  create table public.fixture_wires(raw text primary key,wire jsonb);create table public.fixture_matches(source_message_id uuid primary key);
  create function gridex_received_sources.normal_switch_wire_v1(text) returns jsonb language sql as $$select wire from public.fixture_wires where raw=$1$$;
  create function public.ediel_require_source_bytes_available_v1(uuid,uuid) returns void language sql as $$select$$;
  create function gridex_bilateral_prodat.lock_closure_v1() returns void language sql as $$select$$;
  create function gridex_bilateral_prodat.matched_closure_operation_v1(m public.ediel_messages,w jsonb,own jsonb) returns jsonb language sql as $$select case when exists(select from public.fixture_matches where source_message_id=m.id) then jsonb_build_object('operationId',m.id) end$$;
  create function gridex_bilateral_prodat.recorded_closure_end_current_v1(uuid,uuid) returns boolean language sql as $$select true$$;
  create function gridex_bilateral_prodat.confirm_closure_end_v1(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('applied',true,'path','closure')$$;
  create function gridex_bilateral_prodat.record_closure_end_v1(public.ediel_messages,jsonb) returns void language sql as $$select$$;
  create function gridex_bilateral_prodat.apply_supply_before_closure_v1(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('applied',true,'path','ordinary')$$;
  -- The ACK guards 20261022140000 rewrites, reduced to the exact predicate text it guards on.
  create function public.ediel_require_prodat_bilateral_positive_source_v1(uuid,uuid) returns void language plpgsql as $f$declare m public.ediel_messages;wire jsonb;own jsonb;begin
   perform 1 from jsonb_array_elements(wire->'objects') o where (o->>'reason' in('Z25') or wire->>'code'='Z05' AND o->>'reason'='Z23');
   if not(own->>'reason' in('Z25') or wire->>'code'='Z05' AND own->>'reason'='Z23') then return;end if;end$f$;
  create function public.ediel_require_recorded_prodat_bilateral_ack_source_v1(uuid,uuid,text) returns void language plpgsql as $f$declare m public.ediel_messages;wire jsonb;begin
   perform 1 from jsonb_array_elements(wire->'objects') o where (o->>'reason' in('Z25') or wire->>'code'='Z05' AND o->>'reason'='Z23');end$f$;`)
 // The real predecessor body and its move into gridex_supply_rescission.
 const closure = migration('20261001085523_ediel_bilateral_prodat_closure_operation_and_matched_end.sql')
 const start = closure.indexOf('CREATE FUNCTION public.ediel_apply_supply_source_v1(')
 await db.exec(closure.slice(start, closure.indexOf('END$$;', start) + 'END$$;'.length))
 await db.exec(`ALTER FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) SET SCHEMA gridex_supply_rescission;
  ALTER FUNCTION gridex_supply_rescission.ediel_apply_supply_source_v1(uuid,uuid,uuid) RENAME TO apply_supply_before_rescission_v1;`)
 const apply = async message => (await db.query('select gridex_supply_rescission.apply_supply_before_rescission_v1($1,$2,$3) r', [message.company, message.id, actor])).rows[0].r
 const rejects = async (fn, pattern) => { await assert.rejects(fn, pattern); checks++ }

 /** A received Z05 for one object. */
 async function received({ company = A, environment = 'test', reason = 'Z23', point = POINT, li = 'LI-OTHER' } = {}) {
  const id = uuid(), raw = `Z05-${id}`
  await db.query('insert into public.ediel_messages values($1,$2,$3,$4,$5,$6,$7,$8)', [id, company, environment, 'inbound', 'PRODAT', 'Z05', raw, 'validated'])
  await db.query('insert into public.fixture_wires values($1,$2)', [raw, JSON.stringify({ code: 'Z05', objects: [{ reason, point, li, end: '202611010000' }] })])
  return { id, company }
 }
 /** Our own Z08 LK closure: an operation on the point's open period, and its original (sent or not). */
 async function ownClosure({ company = A, environment = 'test', point = POINT, li = 'LI-OWN', periodEnded = false } = {}) {
  const mp = uuid(), period = uuid(), operation = uuid(), original = uuid()
  await db.query('insert into public.metering_points values($1,$2,$3,$3)', [mp, company, point])
  await db.query('insert into public.customer_supply_periods values($1,$2,$3,$4)', [period, company, mp, periodEnded ? uuid() : null])
  await db.query('insert into gridex_bilateral_prodat.closure_operations values($1,$2,$3,$4)', [operation, company, environment, period])
  await db.query('insert into public.ediel_messages values($1,$2,$3,$4,$5,$6,$7,$8)', [original, company, environment, 'outbound', 'PRODAT', 'Z08', `Z08-${original}`, 'queued'])
  await db.query('insert into gridex_bilateral_prodat.outbound_operations values($1,$2,$3,$4)', [original, company, environment, JSON.stringify({ objects: [{ lineItemReference: li, objectId: point }] })])
  return { operation, period, original }
 }
 const reset = () => db.exec(`delete from gridex_bilateral_prodat.outbound_operations;delete from gridex_bilateral_prodat.closure_operations;delete from public.customer_supply_periods;
  delete from public.metering_points;delete from gridex_bilateral_prodat.closure_end_receipts;delete from gridex_received_sources.supply_source_transitions;delete from public.fixture_matches;`)

 // Before H7 (shipped 20261001085523/115000): every Z05 LK went to the closure owner and was held.
 await rejects(async () => apply(await received()), /bilateral_closure_exact_sent_original_required/)

 await db.exec(migration('20261022140000_supply_move_out_z05lk_end.sql'));checks++
 // 20261022140000 alone: an unmatched Z05 LK related to our own closure fell through (the regression).
 await ownClosure()
 assert.equal((await apply(await received())).path, 'ordinary');checks++
 await reset()

 await db.exec(migration('20261022141000_supply_move_out_own_closure_relation.sql'));checks++
 // H7: no own closure at all → the ordinary end.
 assert.equal((await apply(await received())).path, 'ordinary');checks++
 // Our own open closure on the point, wrong LI / wrong end minute / unsent original (no exact match) → held.
 await ownClosure()
 await rejects(async () => apply(await received({ li: 'LI-WRONG' })), /bilateral_closure_exact_sent_original_required/)
 // The exact match stays with the closure owner.
 const exact = await received({ li: 'LI-OWN' });await db.query('insert into public.fixture_matches values($1)', [exact.id])
 assert.equal((await apply(exact)).path, 'closure');checks++
 // A recorded closure replay stays with the closure owner.
 const replay = await received({ li: 'LI-OWN' })
 await db.query('insert into gridex_bilateral_prodat.closure_end_receipts values($1,$2)', [replay.id, A]);await db.query('insert into gridex_received_sources.supply_source_transitions values($1,$2,$3,$4)', [replay.id, A, 'h', 'Z05'])
 assert.equal((await apply(replay)).path, 'closure');checks++
 // Another physical point of the same tenant is not related.
 assert.equal((await apply(await received({ point: OTHER_POINT }))).path, 'ordinary');checks++
 // A Z05 L (switch away) is never a closure question.
 assert.equal((await apply(await received({ reason: 'Z22' }))).path, 'ordinary');checks++
 await reset()
 // An own original with this LI relates even when its period already received an end (sent or unsent).
 await ownClosure({ periodEnded: true, li: 'LI-OWN' })
 await rejects(async () => apply(await received({ li: 'LI-OWN' })), /bilateral_closure_exact_sent_original_required/)
 // ... but a later notice for the same point with another LI is ordinary once our closure's period ended.
 assert.equal((await apply(await received({ li: 'LI-NEXT-OCCUPANT' }))).path, 'ordinary');checks++
 await reset()
 // Other tenants and environments never relate.
 await ownClosure({ company: B });await ownClosure({ environment: 'production' })
 assert.equal((await apply(await received({ li: 'LI-OWN' }))).path, 'ordinary');checks++

 // ACK guards: the ordinary end is recognised only after its own transition and without a closure receipt.
 const ordinary = await received({ li: 'LI-FREE' }), ordinaryOf = async m => (await db.query('select gridex_bilateral_prodat.ordinary_z05_end_v1(m) o from public.ediel_messages m where id=$1', [m.id])).rows[0].o
 assert.equal(await ordinaryOf(ordinary), false);checks++
 await db.query("insert into gridex_received_sources.supply_source_transitions values($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'),'Z05')", [ordinary.id, A, `Z05-${ordinary.id}`])
 assert.equal(await ordinaryOf(ordinary), true);checks++
 await db.query('insert into gridex_bilateral_prodat.closure_end_receipts values($1,$2)', [ordinary.id, A])
 assert.equal(await ordinaryOf(ordinary), false);checks++
 // The new helpers are private: no API role may call them.
 for (const role of ['anon', 'authenticated', 'service_role']) {
  for (const fn of ['related_own_closure_v1(public.ediel_messages,jsonb)', 'z05_closure_owned_v1(public.ediel_messages,jsonb)', 'ordinary_z05_end_v1(public.ediel_messages)'])
   assert.equal((await db.query(`select has_function_privilege('${role}','gridex_bilateral_prodat.${fn}','EXECUTE') p`)).rows[0].p, false)
  checks++
 }
 console.log(`Z05 LK owner selection (H7 + own-closure relation): ${checks} PASS`)
} finally { await db.close() }
