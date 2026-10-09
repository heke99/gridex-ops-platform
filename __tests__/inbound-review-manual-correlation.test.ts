// inbound-review: coordinator-8 (same-domain sender with exact case reference)
// inbound-review: coordinator-17 (cross-tenant facility id vs exact case reference)
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }))

vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: ((row: Row) => boolean)[] = []
    constructor(private table: string) {}
    select() { return this }
    order() { return this }
    limit() { return this }
    not() { return this }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this }
    in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this }
    ilike(column: string, value: string) {
      const expected = value.replace(/\\([\\%_])/g, '$1').toLowerCase()
      this.filters.push((row) => String(row[column] ?? '').toLowerCase() === expected)
      return this
    }
    or(expression: string) {
      const clauses = expression.split(',').map((clause) => /^(\w+)\.eq\.(.+)$/.exec(clause)).filter(Boolean) as RegExpExecArray[]
      this.filters.push((row) => clauses.some(([, column, value]) => String(row[column]) === value))
      return this
    }
    private rows() { return (io.tables[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row))) }
    maybeSingle() { return Promise.resolve({ data: this.rows()[0] ?? null, error: null }) }
    then<T>(resolve: (value: { data: Row[]; error: null }) => T, reject?: (reason: unknown) => T) {
      return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject)
    }
  }
  return { supabaseService: { from: (table: string) => new Query(table) } }
})

import { resolveManualInboundCorrelation } from '@/lib/inbound-mail/manualInboundCorrelation'

const FACILITY = '735999100000000001'
const request = {
  id: 'req-1', company_id: 'co-1', customer_id: 'cu-1', customer_site_id: 'site-1', grid_owner_id: 'go-1',
  case_reference: 'GX-FIR-ABCDEF12', status: 'waiting_manual_response', request_type: 'facility_identifier_lookup',
  recipient_email: 'kundservice@natagare.se',
}

const run = (fromEmail: string) => resolveManualInboundCorrelation({
  email: { mailbox: 'leverantorsbyte@gridex.se', mailboxCompanyId: null, fromEmail, toEmail: null, threadId: null, inReplyTo: null, references: [] },
  caseReference: 'GX-FIR-ABCDEF12',
  normalizedText: `Re: [GX-FIR-ABCDEF12] Anläggnings-ID ${FACILITY}`,
  extracted: { facility_id: FACILITY } as never,
})

beforeEach(() => {
  io.tables = {
    grid_owner_information_requests: [request],
    grid_owner_contact_channels: [{ grid_owner_id: 'go-1', company_id: null, email: 'kundservice@natagare.se', is_enabled: true, is_verified: true }],
    customer_sites: [{ id: 'site-1', company_id: 'co-1', customer_id: 'cu-1', grid_owner_id: 'go-1', facility_id: FACILITY }],
    metering_points: [],
    customers: [],
  }
})

describe('coordinator #17 exact case reference outweighs facility-only evidence', () => {
  it('a facility id that only resolves to another tenant does not make a credible case-reference reply ambiguous', async () => {
    io.tables.customer_sites[0].facility_id = null
    io.tables.customer_sites.push({ id: 'site-x', company_id: 'co-2', customer_id: 'cu-x', grid_owner_id: 'go-1', facility_id: FACILITY })
    const result = await run('kundservice@natagare.se')
    expect(result.resolutionStatus).toBe('matched')
    expect(result.companyId).toBe('co-1')
    expect(result.requestId).toBe('req-1')
    expect(result.senderCredible).toBe(true)
  })

  it('without a credible sender the cross-tenant facility still blocks attribution', async () => {
    io.tables.customer_sites[0].facility_id = null
    io.tables.customer_sites.push({ id: 'site-x', company_id: 'co-2', customer_id: 'cu-x', grid_owner_id: 'go-1', facility_id: FACILITY })
    const result = await run('someone@elsewhere.example')
    expect(result.resolutionStatus).toBe('ambiguous')
  })
})

describe('coordinator #8 same-domain non-contact sender is reviewed, not ignored', () => {
  it('exact case reference from another address of the grid owner domain -> matched for review, never credible', async () => {
    const result = await run('anna.andersson@natagare.se')
    expect(result.resolutionStatus).toBe('matched')
    expect(result.senderCredible).toBe(false)
    expect(result.requestId).toBe('req-1')
    expect(result.evidence.review_reason).toBe('case_reference_grid_owner_domain_sender')
  })

  it('a foreign domain stays ignored', async () => {
    const result = await run('spam@other.example')
    expect(result.resolutionStatus).toBe('ignored')
  })
})
