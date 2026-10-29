// reality-defects: H3d (slice 2: B1 the contract ends by its notice period while the supply ends on the move-out day;
// D1 notice in days; D3 the customer's notice date is kept; B3/D2/D9 a termination without a move keeps the supply and
// leads to a Z08 task when the notice has expired; H3c open 1 a later Z05 corrects the manual end with one final
// invoice; D5 a retroactive portal move-out; D6 a pending move-in at the new address is kept)
// Owner decisions 2026-10-23 B1, B3 and 20 (OWNER-DECISIONS.md rows 16, 18, 20). Runs the real SQL writers
// (supabase/schema.sql bodies, slice 1 20261023202000) on PGlite with 20261023204000/205000/206000 applied.
// Fail-before evidence: H3D_NOTICE_SHIPPED=1 runs these assertions on the bodies installed in the world before this
// slice (they fail). Synthetic ids only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { createNoticeDb, ids } from '../scripts/helpers/h3d-notice-termination-sql-fixture.mjs'
import { contractNoticeEndDate, contractTerminationEndDate } from '@/lib/customer-contracts/lifecycle'

type Row = Record<string, unknown>
type Task = { task_type: string; status: string; metering_point_id: string | null; site_id: string | null; title: string; description: string; metadata: Row }
type Fixture = {
  db: PGlite
  q: (sql: string, args?: unknown[]) => Promise<Row[]>
  service: (sql: string, args?: unknown[]) => Promise<Row>
  asRole: (role: string, sql: string, args?: unknown[]) => Promise<Row>
  seed: (input?: Row) => Promise<void>
  close: (date: string, mode?: string, noticeDate?: string | null, company?: string) => Promise<Row>
  closeV1: (date: string, mode?: string) => Promise<Row>
  endSupply: (date: string, reason?: string) => Promise<Row>
  expiry: (asOf: string, company?: string | null) => Promise<Row>
  receivedEnd: (date: string, status?: string, id?: string) => Promise<unknown>
  tasks: (company?: string) => Promise<Task[]>
  ofType: (type: string, company?: string) => Promise<Task[]>
  contractRow: (id?: string) => Promise<Row>
  periodRow: (id?: string) => Promise<Row>
  customerRow: (id?: string) => Promise<Row>
  lifecycleEvents: () => Promise<Row[]>
  scenario: <T>(fn: () => Promise<T>) => Promise<T>
}

let t: Fixture
beforeAll(async () => {
  t = await createNoticeDb({ PGlite, shipped: process.env.H3D_NOTICE_SHIPPED === '1' }) as Fixture
}, 60_000)
afterAll(async () => { await t?.db.close() })

const contractFacts = async (id?: string) => {
  const row = await t.contractRow(id)
  return { status: row.status, reason: row.termination_reason, notice: row.notice, ended: row.ended }
}

describe('H3d B1 a move-out ends the contract by its notice period, the supply on the move-out day', () => {
  for (const customerType of ['private', 'business', 'association']) {
    it(`${customerType}: one month's notice from the customer's notice date, the supply ends on the move-out day`, () => t.scenario(async () => {
      await t.seed({ customerType, noticeMonths: 1 })
      const result = await t.close('2026-10-15', 'move_out', '2026-10-10')
      expect(await contractFacts()).toEqual({ status: 'terminated', reason: 'move_out', notice: '2026-10-10', ended: '2026-11-10' })
      expect(await t.periodRow()).toMatchObject({ status: 'active', end_date: '2026-10-15', actual_end_date: null })
      expect(result.contract_ends).toEqual([expect.objectContaining({ contract_id: ids.contract, notice_end_date: '2026-11-10', ended_at: '2026-11-10', termination_reason: 'move_out' })])
      expect((await t.ofType('final_invoice_pending')).map(task => task.metadata.last_supplied_date)).toEqual(['2026-10-15'])
      expect(await t.customerRow()).toEqual({ status: 'moved', moved_out_at: '2026-10-15' })
      expect(await t.tasks(ids.other)).toEqual([])
      expect((await t.contractRow(ids.otherContract)).status).toBe('active')
    }))
  }

  it('a notice period in days (14 days, D1) runs from the notice date', () => t.scenario(async () => {
    await t.seed({ noticeDays: 14 })
    expect(await t.q(`select notice_days,source from public.customer_contract_notice_terms where customer_contract_id=$1`, [ids.contract]))
      .toEqual([{ notice_days: 14, source: 'operator' }])
    await t.close('2026-10-15', 'move_out', '2026-10-10')
    expect(await contractFacts()).toEqual({ status: 'terminated', reason: 'move_out', notice: '2026-10-10', ended: '2026-10-24' })
  }))

  it('months and days add up (month-end clamped, as the TypeScript mirror)', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1, noticeDays: 14 })
    await t.close('2026-02-01', 'move_out', '2026-01-31')
    expect((await t.contractRow()).ended).toBe('2026-03-14')
    expect(contractNoticeEndDate('2026-01-31', 1, 14)).toBe('2026-03-14')
  }))

  it('without a notice period the contract ends on the last supplied day', () => t.scenario(async () => {
    await t.seed()
    await t.close('2026-10-15', 'move_out', '2026-10-10')
    expect(await contractFacts()).toEqual({ status: 'terminated', reason: 'move_out', notice: '2026-10-10', ended: '2026-10-15' })
  }))

  it('a notice given after the move-out (reported late) still runs its full period; billing stops at the supply end', () => t.scenario(async () => {
    await t.seed({ noticeDays: 14 })
    await t.close('2026-10-15', 'move_out', '2026-10-20')
    expect((await t.contractRow()).ended).toBe('2026-11-03')
    expect((await t.periodRow()).end_date).toBe('2026-10-15')
  }))

  it('D3: an earlier registered notice date is kept and the notice runs from it', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1, noticeDate: '2026-10-01' })
    await t.close('2026-10-15', 'move_out', '2026-10-12')
    expect(await contractFacts()).toEqual({ status: 'terminated', reason: 'move_out', notice: '2026-10-01', ended: '2026-11-01' })
  }))

  it('v1 keeps its signature and delegates (an earlier registered notice date stands)', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1, noticeDate: '2026-10-01' })
    await t.closeV1('2026-10-15')
    expect(await contractFacts()).toEqual({ status: 'terminated', reason: 'move_out', notice: '2026-10-01', ended: '2026-11-01' })
  }))

  it('an ended grid contract ends the supply like a move-out, with its own reason and lifecycle event', () => t.scenario(async () => {
    await t.seed({ customerType: 'business', noticeMonths: 3, binding: 12 })
    const result = await t.close('2026-10-15', 'grid_contract_ended', '2026-10-01')
    expect(await contractFacts()).toEqual({ status: 'terminated', reason: 'grid_contract_ended', notice: '2026-10-01', ended: '2027-01-01' })
    expect((await t.periodRow()).end_date).toBe('2026-10-15')
    expect(await t.customerRow()).toEqual({ status: 'inactive', moved_out_at: '2026-10-15' })
    expect((await t.ofType('final_invoice_pending')).map(task => task.metadata.end_reason)).toEqual(['grid_contract_ended'])
    const [review] = await t.ofType('break_fee_review')
    expect(review).toMatchObject({ title: 'Bedöm brytavgift när nätavtalet upphört' })
    expect(review.metadata).toMatchObject({ end_reason: 'grid_contract_ended', charged_automatically: false })
    expect((await t.lifecycleEvents()).map(event => event.event_type)).toEqual(['grid_contract_ended'])
    expect(result.mode).toBe('grid_contract_ended')
  }))

  it("gridex_end_customer_supply_v1('move_out') ends the contract by its notice period as well; 'supplier_switch' on the end date", () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1, noticeDate: '2026-10-05' })
    await t.endSupply('2026-10-15', 'move_out')
    expect(await contractFacts()).toEqual({ status: 'terminated', reason: 'move_out', notice: '2026-10-05', ended: '2026-11-05' })
  }).then(() => t.scenario(async () => {
    await t.seed({ noticeMonths: 1, noticeDate: '2026-10-05' })
    await t.endSupply('2026-10-15', 'supplier_switch')
    expect(await contractFacts()).toEqual({ status: 'terminated', reason: 'supplier_switch', notice: '2026-10-05', ended: '2026-10-15' })
  })))
})

describe('H3d B3/D2/D9 a termination without a move', () => {
  it('registers the termination; the supply, the customer and open work continue', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1 })
    await t.q(`insert into public.customer_operation_tasks(company_id,customer_id,task_type,status,metadata) values($1,$2,'customer_followup','open','{}')`, [ids.company, ids.customer])
    const result = await t.close('2026-10-10', 'terminate', '2026-10-10')
    expect(result).toMatchObject({ termination_registered: true, supply_continues: true,
      contracts: [{ contract_id: ids.contract, termination_notice_date: '2026-10-10', planned_end_date: '2026-11-10' }] })
    expect(await contractFacts()).toEqual({ status: 'active', reason: null, notice: '2026-10-10', ended: '2026-11-10' })
    expect(await t.periodRow()).toMatchObject({ status: 'active', end_date: null })
    expect(await t.customerRow()).toEqual({ status: 'active', moved_out_at: null })
    expect((await t.tasks()).map(task => [task.task_type, task.status])).toEqual([['customer_followup', 'open']])
    expect((await t.lifecycleEvents()).map(event => [event.event_type, event.effective_date])).toEqual([['termination_registered', '2026-10-10']])
  }))

  // Owner decision 2026-10-24 B5 replaced "the later of the notice and the binding end" (slice 3,
  // __tests__/h3d-termination-binding-z08-lead.test.ts has the fee review).
  it("inside the binding the planned end is the notice end (the rule of 'Uppsägning mottagen', contractTerminationEndDate)", () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1, binding: 12, startsAt: '2026-09-01' })
    await t.close('2026-10-10', 'terminate', '2026-10-10')
    expect((await t.contractRow()).ended).toBe('2026-11-10')
    expect(contractTerminationEndDate({ endsAt: '2027-09-01', noticeMonths: 1, terminationNoticeDate: '2026-10-10' })).toBe('2026-11-10')
  }))

  it('without supply ongoing after the date it closes with the reason customer_termination, never move_out (D9)', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1, periodEnd: '2026-10-10' })
    const result = await t.close('2026-10-10', 'terminate', '2026-10-01')
    expect(result.termination_registered).toBeUndefined()
    expect(await contractFacts()).toEqual({ status: 'terminated', reason: 'customer_termination', notice: '2026-10-01', ended: '2026-11-01' })
    expect(await t.customerRow()).toEqual({ status: 'terminated', moved_out_at: '2026-10-10' })
  }))

  // Owner decision 2026-10-24 B6: the task comes 14 days before the planned end (slice 3).
  it('the scheduled check creates one Z08 task in good time before the notice ends without a switch, never earlier, never twice', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1 })
    await t.close('2026-10-10', 'terminate', '2026-10-10')
    expect(await t.expiry('2026-10-26')).toMatchObject({ tasks_created: 0 })
    expect(await t.expiry('2026-10-27')).toMatchObject({ tasks_created: 1, contract_ids: [ids.contract] })
    expect(await t.expiry('2026-11-30')).toMatchObject({ tasks_created: 0 })
    const tasks = await t.ofType('termination_end_of_supply_pending')
    expect(tasks.map(task => [task.status, task.metering_point_id, task.title, task.metadata.planned_end_date, task.metadata.sent_automatically]))
      .toEqual([['open', ids.point, 'Skicka avslut (Z08) till nätägaren', '2026-11-10', false]])
    expect(await t.tasks(ids.other)).toEqual([])
  }))

  it("'Uppsägning mottagen' (termination_notice_received) leads to the same check", () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1 })
    await t.service(`select public.gridex_record_customer_contract_event_v1($1,$2,$3,'termination_notice_received','2026-10-10',null,'{}',null,'2026-11-10') r`, [ids.company, ids.contract, ids.customer])
    expect(await t.expiry('2026-11-10')).toMatchObject({ tasks_created: 1 })
  }))

  it('no Z08 task once a new supplier took over (Z05); the contract keeps its later planned end and the notice date', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 2 })
    await t.close('2026-10-10', 'terminate', '2026-10-10')
    await t.receivedEnd('2026-11-20')
    expect(await contractFacts()).toEqual({ status: 'terminated', reason: 'supply_end', notice: '2026-10-10', ended: '2026-12-10' })
    expect(await t.expiry('2026-12-31')).toMatchObject({ tasks_created: 0 })
  }))

  it('a Z05 after the planned end ends the contract on the supply end', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1 })
    await t.close('2026-10-10', 'terminate', '2026-10-10')
    await t.receivedEnd('2026-11-20')
    expect(await contractFacts()).toEqual({ status: 'terminated', reason: 'supply_end', notice: '2026-10-10', ended: '2026-11-20' })
  }))

  it('refuses another role and another tenant', () => t.scenario(async () => {
    await t.seed({ noticeMonths: 1 })
    await expect(t.asRole('authenticated', `select public.gridex_register_customer_termination_v1($1,$2,$3,'2026-10-10',null,null) r`, [ids.company, ids.customer, ids.actor]))
      .rejects.toThrow(/customer_lifecycle_service_role_required/)
    await expect(t.asRole('authenticated', `select public.gridex_termination_notice_expiry_tasks_v1(null,'2026-11-10') r`)).rejects.toThrow(/customer_termination_service_role_required/)
    await expect(t.service(`select public.gridex_register_customer_termination_v1($1,$2,$3,'2026-10-10',null,null) r`, [ids.other, ids.customer, ids.actor]))
      .rejects.toThrow(/customer_not_found_for_tenant/)
  }))
})

describe('H3c open 1: a later Z05 corrects a manual end', () => {
  it('a later received end corrects the contract end and keeps one final invoice', () => t.scenario(async () => {
    await t.seed()
    await t.close('2026-10-15', 'move_out', '2026-10-10')
    await t.receivedEnd('2026-10-20')
    expect(await contractFacts()).toEqual({ status: 'terminated', reason: 'move_out', notice: '2026-10-10', ended: '2026-10-20' })
    const invoices = await t.ofType('final_invoice_pending')
    expect(invoices.map(task => [task.status, task.metadata.supply_end_date, task.metadata.manual_supply_end_date, task.metadata.supply_period_id]))
      .toEqual([['open', '2026-10-20', '2026-10-15', ids.supply]])
    await t.receivedEnd('2026-10-20')
    expect(await t.ofType('final_invoice_pending')).toHaveLength(1)
  }))

  it('an earlier received end keeps the contract end (the contract may end after its supply)', () => t.scenario(async () => {
    await t.seed()
    await t.close('2026-10-15', 'move_out', '2026-10-10')
    await t.receivedEnd('2026-10-12')
    expect((await t.contractRow()).ended).toBe('2026-10-15')
    expect((await t.ofType('final_invoice_pending')).map(task => task.metadata.supply_end_date)).toEqual(['2026-10-12'])
  }))

  it('after a handled final invoice it asks for a correction review instead of a second final invoice', () => t.scenario(async () => {
    await t.seed()
    await t.close('2026-10-15', 'move_out', '2026-10-10')
    await t.q(`update public.customer_operation_tasks set status='resolved' where task_type='final_invoice_pending'`)
    await t.receivedEnd('2026-10-20')
    expect((await t.ofType('final_invoice_pending')).map(task => task.status)).toEqual(['resolved'])
    expect((await t.ofType('final_invoice_correction_review')).map(task => task.metadata.supply_end_date)).toEqual(['2026-10-20'])
  }))
})

describe('H3d D6 a pending move-in at the new address survives the move-out', () => {
  it('keeps the new site, its point, future period, contract, switch and tasks; the customer stays active', () => t.scenario(async () => {
    await t.seed()
    await t.q(`insert into public.customer_sites(id,company_id,customer_id,status) values($1,$2,$3,'active')`, [ids.newSite, ids.company, ids.customer])
    await t.q(`insert into public.metering_points(id,company_id,customer_id,site_id,status) values($1,$2,$3,$4,'active')`, [ids.newPoint, ids.company, ids.customer, ids.newSite])
    await t.q(`insert into public.customer_contracts(id,company_id,customer_id,metering_point_id,site_id,customer_site_id,status) values($1,$2,$3,$4,$5,$5,'pending_signature')`,
      [ids.newContract, ids.company, ids.customer, ids.newPoint, ids.newSite])
    await t.q(`insert into public.customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,customer_contract_id,start_date,status) values($1,$2,$3,$4,$5,$5,'2026-10-16','confirmed_by_grid_owner')`,
      [ids.newSupply, ids.company, ids.customer, ids.newPoint, ids.newContract])
    await t.q(`insert into public.supplier_switch_requests(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,request_type,process_type,status,customer_contract_id) values($1,$2,$3,$4,$4,$5,'move_in','move_in','submitted',$6)`,
      [ids.moveIn, ids.company, ids.customer, ids.newSite, ids.newPoint, ids.newContract])
    await t.q(`insert into public.customer_operation_tasks(company_id,customer_id,site_id,task_type,status,metadata) values($1,$2,$3,'move_in_followup','open','{}')`, [ids.company, ids.customer, ids.newSite])
    const result = await t.close('2026-10-15', 'move_out', '2026-10-01')
    expect(result.kept_move_in_site_ids).toEqual([ids.newSite])
    expect(await t.q(`select id,status from public.customer_sites where company_id=$1 order by id`, [ids.company])).toEqual([{ id: ids.site, status: 'closed' }, { id: ids.newSite, status: 'active' }])
    expect((await t.q(`select status from public.metering_points where id=$1`, [ids.newPoint]))[0].status).toBe('active')
    expect((await t.periodRow(ids.newSupply)).status).toBe('confirmed_by_grid_owner')
    expect((await t.q(`select status from public.supplier_switch_requests where id=$1`, [ids.moveIn]))[0].status).toBe('submitted')
    expect((await t.contractRow(ids.newContract)).status).toBe('pending_signature')
    expect((await t.ofType('move_in_followup')).map(task => task.status)).toEqual(['open'])
    expect((await t.contractRow()).status).toBe('terminated')
    expect(await t.customerRow()).toEqual({ status: 'active', moved_out_at: '2026-10-15' })
  }))
})

describe('H3d D1 the notice terms are snapshotted and immutable once signed', () => {
  it("snapshots the offer's notice days for a contract created from the offer", () => t.scenario(async () => {
    await t.q(`insert into public.companies values($1) on conflict do nothing`, [ids.company])
    await t.q(`insert into public.contract_offers values($1,$2)`, [ids.offer, ids.company])
    await t.q(`insert into public.contract_offer_notice_terms(contract_offer_id,company_id,notice_days) values($1,$2,10)`, [ids.offer, ids.company])
    await t.seed({ offer: true })
    expect(await t.q(`select notice_days,source,source_contract_offer_id from public.customer_contract_notice_terms where customer_contract_id=$1`, [ids.contract]))
      .toEqual([{ notice_days: 10, source: 'contract_offer', source_contract_offer_id: ids.offer }])
  }))

  it('refuses a change of a signed contract\'s notice days, a notice term added after signing and an invalid value', () => t.scenario(async () => {
    await t.seed({ noticeDays: 14 })
    await expect(t.q(`update public.customer_contract_notice_terms set notice_days=30 where customer_contract_id=$1`, [ids.contract])).rejects.toThrow(/customer_contract_notice_terms_immutable/)
    await expect(t.q(`delete from public.customer_contract_notice_terms where customer_contract_id=$1`, [ids.contract])).rejects.toThrow(/customer_contract_notice_terms_immutable/)
    await expect(t.q(`insert into public.customer_contract_notice_terms(customer_contract_id,company_id,notice_days,source) values($1,$2,30,'operator')`, [ids.otherContract, ids.other]))
      .rejects.toThrow(/signed_customer_contract_immutable:notice_days/)
    await expect(t.q(`insert into public.customer_contract_notice_terms(customer_contract_id,company_id,notice_days,source) values($1,$2,30,'operator')`, [ids.otherContract, ids.company]))
      .rejects.toThrow(/customer_contract_notice_terms_company_mismatch/)
    await expect(t.q(`insert into public.customer_contracts(id,company_id,customer_id,status,metadata) values(gen_random_uuid(),$1,$2,'draft','{"notice_days":400}')`, [ids.company, ids.customer]))
      .rejects.toThrow(/customer_contract_notice_days_invalid/)
  }))

  it('the SQL notice end equals the TypeScript mirror', () => t.scenario(async () => {
    const cases: Array<[string, number | null, number | null]> = [['2026-01-31', 1, 14], ['2028-02-29', 12, 0], ['2026-10-10', null, null], ['2026-10-10', 0, 14], ['2026-12-31', 2, 1]]
    for (const [date, months, days] of cases) {
      const [{ r }] = await t.q(`select public.gridex_contract_notice_end_v1($1,$2,$3)::text r`, [date, months, days])
      expect(r, `${date} +${months}m +${days}d`).toBe(contractNoticeEndDate(date, months, days))
    }
    const [{ r }] = await t.q(`select public.gridex_contract_termination_end_v1('2026-09-01',null,12,1,14,'2026-10-10')::text r`)
    expect(r).toBe(contractTerminationEndDate({ noticeMonths: 1, noticeDays: 14, terminationNoticeDate: '2026-10-10' }))
  }))
})

describe('H3d D5 a customer who already moved can report it through the portal API', () => {
  const submit = (date: string) => t.service(`select public.gridex_submit_customer_move_out_v1($1) r`, [{ company_id: ids.company, customer_id: ids.customer, api_client_id: ids.apiClient,
    idempotency_key: 'h3d-d5-' + date, facility_reference: 'FAC-1', requested_move_out_date: date }])
  const stockholmToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm' }).format(new Date())
  const shift = (days: number) => new Date(Date.parse(stockholmToday() + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10)

  it('accepts up to 30 days back as a retroactive review case, refuses older dates', () => t.scenario(async () => {
    await t.seed()
    await submit(shift(-10))
    await submit(shift(-30))
    await expect(submit(shift(-31))).rejects.toThrow(/customer_move_out_date_invalid/)
    await submit(shift(5))
    const cases = await t.q(`select priority,title,next_action,metadata from public.customer_cases where company_id=$1 order by metadata->>'requested_move_out_date'`, [ids.company])
    expect(cases.map(row => [row.priority, row.title, row.next_action, (row.metadata as Row).retroactive])).toEqual([
      ['high', 'Utflyttningsanmälan (retroaktiv)', 'review_move_out_submission', true],
      ['high', 'Utflyttningsanmälan (retroaktiv)', 'review_move_out_submission', true],
      ['normal', 'Utflyttningsanmälan', 'review_move_out_submission', false]])
    expect(await t.periodRow()).toMatchObject({ status: 'active', end_date: null })
  }))
})
