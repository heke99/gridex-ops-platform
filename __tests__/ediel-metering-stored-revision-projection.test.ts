import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAndStoreMeteringValue, type NormalizedMeteringValueInput } from '@/lib/metering/normalizeMeteringValues'
import { boundFixtureContract } from './helpers/utiltsBoundFixture'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  rpc: vi.fn(),
  event: vi.fn(),
  reads: vi.fn(),
  normalized: [] as Row[],
  metering: [] as Row[],
}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => {} }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: io.event }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: io.rpc,
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      let maximum = Infinity
      const query = {
        select: () => query,
        eq(column: string, value: unknown) { filters.push([column, value]); return query },
        limit(value: number) { maximum = value; return query },
        then: (done: (response: { data: Row[]; error: null }) => unknown) => {
          const sources: Record<string, Row[]> = {
            metering_points: [{ id: point, company_id: company, customer_id: customer, site_id: site, customer_site_id: site, grid_owner_id: owner }],
            metering_values: io.metering,
            normalized_metering_values: io.normalized,
          }
          const rows = sources[table]
          if (!rows) throw new Error(`Unexpected read fixture: ${table}`)
          io.reads(table, Object.fromEntries(filters))
          const data = rows.filter(row => filters.every(([column, value]) => row[column] === value)).slice(0, maximum)
          return Promise.resolve({ data, error: null }).then(done)
        },
      }
      return query
    },
  },
}))

const company = 'tenant-a'
const point = 'point-a'
const customer = 'customer-a'
const site = 'site-a'
const owner = 'owner-a'
const original = boundFixtureContract('T1', 12)
const correction = boundFixtureContract('T2', 18)
const observation = original.observations[0]
const key = [company, point, observation.periodStart, observation.periodEnd,
  observation.registerCode ?? 'default-register', observation.productCode ?? 'default-product', observation.direction, observation.unit].join('|')

function input(source: 'original' | 'correction'): NormalizedMeteringValueInput {
  const contract = source === 'original' ? original : correction
  const value = contract.observations[0]
  return {
    companyId: company, meteringPointId: point, customerId: customer, siteId: site, customerSiteId: site, gridOwnerId: owner,
    periodStart: value.periodStart, periodEnd: value.periodEnd, quantityKwh: value.quantity,
    registerCode: value.registerCode, productCode: value.productCode, direction: value.direction, unit: value.unit,
    sourceType: 'ediel_utilts', sourceMessageId: source, sourceTransactionReference: contract.transactionId,
    immutableAttribution: true, boundObservationOrdinal: value.ordinal, boundContract: contract,
  }
}

function committed(source: 'original' | 'correction') {
  const isOriginal = source === 'original'
  const raw = {
    id: `meter-${source}`,
    company_id: company,
    canonical_dedupe_key: key,
    previous_value_id: isOriginal ? null : 'meter-original',
    source_ediel_message_id: source,
    source_transaction_reference: isOriginal ? original.transactionId : correction.transactionId,
    revision_number: isOriginal ? 1 : 2,
  }
  if (!isOriginal) {
    Object.assign(io.normalized[0], { revision_status: 'replaced', status: 'replaced', replaced_by_value_id: raw.id })
  }
  io.metering.push(raw)
  io.normalized.push({
    id: `normalized-${source}`, company_id: company, revision_status: 'current', status: 'stored', source_metering_value_id: raw.id,
    source_message_id: raw.source_ediel_message_id, source_transaction_reference: raw.source_transaction_reference,
  })
  return { data: raw, error: null }
}

function signal() {
  let send!: () => void
  const promise = new Promise<void>(resolve => { send = resolve })
  return { send, promise }
}

beforeEach(() => {
  vi.resetAllMocks()
  io.normalized.length = 0
  io.metering.length = 0
})

describe('receipt for an applied bound UTILTS metering revision', () => {
  it('keeps the same source revision when a correction commits before the original readback', async () => {
    const originalCommitted = signal()
    const resumeOriginal = signal()
    io.rpc.mockImplementation(async (name, args) => {
      expect(name).toBe('gridex_consume_utilts_metering_v1')
      if (args.p_source_message_id === 'correction') return committed('correction')
      const receipt = committed('original')
      originalCommitted.send()
      await resumeOriginal.promise
      return receipt
    })
    const originalResult = normalizeAndStoreMeteringValue(input('original'))
    await originalCommitted.promise
    try {
      await expect(normalizeAndStoreMeteringValue(input('correction'))).resolves.toMatchObject({
        status: 'stored', normalizedMeteringValueId: 'normalized-correction',
      })
    } finally {
      resumeOriginal.send()
    }
    await expect(originalResult).resolves.toMatchObject({
      status: 'stored', meteringValueId: 'meter-original', normalizedMeteringValueId: 'normalized-original',
    })
    expect(io.event.mock.calls.map(([event]) => [event.idempotencyKey, event.payload.normalized_metering_value_id])).toEqual([
      ['metering-values-updated:meter-correction', 'normalized-correction'],
      ['metering-values-updated:meter-original', 'normalized-original'],
    ])
    expect(io.normalized.map(value => value.revision_status)).toEqual(['replaced', 'current'])
  })

  it('keeps the normal single read for a current projection', async () => {
    io.rpc.mockResolvedValue(committed('original'))
    await expect(normalizeAndStoreMeteringValue(input('original'))).resolves.toMatchObject({ status: 'stored' })
    expect(io.reads.mock.calls.map(([table]) => table)).toEqual(['metering_points', 'normalized_metering_values'])
  })

  it.each([
    ['missing projection', (prior: Row) => { io.normalized.splice(io.normalized.indexOf(prior), 1) }],
    ['wrong tenant', (prior: Row) => { prior.company_id = 'tenant-b' }],
    ['wrong receipt tenant', () => { io.metering[0].company_id = 'tenant-b' }],
    ['wrong raw record', (prior: Row) => { prior.source_metering_value_id = 'meter-unrelated' }],
    ['wrong source', (prior: Row) => { prior.source_message_id = 'unrelated' }],
    ['wrong transaction', (prior: Row) => { prior.source_transaction_reference = 'T3' }],
    ['void projection', (prior: Row) => { prior.revision_status = 'void' }],
    ['inconsistent void status', (prior: Row) => { prior.status = 'void' }],
    ['unqualified inactive projection', (prior: Row) => { prior.revision_status = 'superseded' }],
    ['ambiguous replacement', (prior: Row) => { io.normalized.push({ ...prior, id: 'normalized-other' }) }],
    ['missing successor', (prior: Row) => { prior.replaced_by_value_id = null }],
    ['self replacement', (prior: Row) => { prior.replaced_by_value_id = 'meter-original' }],
    ['missing reverse lineage', () => { io.metering[1].previous_value_id = 'meter-unrelated' }],
    ['cross-tenant successor', () => { io.metering[1].company_id = 'tenant-b' }],
    ['unrelated meter key', () => { io.metering[1].canonical_dedupe_key = 'unrelated-key' }],
  ] as const)('holds a receipt with %s', async (_label, corrupt) => {
    io.rpc.mockResolvedValue(committed('original'))
    committed('correction')
    corrupt(io.normalized[0])
    await expect(normalizeAndStoreMeteringValue(input('original'))).rejects.toThrow('atomic_metering_projection_missing_or_ambiguous')
    expect(io.event).not.toHaveBeenCalled()
  })

  it('retains the current-only behavior for a generic BRP import', async () => {
    io.rpc.mockResolvedValue(committed('original'))
    committed('correction')
    await expect(normalizeAndStoreMeteringValue({ ...input('original'), immutableAttribution: false,
      sourceType: 'brp_import', quantityKwh: 12 })).rejects.toThrow('atomic_metering_projection_missing_or_ambiguous')
    expect(io.rpc).toHaveBeenCalledWith('gridex_ingest_metering_value_atomic', expect.anything())
    expect(io.reads.mock.calls.map(([table]) => table)).toEqual(['metering_points', 'normalized_metering_values'])
    expect(io.event).not.toHaveBeenCalled()
  })
})
