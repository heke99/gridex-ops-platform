// reality-defects: H3d (B2: an operator fee review at a move-out inside the binding period for every customer type,
// manual and Z05 alike, binding from the actual start, one per contract; D7: the lifecycle close keeps and creates the
// final-invoice task; owner decisions 2026-10-23 rows 17 and 20)
// PGlite, synthetic rows. The shipped bodies of gridex_close_customer_lifecycle_v1, gridex_end_customer_supply_v1 and
// gridex_supply_end_followup_v1 come from supabase/schema.sql (identical to the world database before 20261023202000);
// see scripts/helpers/h3d-move-out-fee-review-sql-fixture.mjs.
//   shipped bodies: a manual move-out inside the binding gets no review (close and end-supply), the close creates no
//     final invoice and cancels an earlier Z05's final invoice and review, the binding runs from the requested
//     starts_at, a fully served binding is reviewed on a manual switch, and nothing keeps the review to one per contract;
//   after 20261023202000: all of that holds as decided, and the refusals stay (terminate without a move, outside the
//     binding, other tenant, replay).
// Run: EDIEL_PGLITE_MODULE=$PWD/node_modules/@electric-sql/pglite/dist/index.js node scripts/h3d-move-out-fee-review-sql-regression.mjs [--old]
//   --old runs the post-migration assertions on the shipped bodies (they fail: the defect).
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createFeeReviewDb, ids, SIGNATURES, MIGRATION_PATH } from './helpers/h3d-move-out-fee-review-sql-fixture.mjs'

const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const old = process.argv.includes('--old')
let count = 0
const ok = (cond, label) => { assert.ok(cond, label); count++ }
const eq = (a, b, label) => { assert.deepEqual(a, b, label); count++ }

// 1. Defect evidence on the shipped bodies.
{
  const t = await createFeeReviewDb({ PGlite, applyMigration: false })
  await t.scenario(async () => {
    await t.seed()
    await t.close('2026-11-15')
    eq((await t.reviews()).length, 0, 'shipped close: no review for a move-out inside the binding')
    eq((await t.finalInvoices()).length, 0, 'shipped close: no final invoice task')
  })
  await t.scenario(async () => {
    await t.seed()
    await t.endSupply('2026-11-15', 'move_out')
    eq((await t.reviews()).length, 0, 'shipped end-supply: no review for a move-out')
  })
  await t.scenario(async () => {
    await t.seed()
    await t.q(`insert into public.customer_operation_tasks(company_id,customer_id,task_type,status,metadata) values($1,$2,'final_invoice_pending','open','{}'),($1,$2,'break_fee_review','open','{}')`, [ids.company, ids.customer])
    await t.close('2026-11-15')
    eq((await t.tasks()).map(x => x.status), ['cancelled', 'cancelled'], 'shipped close cancels the earlier final invoice and review (D7)')
  })
  await t.scenario(async () => {
    // Requested start 1 Oct 2025, market start 1 Nov 2025, 12 months: bound until 1 Nov 2026. Z05 end 20 Oct 2026.
    await t.seed({ startsAt: '2025-10-01', supplyStart: '2025-11-01' })
    await t.receivedEnd('2026-10-20')
    eq((await t.reviews()).length, 0, 'shipped Z05: binding counted from the requested start misses the review (H6)')
  })
  console.log(`Shipped bodies miss the move-out fee review and the close's final invoice (H3d B2/D7): ${count} PASS`)
}
if (old) console.log('--old: running the decided behaviour on the shipped bodies (expected to fail)')

// 2. The decided behaviour (after 20261023202000; with --old on the shipped bodies).
const t = await createFeeReviewDb({ PGlite, applyMigration: !old })
const shippedCount = count

for (const customerType of ['private', 'business', 'association']) await t.scenario(async () => {
  await t.seed({ customerType })
  const result = await t.close('2026-11-15')
  const [review] = await t.reviews()
  ok(review && review.status === 'open', `close move-out (${customerType}): one open review`)
  eq((await t.reviews()).length, 1, `close move-out (${customerType}): exactly one review`)
  eq({ contract: review.metadata.contract_id, start: review.metadata.binding_starts_at, end: review.metadata.binding_ends_at, last: review.metadata.supply_end_date,
    first: review.metadata.first_unsupplied_date, reason: review.metadata.end_reason, type: review.metadata.customer_type, auto: review.metadata.charged_automatically, mp: review.metering_point_id },
  { contract: ids.contract, start: '2026-09-01', end: '2027-09-01', last: '2026-11-15', first: '2026-11-16', reason: 'move_out', type: customerType, auto: false, mp: ids.point },
  `close move-out (${customerType}): review from the actual (supplied) start, not the requested 1 August`)
  eq(review.title, 'Bedöm brytavgift vid flytt', 'close review title')
  eq(result.break_fee_review_contract_ids, [ids.contract], 'close returns the reviewed contract')
  const invoices = await t.finalInvoices()
  eq(invoices.map(x => [x.status, x.metering_point_id, x.metadata.supply_period_id, x.metadata.supply_end_date, x.metadata.last_supplied_date, x.metadata.end_reason]),
    [['open', ids.point, ids.supply, '2026-11-15', '2026-11-15', 'move_out']], `close move-out (${customerType}): one final invoice for the ended period`)
  eq(result.final_invoice_tasks, 1, 'close returns the final invoice count')
  eq(await t.contractRow(), { status: 'terminated', termination_reason: 'move_out', ends_at: '2026-11-15' }, 'contract terminated as before')
  eq((await t.tasks(ids.other)).length, 0, 'tenant B untouched')
})

await t.scenario(async () => {
  await t.seed({ startsAt: '2025-08-01', supplyStart: '2025-09-01' })
  await t.close('2026-08-31')
  eq((await t.reviews()).length, 0, 'close: binding ends the day after the last supplied day (1 Sep 2026): no review')
  eq((await t.finalInvoices()).length, 1, 'close outside the binding still creates the final invoice')
})
await t.scenario(async () => {
  await t.seed({ startsAt: '2025-08-01', supplyStart: '2025-09-01' })
  await t.close('2026-08-30')
  eq((await t.reviews()).map(x => x.metadata.binding_ends_at), ['2026-09-01'], 'close: one day inside the binding: a review')
})
await t.scenario(async () => {
  await t.seed({ binding: 0 })
  await t.close('2026-11-15')
  eq((await t.reviews()).length, 0, 'close: no binding: no review')
})
await t.scenario(async () => {
  await t.seed({ contractExtra: { actual_start_at: '2026-10-01' } })
  await t.close('2026-11-15')
  eq((await t.reviews()).map(x => x.metadata.binding_starts_at), ['2026-10-01'], 'a recorded actual start wins over the supplied start')
})
await t.scenario(async () => {
  await t.seed()
  const result = await t.close('2026-11-15', 'terminate')
  eq((await t.reviews()).length, 0, "close 'terminate' (no move): no review in this slice (B3)")
  eq((await t.finalInvoices()).map(x => x.metadata.end_reason), ['terminate'], "close 'terminate' still creates the final invoice")
  eq(result.break_fee_review_contract_ids, [], 'terminate returns no reviewed contract')
})
await t.scenario(async () => {
  await t.seed()
  await t.q(`insert into public.customer_operation_tasks(company_id,customer_id,task_type,status,metadata) values
    ($1,$2,'final_invoice_pending','open','{"supply_end_date":"2026-11-01"}'),($1,$2,'break_fee_review','open',$3),($1,$2,'customer_followup','open','{}')`,
  [ids.company, ids.customer, { contract_id: ids.contract }])
  await t.close('2026-11-15')
  const rows = await t.tasks()
  eq(rows.filter(x => x.task_type === 'customer_followup').map(x => x.status), ['cancelled'], 'close still cancels other open work')
  eq(rows.filter(x => x.task_type === 'break_fee_review').map(x => x.status), ['open'], 'close keeps the earlier review and adds none for the same contract (D7, one per contract)')
  eq(rows.filter(x => x.task_type === 'final_invoice_pending').map(x => [x.status, x.metadata.supply_end_date ?? null]),
    [['open', '2026-11-01'], ['open', '2026-11-15']], 'close keeps the earlier final invoice and adds its own')
})
await t.scenario(async () => {
  await t.seed()
  await t.q(`insert into public.customer_operation_tasks(company_id,customer_id,task_type,status,metadata) values($1,$2,'break_fee_review','resolved',$3)`, [ids.company, ids.customer, { contract_id: ids.contract }])
  await t.close('2026-11-15')
  eq((await t.reviews()).map(x => x.status), ['resolved'], 'a resolved review of the contract is not reopened')
})
await t.scenario(async () => {
  await t.seed()
  let refused = false
  await t.db.exec('savepoint cross_tenant')
  try { await t.close('2026-11-15', 'move_out', ids.other, ids.customer) } catch (error) { refused = /customer_not_found_for_tenant/.test(String(error.message)); if (!refused) console.error(error) }
  await t.db.exec('rollback to savepoint cross_tenant')
  ok(refused, 'cross-tenant close refused')
  eq((await t.tasks()).length + (await t.tasks(ids.other)).length, 0, 'no task after a refused close')
})

// gridex_end_customer_supply_v1
await t.scenario(async () => {
  await t.seed({ customerType: 'business' })
  const first = await t.endSupply('2026-11-15', 'move_out')
  const [review] = await t.reviews()
  eq([review?.title, review?.metadata.end_reason, review?.metadata.binding_starts_at, review?.metadata.customer_type, review?.metadata.end_key],
    ['Bedöm brytavgift vid flytt', 'move_out', '2026-09-01', 'business', `${ids.point}:2026-11-15`], 'end-supply move-out: a review')
  eq(first.break_fee_review, true, 'end-supply reports the review')
  const replay = await t.endSupply('2026-11-15', 'move_out')
  eq(replay.already_applied, true, 'replay is idempotent')
  eq((await t.reviews()).length, 1, 'one review after a replay')
  eq((await t.finalInvoices()).length, 1, 'one final invoice after a replay')
})
await t.scenario(async () => {
  await t.seed()
  await t.endSupply('2026-11-15', 'supplier_switch')
  eq((await t.reviews()).map(x => [x.title, x.metadata.end_reason]), [['Bedöm brytavgift vid leverantörsbyte', 'supplier_switch']], 'end-supply switch away: still a review')
})
await t.scenario(async () => {
  await t.seed({ startsAt: '2025-08-01', supplyStart: '2025-09-01' })
  const result = await t.endSupply('2026-08-31', 'supplier_switch')
  eq([(await t.reviews()).length, result.break_fee_review], [0, false], 'end-supply: a binding served through the last supplied day is not reviewed')
})

// gridex_supply_end_followup_v1 (Z05 L/LK)
await t.scenario(async () => {
  await t.seed({ startsAt: '2025-10-01', supplyStart: '2025-11-01' })
  await t.receivedEnd('2026-10-20')
  eq((await t.reviews()).map(x => [x.metadata.binding_starts_at, x.metadata.binding_ends_at, x.metadata.first_unsupplied_date, x.metadata.end_reason, x.metadata.charged_automatically]),
    [['2025-11-01', '2026-11-01', '2026-10-20', 'supply_end', false]], 'Z05: binding from the supplied start (H6)')
  eq((await t.finalInvoices()).length, 1, 'Z05: final invoice as before')
})
await t.scenario(async () => {
  await t.seed({ customerType: 'association' })
  await t.receivedEnd('2026-12-01', 'ending')
  eq((await t.reviews()).map(x => x.metadata.customer_type), ['association'], 'Z05 LK with a future end (ending): a review for every customer type')
})
await t.scenario(async () => {
  await t.seed()
  await t.q(`insert into public.customer_operation_tasks(company_id,customer_id,task_type,status,metadata) values($1,$2,'break_fee_review','open',$3)`, [ids.company, ids.customer, { contract_id: ids.contract }])
  await t.receivedEnd('2026-11-01')
  eq((await t.reviews()).length, 1, 'Z05: no second review for the same contract')
})
await t.scenario(async () => {
  await t.seed()
  await t.close('2026-11-15')
  await t.receivedEnd('2026-11-16')
  eq((await t.reviews()).length, 1, 'close then Z05 LK: one review in total')
})
await t.scenario(async () => {
  await t.seed({ startsAt: '2025-08-01', supplyStart: '2025-09-01' })
  await t.receivedEnd('2026-09-01')
  eq((await t.reviews()).length, 0, 'Z05 at the binding end: no review')
})

if (!old) {
  // Owner, ACL, security definer, volatility and configuration are preserved; the migration refuses a second run and a
  // changed body.
  eq(await t.meta(), t.metaBefore, 'function metadata preserved')
  const migration = fs.readFileSync(MIGRATION_PATH, 'utf8')
  for (const [label, prepare] of [['second run', async () => {}], ['changed end-supply body', async () => {
    const body = t.shipped[SIGNATURES.end].replace('-- out does not.', '-- out does not!')
    const def = (await t.q(`select pg_get_functiondef($1::regprocedure) d`, [SIGNATURES.end]))[0].d
    const current = (await t.q(`select prosrc from pg_proc where oid=$1::regprocedure`, [SIGNATURES.end]))[0].prosrc
    await t.db.exec(def.replace(current, body))
  }]]) {
    await t.db.exec('begin')
    try {
      await prepare()
      await t.db.exec('savepoint s')
      let refused = false
      try { await t.db.exec(migration.replace(/^begin;$/m, '').replace(/^commit;$/m, '')) } catch (error) { refused = /move_out_fee_review_rule_source_changed/.test(String(error.message)) }
      ok(refused, `migration refuses: ${label}`)
    } finally { await t.db.exec('rollback') }
  }
}
console.log(`${old ? 'Shipped' : 'Migrated'} bodies, decided behaviour (H3d B2/D7): ${count - shippedCount} PASS`)
console.log(`h3d move-out fee review SQL regression: ${count} PASS`)
