// reality-defects: H3d (B2: operator fee review at a move-out inside the binding period, every customer type, manual
// and Z05 alike, binding from the actual start, one per contract; D7: the lifecycle close keeps and creates the final
// invoice task)
// Owner decision 2026-10-23 B2 "Avgiftsgranskning för alla" (OWNER-DECISIONS.md row 17) and decision 20: the operator
// decides; nothing is charged automatically. Runs the real SQL writers (supabase/schema.sql bodies) on PGlite with
// migration 20261023202000 applied; scripts/h3d-move-out-fee-review-sql-regression.mjs covers the full matrix and --old.
// Fail-before evidence: H3D_FEE_REVIEW_SHIPPED=1 runs these assertions on the shipped bodies (they fail).
// Synthetic ids only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
// @ts-expect-error -- plain ESM fixture shared with the node regression script
import { createFeeReviewDb, ids } from '../scripts/helpers/h3d-move-out-fee-review-sql-fixture.mjs'

type Task = { task_type: string; status: string; metering_point_id: string | null; title: string; metadata: Record<string, unknown> }
type Fixture = {
  db: PGlite
  seed: (input?: Record<string, unknown>) => Promise<void>
  close: (date: string, mode?: string) => Promise<Record<string, unknown>>
  endSupply: (date: string, reason?: string) => Promise<Record<string, unknown>>
  receivedEnd: (date: string, status?: string) => Promise<unknown>
  q: (sql: string, args?: unknown[]) => Promise<unknown[]>
  tasks: (company?: string) => Promise<Task[]>
  reviews: (company?: string) => Promise<Task[]>
  finalInvoices: (company?: string) => Promise<Task[]>
  scenario: <T>(fn: () => Promise<T>) => Promise<T>
}

let t: Fixture
beforeAll(async () => {
  t = await createFeeReviewDb({ PGlite, applyMigration: process.env.H3D_FEE_REVIEW_SHIPPED !== '1' }) as Fixture
}, 60_000)
afterAll(async () => { await t?.db.close() })

const reviewFacts = (task: Task) => ({ contract: task.metadata.contract_id, start: task.metadata.binding_starts_at, end: task.metadata.binding_ends_at,
  reason: task.metadata.end_reason, type: task.metadata.customer_type, auto: task.metadata.charged_automatically })

describe('H3d B2 a manual move-out from the customer card (gridex_close_customer_lifecycle_v1)', () => {
  for (const customerType of ['private', 'business', 'association']) {
    it(`creates one fee review inside the binding for a ${customerType} customer, from the supplied start`, () => t.scenario(async () => {
      // Requested start 1 August, first supplied day 1 September, 12 months: bound until 1 September 2027.
      await t.seed({ customerType, startsAt: '2026-08-01', supplyStart: '2026-09-01' })
      const result = await t.close('2026-11-15')
      const reviews = await t.reviews()
      expect(reviews.map(reviewFacts)).toEqual([{ contract: ids.contract, start: '2026-09-01', end: '2027-09-01', reason: 'move_out', type: customerType, auto: false }])
      expect(reviews[0]).toMatchObject({ status: 'open', title: 'Bedöm brytavgift vid flytt', metering_point_id: ids.point })
      expect(result.break_fee_review_contract_ids).toEqual([ids.contract])
      expect(await t.tasks(ids.other)).toEqual([])
    }))
  }

  it('creates no review when the binding is served through the last supplied day', () => t.scenario(async () => {
    await t.seed({ startsAt: '2025-08-01', supplyStart: '2025-09-01' })
    await t.close('2026-08-31')
    expect(await t.reviews()).toEqual([])
  }))

  it('creates the final invoice task for the ended period (D7)', () => t.scenario(async () => {
    await t.seed()
    const result = await t.close('2026-11-15')
    expect((await t.finalInvoices()).map(task => [task.status, task.metering_point_id, task.metadata.supply_period_id, task.metadata.last_supplied_date]))
      .toEqual([['open', ids.point, ids.supply, '2026-11-15']])
    expect(result.final_invoice_tasks).toBe(1)
  }))

  it('keeps an earlier final invoice and fee review and adds no second review for the contract (D7)', () => t.scenario(async () => {
    await t.seed()
    await t.q(`insert into public.customer_operation_tasks(company_id,customer_id,task_type,status,metadata) values
      ($1,$2,'final_invoice_pending','open','{"supply_end_date":"2026-11-01"}'),($1,$2,'break_fee_review','open',$3),($1,$2,'customer_followup','open','{}')`,
    [ids.company, ids.customer, { contract_id: ids.contract }])
    await t.close('2026-11-15')
    const tasks = await t.tasks()
    expect(tasks.filter(task => task.task_type === 'break_fee_review').map(task => task.status)).toEqual(['open'])
    expect(tasks.filter(task => task.task_type === 'final_invoice_pending').map(task => task.status)).toEqual(['open', 'open'])
    expect(tasks.filter(task => task.task_type === 'customer_followup').map(task => task.status)).toEqual(['cancelled'])
  }))
})

describe('H3d B2 the manual end per metering point (gridex_end_customer_supply_v1)', () => {
  it("creates a review for 'move_out' as for 'supplier_switch', once", () => t.scenario(async () => {
    await t.seed({ customerType: 'business' })
    expect((await t.endSupply('2026-11-15', 'move_out')).break_fee_review).toBe(true)
    expect((await t.endSupply('2026-11-15', 'move_out')).already_applied).toBe(true)
    expect((await t.reviews()).map(reviewFacts)).toEqual([{ contract: ids.contract, start: '2026-09-01', end: '2027-09-01', reason: 'move_out', type: 'business', auto: false }])
  }))
})

describe('H3d B2 a received grid-owner end (Z05 L/LK, gridex_supply_end_followup_v1)', () => {
  it('counts the binding from the supplied start, not the requested start (H6)', () => t.scenario(async () => {
    // Requested 1 October 2025, supplied from 1 November 2025: bound until 1 November 2026; the Z05 ends 20 October.
    await t.seed({ startsAt: '2025-10-01', supplyStart: '2025-11-01' })
    await t.receivedEnd('2026-10-20')
    expect((await t.reviews()).map(reviewFacts)).toEqual([{ contract: ids.contract, start: '2025-11-01', end: '2026-11-01', reason: 'supply_end', type: 'private', auto: false }])
  }))

  it('keeps one review per contract after a manual move-out followed by the Z05 LK', () => t.scenario(async () => {
    await t.seed()
    await t.close('2026-11-15')
    await t.receivedEnd('2026-11-16')
    expect(await t.reviews()).toHaveLength(1)
  }))
})
