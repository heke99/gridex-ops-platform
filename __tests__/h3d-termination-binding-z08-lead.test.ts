// reality-defects: H3d (slice 3: owner decisions 2026-10-24 B5 a termination without a move ends after its notice
// period, also inside the binding, with one operator fee review; B6 the Z08 task is created 14 days before the planned
// end and closed automatically when a new supplier's Z05 ends the supply first; B7 a Z05 L keeps the later planned end
// and is reviewed inside the binding)
// OWNER-DECISIONS.md rows 21-23. Runs the real SQL writers (supabase/schema.sql bodies, slices 1 and 2) on PGlite with
// 20261024100000 applied. Fail-before evidence: H3D_B5_SHIPPED=1 runs these assertions on the slice-2 bodies installed
// in the world before this change (B5/B6 fail; the B7 keep-cases pass on both). Synthetic ids only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
// @ts-expect-error -- plain ESM fixture shared with the node regression script
import { createNoticeDb, ids } from '../scripts/helpers/h3d-notice-termination-sql-fixture.mjs'
import { contractTerminationEndDate } from '@/lib/customer-contracts/lifecycle'
import { TERMINATION_Z08_TASK_LEAD_DAYS } from '@/lib/customer-contracts/terminationNoticeExpiry'

type Row = Record<string, unknown>
type Task = { task_type: string; status: string; title: string; description: string; due_at: Date | null; resolved_at: Date | null; metadata: Row }
type Fixture = {
  db: PGlite
  q: (sql: string, args?: unknown[]) => Promise<Row[]>
  service: (sql: string, args?: unknown[]) => Promise<Row>
  asRole: (role: string, sql: string, args?: unknown[]) => Promise<Row>
  seed: (input?: Row) => Promise<void>
  close: (date: string, mode?: string, noticeDate?: string | null, company?: string) => Promise<Row>
  expiry: (asOf: string, company?: string | null) => Promise<Row>
  receivedEnd: (date: string, status?: string, id?: string) => Promise<unknown>
  tasks: (company?: string) => Promise<Task[]>
  ofType: (type: string, company?: string) => Promise<Task[]>
  contractRow: (id?: string) => Promise<Row>
  scenario: <T>(fn: () => Promise<T>) => Promise<T>
}

let t: Fixture
beforeAll(async () => {
  t = await createNoticeDb({ PGlite, b5Shipped: process.env.H3D_B5_SHIPPED === '1' }) as Fixture
}, 60_000)
afterAll(async () => { await t?.db.close() })

const facts = async () => {
  const row = await t.contractRow()
  return { status: row.status, reason: row.termination_reason, notice: row.notice, ended: row.ended }
}
const review = (contractId = ids.contract) =>
  t.service(`select public.gridex_termination_break_fee_review_v1($1,$2,$3) r`, [ids.company, contractId, ids.actor])

describe('H3d B5 a termination without a move ends after its notice period; inside the binding the operator reviews a fee', () => {
  for (const customerType of ['private', 'business']) {
    it(`${customerType}: the planned end is the notice end, not the binding end, and one fee review is created`, () => t.scenario(async () => {
      await t.seed({ customerType, noticeMonths: 1, binding: 12, startsAt: '2026-09-01' })
      const result = await t.close('2026-10-10', 'terminate', '2026-10-10')
      expect(await facts()).toEqual({ status: 'active', reason: null, notice: '2026-10-10', ended: '2026-11-10' })
      expect(result).toMatchObject({ termination_registered: true, supply_continues: true, break_fee_review_contract_ids: [ids.contract],
        contracts: [{ contract_id: ids.contract, planned_end_date: '2026-11-10', break_fee_review: true }] })
      const reviews = await t.ofType('break_fee_review')
      expect(reviews.map(task => [task.status, task.title])).toEqual([['open', 'Bedöm brytavgift vid uppsägning']])
      expect(reviews[0].metadata).toMatchObject({ contract_id: ids.contract, binding_starts_at: '2026-09-01', binding_ends_at: '2027-09-01',
        termination_notice_date: '2026-10-10', contract_end_date: '2026-11-10', end_reason: 'customer_termination', customer_type: customerType,
        charged_automatically: false })
      // Nothing is charged and the supply continues: no final invoice, no other task.
      expect((await t.tasks()).map(task => task.task_type)).toEqual(['break_fee_review'])
      expect(await t.tasks(ids.other)).toEqual([])
    }))
  }

  it('one review per contract: a repeated registration and a later Z05 create no second review', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1, binding: 12 })
    await t.close('2026-10-10', 'terminate', '2026-10-10')
    await t.close('2026-10-12', 'terminate', '2026-10-12')
    await t.receivedEnd('2026-11-01', 'ending')
    expect(await t.ofType('break_fee_review')).toHaveLength(1)
  }))

  it('no review when the notice period ends after the binding (the binding is served)', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1, binding: 1, startsAt: '2026-09-01' })
    const result = await t.close('2026-10-10', 'terminate', '2026-10-10')
    expect(await facts()).toMatchObject({ ended: '2026-11-10' })
    expect(result.break_fee_review_contract_ids).toEqual([])
    expect(await t.ofType('break_fee_review')).toEqual([])
  }))

  it('the binding runs from the first supplied day (H6), not from the planned start', () => t.scenario(async () => {
    // From the planned start 2026-09-01 two months would be served by the planned end 2026-11-10; from the first
    // supplied day 2026-10-05 they run to 2026-12-05.
    await t.seed({ noticeMonths: 1, binding: 2, startsAt: '2026-09-01', supplyStart: '2026-10-05' })
    await t.close('2026-10-10', 'terminate', '2026-10-10')
    expect((await t.ofType('break_fee_review')).map(task => task.metadata.binding_ends_at)).toEqual(['2026-12-05'])
  }))

  it("'Uppsägning mottagen' (the contract card) gets the same end and review", () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1, noticeDays: 14, binding: 24 })
    const end = contractTerminationEndDate({ noticeMonths: 1, noticeDays: 14, terminationNoticeDate: '2026-10-10' })
    expect(end).toBe('2026-11-24')
    await t.service(`select public.gridex_record_customer_contract_event_v1($1,$2,$3,'termination_notice_received','2026-10-10',null,'{}',$4,$5) r`,
      [ids.company, ids.contract, ids.customer, ids.actor, end])
    expect(await review()).toMatchObject({ review_due: true, created: true, planned_end_date: '2026-11-24', binding_ends_at: '2028-09-01' })
    expect(await review()).toMatchObject({ review_due: true, created: false })
    expect(await t.ofType('break_fee_review')).toHaveLength(1)
  }))

  it('a termination without ongoing supply (closed as customer_termination) inside the binding is reviewed too', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1, binding: 12, periodEnd: '2026-10-10' })
    const result = await t.close('2026-10-10', 'terminate', '2026-10-01')
    expect(await facts()).toEqual({ status: 'terminated', reason: 'customer_termination', notice: '2026-10-01', ended: '2026-11-01' })
    expect(result.break_fee_review_contract_ids).toEqual([ids.contract])
    expect((await t.ofType('break_fee_review')).map(task => task.metadata.end_reason)).toEqual(['customer_termination'])
  }))

  it('the review command refuses another role and another tenant, and ignores a contract without a registered termination', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1, binding: 12 })
    await expect(t.asRole('authenticated', `select public.gridex_termination_break_fee_review_v1($1,$2,$3) r`, [ids.company, ids.contract, ids.actor]))
      .rejects.toThrow(/customer_termination_service_role_required/)
    await expect(t.service(`select public.gridex_termination_break_fee_review_v1($1,$2,$3) r`, [ids.other, ids.contract, ids.actor]))
      .rejects.toThrow(/customer_contract_not_found_for_tenant/)
    expect(await review()).toMatchObject({ review_due: false, reason: 'no_registered_termination' })
    expect(await t.tasks()).toEqual([])
  }))

  it('the SQL termination end equals the TypeScript mirror', () => t.scenario(async () => {
    const cases: Array<[string | null, string | null, number, number | null, number | null]> = [
      ['2026-09-01', null, 12, 1, 14], ['2026-09-01', '2027-09-01', 12, 1, 0], ['2026-01-31', null, 0, 1, 0], ['2026-09-01', '2027-09-01', 12, null, null]]
    for (const [startsAt, endsAt, binding, months, days] of cases) {
      for (const notice of ['2026-10-10', null]) {
        const [{ r }] = await t.q(`select public.gridex_contract_termination_end_v1($1,$2,$3,$4,$5,$6)::text r`, [startsAt, endsAt, binding, months, days, notice])
        expect(r, `${startsAt} ${endsAt} ${binding} ${months} ${days} ${notice}`)
          .toBe(contractTerminationEndDate({ endsAt, noticeMonths: months, noticeDays: days, terminationNoticeDate: notice }))
      }
    }
  }))
})

describe('H3d B6 the Z08 task is created in good time before the planned end', () => {
  it(`is created ${TERMINATION_Z08_TASK_LEAD_DAYS} days before the planned end, due on it, once`, () => t.scenario(async () => {
    expect(TERMINATION_Z08_TASK_LEAD_DAYS).toBe(14)
    await t.seed({ noticeMonths: 1 })
    await t.close('2026-10-10', 'terminate', '2026-10-10')
    expect(await t.expiry('2026-10-26')).toMatchObject({ tasks_created: 0 })
    expect(await t.expiry('2026-10-27')).toMatchObject({ tasks_created: 1, contract_ids: [ids.contract], lead_days: TERMINATION_Z08_TASK_LEAD_DAYS })
    expect(await t.expiry('2026-11-10')).toMatchObject({ tasks_created: 0, tasks_closed: 0 })
    const [task, ...more] = await t.ofType('termination_end_of_supply_pending')
    expect(more).toEqual([])
    expect([task.status, task.title, task.metadata.planned_end_date, task.metadata.lead_days, task.metadata.created_before_end_days, task.metadata.sent_automatically])
      .toEqual(['open', 'Skicka avslut (Z08) till nätägaren', '2026-11-10', 14, 14, false])
    expect(task.due_at?.toISOString()).toBe('2026-11-09T23:00:00.000Z')
    expect(task.description).toMatch(/i god tid före 2026-11-10.*stängs automatiskt om en ny leverantörs Z05/)
    expect(await t.tasks(ids.other)).toEqual([])
  }))

  it("a new supplier's Z05 that ends the supply first closes the open task with its reason", () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1 })
    await t.close('2026-10-10', 'terminate', '2026-10-10')
    await t.expiry('2026-10-28')
    await t.receivedEnd('2026-11-05', 'ending')
    const [task] = await t.ofType('termination_end_of_supply_pending')
    expect([task.status, task.metadata.closed_automatically, task.metadata.closed_reason, task.metadata.closed_supply_end_date, task.metadata.closed_supply_period_id])
      .toEqual(['cancelled', true, 'supply_ended_by_received_end', '2026-11-05', ids.supply])
    expect(task.resolved_at).not.toBeNull()
    expect(await t.expiry('2026-11-30')).toMatchObject({ tasks_created: 0, tasks_closed: 0 })
    expect(await t.ofType('termination_end_of_supply_pending')).toHaveLength(1)
  }))

  it('the daily check closes an open task whose supply already ended by the planned end, and reopens none', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1 })
    await t.close('2026-10-10', 'terminate', '2026-10-10')
    await t.expiry('2026-10-28')
    await t.q(`update public.customer_supply_periods set end_date='2026-11-03' where id=$1`, [ids.supply])
    expect(await t.expiry('2026-10-29')).toMatchObject({ tasks_created: 0, tasks_closed: 1 })
    expect((await t.ofType('termination_end_of_supply_pending')).map(task => [task.status, task.metadata.closed_reason]))
      .toEqual([['cancelled', 'supply_ended_before_z08']])
  }))

  it('an automatically closed task does not block a new one when the supply resumes beyond the planned end', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1 })
    await t.close('2026-10-10', 'terminate', '2026-10-10')
    await t.expiry('2026-10-28')
    await t.q(`update public.customer_supply_periods set end_date='2026-11-03' where id=$1`, [ids.supply])
    await t.expiry('2026-10-29')
    await t.q(`update public.customer_supply_periods set end_date=null where id=$1`, [ids.supply])
    expect(await t.expiry('2026-10-30')).toMatchObject({ tasks_created: 1 })
    expect((await t.ofType('termination_end_of_supply_pending')).map(task => task.status)).toEqual(['cancelled', 'open'])
  }))

  it("another tenant's Z05 and check leave the tenant's task untouched", () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1 })
    await t.close('2026-10-10', 'terminate', '2026-10-10')
    await t.expiry('2026-10-28', ids.company)
    await t.receivedEnd('2026-11-05', 'ending', ids.otherSupply)
    expect(await t.expiry('2026-10-29', ids.other)).toMatchObject({ tasks_created: 0, tasks_closed: 0 })
    expect((await t.ofType('termination_end_of_supply_pending')).map(task => task.status)).toEqual(['open'])
  }))
})

describe('H3d B7 a Z05 L before the planned end keeps the planned end and is reviewed inside the binding', () => {
  it('a registered termination inside the binding: the Z05 keeps the planned end, one review, the Z08 task closes', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 2, binding: 12 })
    await t.close('2026-10-10', 'terminate', '2026-10-10')
    await t.expiry('2026-11-30')
    await t.receivedEnd('2026-11-20', 'ending')
    expect(await facts()).toEqual({ status: 'terminated', reason: 'supply_end', notice: '2026-10-10', ended: '2026-12-10' })
    expect((await t.ofType('break_fee_review')).map(task => task.metadata.end_reason)).toEqual(['customer_termination'])
    expect((await t.ofType('termination_end_of_supply_pending')).map(task => [task.status, task.metadata.closed_reason]))
      .toEqual([['cancelled', 'supply_ended_by_received_end']])
  }))

  it('a notice that ends after the binding, but a Z05 L inside it, is reviewed by the Z05', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 2, binding: 3, startsAt: '2026-09-01' })
    await t.close('2026-10-10', 'terminate', '2026-10-10')
    expect(await t.ofType('break_fee_review')).toEqual([])
    await t.receivedEnd('2026-11-20', 'ending')
    expect(await facts()).toMatchObject({ ended: '2026-12-10' })
    const reviews = await t.ofType('break_fee_review')
    expect(reviews.map(task => [task.title, task.metadata.binding_ends_at, task.metadata.end_reason, task.metadata.charged_automatically]))
      .toEqual([['Bedöm brytavgift vid leveransslut', '2026-12-01', 'supply_end', false]])
  }))
})
