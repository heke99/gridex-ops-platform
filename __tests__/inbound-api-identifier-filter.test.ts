// Real inbound evaluator and payload parser; finite PostgREST transport only.
// No PostgreSQL, provider, RPC or Ediel coverage approval is executed here.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, reads: [] as Array<{ table: string; filters: Record<string, unknown>; or: string }>, writes: [] as Array<{ table: string; payload: Row }> }))

// Split the OR syntax at commas outside quoted values. An escaped quote does
// not end a quoted literal. This models the relevant PostgREST boundary only.
function conditions(source: string): string[] {
  const result: string[] = []; let quoted = false; let escaped = false; let start = 0
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (escaped) { escaped = false; continue }
    if (quoted && char === '\\') { escaped = true; continue }
    if (char === '"') quoted = !quoted
    if (char === ',' && !quoted) { result.push(source.slice(start, index)); start = index + 1 }
  }
  if (quoted) throw new Error('Unterminated PostgREST literal')
  result.push(source.slice(start))
  return result
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: Record<string, unknown> = {}; disjunction = ''; payload: Row | null = null; maximum = Infinity
    constructor(readonly table: string) {}
    select() { return this }
    eq(key: string, value: unknown) { this.filters[key] = value; return this }
    in(key: string, value: unknown[]) { this.filters[key] = value; return this }
    order() { return this }
    limit(value: number) { this.maximum = value; return this }
    or(value: string) { this.disjunction = value; return this }
    upsert(value: Row) { this.payload = value; return this }
    async run(single = false) {
      if (!(this.table in io.rows)) throw new Error(`Undeclared transport table: ${this.table}`)
      if (this.payload) {
        io.writes.push({ table: this.table, payload: structuredClone(this.payload) })
        return { data: { id: 'synthetic-decision', ...this.payload }, error: null }
      }
      io.reads.push({ table: this.table, filters: structuredClone(this.filters), or: this.disjunction })
      const alternatives = this.disjunction ? conditions(this.disjunction).map(condition => {
        const matched = /^([a-z_]+)\.eq\.(.*)$/.exec(condition)
        if (!matched) throw new Error('Unexpected PostgREST condition')
        return [matched[1], matched[2].startsWith('"') ? JSON.parse(matched[2]) : matched[2]]
      }) : []
      const rows = io.rows[this.table].filter(row => Object.entries(this.filters).every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value) && (!alternatives.length || alternatives.some(([key, value]) => row[key] === value))).slice(0, this.maximum)
      return { data: single ? rows[0] ?? null : rows, error: null }
    }
    maybeSingle() { return this.run(true) }
    then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) { return this.run().then(resolve, reject) }
  }
  return { supabaseService: { from: (table: string) => new Query(table) } }
})

import { evaluateInboundEdielRequest } from '@/lib/ediel/inboundRequestAutomation'

const COMPANY = '00000000-0000-4000-8000-000000000001'
const POINT = '00000000-0000-4000-8000-000000000002'
const CUSTOMER = '00000000-0000-4000-8000-000000000003'
const FACILITY = '735999100000000001'

beforeEach(() => {
  io.reads = []; io.writes = []
  io.rows = {
    ediel_messages: [{ id: 'synthetic-message', company_id: COMPANY, raw_payload: null, direction: 'inbound', message_family: 'PRODAT', message_code: 'Z03', sender_ediel_id: 'SYNTHETIC-SENDER', receiver_ediel_id: 'SYNTHETIC-RECEIVER', receiver_sub_address: 'SE1', parsed_payload: { meteringPointId: FACILITY } }],
    metering_points: [{ id: POINT, company_id: COMPANY, customer_id: CUSTOMER, customer_site_id: 'synthetic-site', metering_point_id: FACILITY, normalized_metering_point_id: 'normalized-other', site_facility_id: 'facility-other', anlage_id: 'anlage-other' }],
    customer_contracts: [{ id: 'synthetic-contract', company_id: COMPANY, customer_id: CUSTOMER, status: 'active' }],
    powers_of_attorney: [], ediel_inbound_request_decisions: [], ediel_manual_review_items: [],
  }
})

describe('inbound sender identifiers remain PostgREST text values', () => {
  it.each(['metering_point_id', 'normalized_metering_point_id', 'site_facility_id', 'anlage_id'])('preserves a normal identifier match on %s', async column => {
    const point = io.rows.metering_points[0]
    for (const key of ['metering_point_id', 'normalized_metering_point_id', 'site_facility_id', 'anlage_id']) point[key] = 'other'
    point[column] = FACILITY
    io.rows.ediel_messages[0].parsed_payload = column === 'site_facility_id' || column === 'anlage_id' ? { facilityId: FACILITY } : { meteringPointId: FACILITY }
    const decision = await evaluateInboundEdielRequest({ companyId: COMPANY, messageId: 'synthetic-message' })
    expect(decision).toMatchObject({ decision_status: 'ready_to_answer', matched_metering_point_id: POINT, matched_customer_id: CUSTOMER, authorization_status: 'active_contract' })
    expect(io.reads.find(read => read.table === 'metering_points')?.filters).toEqual({ company_id: COMPANY })
    expect(io.reads.find(read => read.table === 'ediel_messages')?.filters).toEqual({ id: 'synthetic-message', company_id: COMPANY })
  })

  it.each([
    ['meteringPointId', `missing,id.eq.${POINT}`],
    ['facilityId', `missing,id.eq.${POINT}`],
    ['meteringPointId', `missing\",id.eq.${POINT}`],
    ['facilityId', `missing\\\",id.eq.${POINT}`],
  ])('cannot add a point-id condition through %s = %s', async (field, identifier) => {
    io.rows.ediel_messages[0].parsed_payload = { [field]: identifier }
    const decision = await evaluateInboundEdielRequest({ companyId: COMPANY, messageId: 'synthetic-message' })
    expect(decision).toMatchObject({ decision_status: 'pending_review', matched_metering_point_id: null, matched_customer_id: null, authorization_status: null })
    expect(io.reads.some(read => read.table === 'customer_contracts' || read.table === 'powers_of_attorney')).toBe(false)
    const read = io.reads.find(read => read.table === 'metering_points')!
    expect(read.filters).toEqual({ company_id: COMPANY })
    expect(conditions(read.or)).toHaveLength(2)
    expect(io.writes.find(write => write.table === 'ediel_inbound_request_decisions')?.payload).toMatchObject({ company_id: COMPANY, matched_metering_point_id: null, decision_status: 'pending_review' })
  })
})
