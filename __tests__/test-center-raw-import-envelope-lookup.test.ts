// Fakturatest only accepts a whole-month UTILTS E66. With quarter-hour values
// that file is >100 KB, and the duplicate-envelope lookup sent it as a URL
// filter (raw_edifact_payload=eq.<file>): the gateway answered 414 URI too long
// from 16 KB. The lookup must use the hash the same writer stores instead.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Filter = { table: string; method: string; column: string; value: unknown }
const io = vi.hoisted(() => ({ filters: [] as Filter[], inserts: [] as Array<{ table: string; row: Record<string, unknown> }>, existingEnvelope: null as string | null }))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const query: Record<string, unknown> = {}
  const record = (method: string) => (column: string, value?: unknown) => { io.filters.push({ table, method, column, value }); return query }
  for (const method of ['eq', 'is', 'contains', 'or']) query[method] = record(method)
  for (const method of ['select', 'order', 'limit']) query[method] = () => query
  const result = () => table === 'inbound_email_messages'
    ? { data: io.existingEnvelope ? { id: io.existingEnvelope } : null, error: null }
    : table === 'metering_points'
      ? { data: [{ id: 'mp-1' }], error: null }
      : table === 'ediel_messages'
        ? { data: [{ id: 'msg-1', company_id: 'tenant-a', customer_id: 'customer-a', message_family: 'UTILTS', message_code: 'E66', direction: 'inbound', environment: 'test' }], error: null }
        : { data: null, error: null }
  query.insert = (row: Record<string, unknown>) => { io.inserts.push({ table, row }); return { select: () => ({ single: async () => ({ data: { id: row.id }, error: null }) }) } }
  query.maybeSingle = async () => result()
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve)
  return query
} } }))
vi.mock('@/lib/inbound-mail/inboundTenantResolver', () => ({ resolveTenantForInboundEdiel: async () => ({ status: 'resolved', companyId: 'tenant-a', reasons: [] }) }))
vi.mock('@/lib/ediel/testing/invoiceTestEdifactMaterialization', () => ({ materializeInvoiceTestEdifactMasterdata: async () => ({ meteringPointId: 'mp-1' }) }))
vi.mock('@/lib/inbound-mail/edielInboundProcessor', () => ({ processInboundEmailMessage: async () => ({ status: 'processed', companyId: 'tenant-a', parseResultId: 'parse-1' }) }))
vi.mock('@/lib/ediel/testing/testCenterRuntimeChain', () => ({ runTestCenterMeteringToInvoiceChain: async () => ({ status: 'completed' }) }))

import { createHash } from 'node:crypto'
import { importRawEdifactAndRunTestCenterChain } from '@/lib/ediel/testing/testCenterRawEdifactImport'

/** Whole-month (July 2026) energy-only quarter-hour E66: 2,976 SEQ groups. */
function monthlyQuarterE66() {
  const segments = ["UNA:+.? '", "UNB+UNOC:3+91100:ZZ+21660:ZZ+260801:0611+260801061101++23-DDQ-E66-T++1'", "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    "BGM+E66::260+GRIDEX2607E66Q01+9+AB'", "DTM+137:202608010611:203'", "DTM+735:?+0200:406'", "MKS+23+E02::260'",
    "NAD+MS+91100:SVK:260'", "NAD+MR+21660:SVK:260'", "NAD+DDQ'", "IDE+24+GRIDEX2607E66Q01'", "LOC+172+735999260731000007::9'",
    "LOC+239+TES:SVK:260'", "LIN+++8716867000030:::9'", "DTM+324:202607010000202608010000:719'", "DTM+597:202608010611:203'",
    "DTM+354:15:806'", "STS+7++E88::260'", "MEA+AAZ++KWH'", "CCI+++E12::260'", "CAV+E17::260'"]
  const start = Date.UTC(2026, 6, 1)
  for (let index = 0; index < 31 * 96; index += 1) {
    const at = new Date(start + index * 15 * 60_000).toISOString().replace(/[-:T]/g, '').slice(0, 12)
    segments.push(`SEQ++${index + 1}'`, `QTY+136:0.${String(100 + (index % 800)).padStart(3, '0')}'`, `DTM+597:${at}:203'`, "STS+7++21::260'")
  }
  segments.push(`UNT+${segments.length - 1}+1'`, "UNZ+1+260801061101'")
  return segments.join('\n')
}

const input = (rawEdifact: string) => ({ actorUserId: 'actor-1', companyId: 'tenant-a', customerId: 'customer-a', billingMonth: '2026-07', rawEdifact, filename: 'E66_2026-07.edi' })

describe('Fakturatest raw import envelope lookup', () => {
  beforeEach(() => { io.filters = []; io.inserts = []; io.existingEnvelope = null })

  it('finds an earlier envelope by hash, never by putting the month file in the URL', async () => {
    const raw = monthlyQuarterE66()
    expect(Buffer.byteLength(raw)).toBeGreaterThan(100_000)
    await importRawEdifactAndRunTestCenterChain(input(raw))
    const lookups = io.filters.filter((filter) => filter.table === 'inbound_email_messages')
    expect(lookups.some((filter) => filter.column === 'raw_edifact_payload')).toBe(false)
    expect(lookups.every((filter) => JSON.stringify(filter.value ?? '').length < 1_000)).toBe(true)
    expect(lookups).toContainEqual({ table: 'inbound_email_messages', method: 'contains', column: 'match_payload',
      value: { test_center_customer_id: 'customer-a', sha256: createHash('sha256').update(raw).digest('hex') } })
    expect(io.inserts.filter((insert) => insert.table === 'inbound_email_messages')).toHaveLength(1)
  })

  it('reuses the earlier envelope it finds instead of storing the file again', async () => {
    io.existingEnvelope = 'mail-earlier'
    const result = await importRawEdifactAndRunTestCenterChain(input(monthlyQuarterE66()))
    expect(result).toMatchObject({ inboundEmailMessageId: 'mail-earlier', reusedInboundEnvelope: true })
    expect(io.inserts.filter((insert) => insert.table === 'inbound_email_messages')).toHaveLength(0)
  })
})
