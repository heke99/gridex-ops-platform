// masterplan: DB-04, AT-DB-04
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  buildDb04Fixture, selectedDb04Schema, assertDb04Measurement, db04VisitedRows,
  type Db04Explain,
} from '../scripts/helpers/ediel-db04-query-fixture'

// Only the Supabase transport is substituted. The production readers below
// construct their real selections; their results and EXPLAIN run in PGlite.
// Selected captured DDL is a finite SQL projection, not full-schema/RLS proof.
const port = vi.hoisted(() => ({ execute: undefined as undefined | ((sql: string) => Promise<unknown[]>), calls: [] as string[] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    const filters: string[] = []; let ordering = '', limit = 100
    const ident = (value: string) => {
      if (!/^[a-z_]+$/.test(value)) throw Error('unexpected_query_identifier')
      return `"${value}"`
    }
    const q = {
      select(columns: string) { if (columns !== '*') throw Error('unexpected_query_projection'); return q },
      eq(column: string, value: string) { filters.push(`${ident(column)}='${value.replaceAll("'", "''")}'`); return q },
      order(column: string, opts: { ascending: boolean }) { ordering = ` ORDER BY ${ident(column)} ${opts.ascending ? 'ASC' : 'DESC'}`; return q },
      limit(value: number) { if (!Number.isInteger(value) || value < 1) throw Error('unexpected_query_limit'); limit = value; return q },
      then(resolve: (result: { data: unknown[]; error: null }) => unknown, reject: (error: unknown) => unknown) {
        const sql = `SELECT * FROM public.${ident(table)}${filters.length ? ' WHERE ' + filters.join(' AND ') : ''}${ordering} LIMIT ${limit}`
        port.calls.push(sql)
        return port.execute!(sql).then(data => resolve({ data, error: null }), reject)
      },
    }
    return q
  },
} }))
import { listEdielMessages, listOverdueAckMessages } from '@/lib/ediel/db'

const fixture = buildDb04Fixture(randomUUID(), randomUUID(), randomUUID(), 'finite_projection')
let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec(selectedDb04Schema(readFileSync('supabase/schema.sql', 'utf8')))
  await db.exec('BEGIN')
  await db.exec(fixture.seedSql)
  port.execute = async sql => (await db.query(sql)).rows
}, 60_000)
afterAll(async () => { await db.exec('ROLLBACK'); await db.close() })

async function measure(sql: string, count: number) {
  const explained = await db.query<{ 'QUERY PLAN': Db04Explain[] }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)
  const plan = explained.rows[0]['QUERY PLAN'][0]
  assertDb04Measurement(plan, count, 500)
  return plan
}

it('executes the actual queue and overdue readers with tenant, order, limit and deadline boundary contrasts', async () => {
  const queue = await listEdielMessages({ companyId: fixture.first, family: 'PRODAT', direction: 'inbound', status: 'failed', limit: 7 })
  expect(queue.map(row => row.id)).toEqual(fixture.expected.sparseQueue.slice(0, 7))
  await measure(port.calls.at(-1)!, queue.length)
  const overdue = await listOverdueAckMessages({ companyId: fixture.first, limit: 100 })
  expect(overdue.map(row => row.id)).toEqual(fixture.expected.sla)
  expect(overdue).toMatchObject(fixture.expected.sla.map(id => ({ id, company_id: fixture.first })))
  await measure(port.calls.at(-1)!, overdue.length)
  expect((await db.query<{ id: string }>(fixture.slaMonitorSql)).rows.map(row => row.id).sort()).toEqual([...fixture.expected.sla].sort())
  await measure(fixture.slaMonitorSql, 2)
  expect((await db.query(fixture.slaCountSql)).rows).toEqual([{ n: 2 }])
  await measure(fixture.slaCountSql, 1)
  for (const state of fixture.ackStates) {
    expect((await db.query(`SELECT id,canonical_ack_state FROM public.ediel_message_ack_state_v WHERE id='${state.id}'`)).rows).toEqual([state])
  }
  const empty = await listEdielMessages({ companyId: randomUUID(), family: 'PRODAT', direction: 'inbound', status: 'received', limit: 7 })
  expect(empty).toEqual([])
  await measure(port.calls.at(-1)!, 0)
})

it('measures selective and dense actor/environment/status/reference/current-version and foreign-key fanout selections', async () => {
  for (const [name, query] of Object.entries(fixture.queries)) {
    const rows = (await db.query<{ id: string }>(query.sql)).rows
    expect(rows.map(row => row.id), name).toEqual(query.ids)
    await measure(query.sql, query.ids.length)
  }
  for (const control of fixture.oppositionControls) {
    expect((await db.query<{ id: string }>(control.sql)).rows.map(row => row.id)).toEqual(control.ids)
  }
  await db.exec(fixture.forbiddenParentsSql)
  expect((await db.query<{ n: number }>('SELECT count(*)::int n FROM public.meter_reading_series')).rows[0].n).toBe(fixture.seriesRows)
})

it('requires measured performance rather than treating installed indexes as approval', async () => {
  const query = fixture.queries.absentSource
  const indexed = await measure(query.sql, 0)
  // This mutation exists only in the disposable selected-DDL projection.
  await db.exec('SAVEPOINT index_control; DROP INDEX public.meter_reading_series_source_message_idx; ANALYZE public.meter_reading_series')
  try {
    const unindexed = await measure(query.sql, 0)
    expect(db04VisitedRows(unindexed.Plan)).toBeGreaterThan(db04VisitedRows(indexed.Plan) + 100)
    expect((await db.query<{ id: string }>(query.sql)).rows.map(row => row.id)).toEqual(query.ids)
    // The same real result/plan must fail an unmet budget even with all other
    // indexes present. Zero is a deliberate refusal control, not an SLA.
    expect(() => assertDb04Measurement(unindexed, 0, 0)).toThrow('db04_measured_budget_exceeded')
  } finally { await db.exec('ROLLBACK TO SAVEPOINT index_control; RELEASE SAVEPOINT index_control') }
})
