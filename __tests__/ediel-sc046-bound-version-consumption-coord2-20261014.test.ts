// masterplan: SC-046
// SOURCE ONLY: synthetic RPC return metadata and declared metering/readiness/
// billing DATA ports. No PostgreSQL, native ACK, version ordering or real bill.
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boundFixtureContract } from './helpers/utiltsBoundFixture'
import { validateUtiltsConsumptionContract, type UtiltsConsumptionContractV2 } from '@/lib/ediel/utilts/consumptionContract'
import { persistUtiltsTransactionResults, storedUtiltsConsumption, storedUtiltsConsumptionVersionState, validateUtiltsPersistenceResults,
  type UtiltsBoundPersistenceInput, type UtiltsTransactionPersistenceResult } from '@/lib/ediel/utilts/transactionPersistence'
import { createBoundUtiltsBilling, ingestBoundUtiltsMetering } from '@/lib/ediel/utilts/consumptionSinks'
import type { EdielMessageRow } from '@/lib/ediel/types'

const ports = vi.hoisted(() => ({ rpc: vi.fn(), meter: vi.fn(), readiness: vi.fn(), bill: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: ports.rpc } }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: ports.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: ports.readiness }))
vi.mock('@/lib/cis/db', () => ({ ingestBillingUnderlay: ports.bill }))

type State = 'current' | 'late_older_history'
type Returned = UtiltsTransactionPersistenceResult & { is_current?: boolean }
const malformedState = (row: Returned, state: unknown) => { (row as unknown as { versionState: unknown }).versionState = state }
const sourceId = 'message-a'
const actor = '00000000-0000-4000-8000-000000000001'
const message = { id: sourceId, company_id: 'tenant-a', environment: 'test', message_code: 'E66' } as EdielMessageRow
function contract(id: string, quantity = '0.1'): UtiltsConsumptionContractV2 {
  const c = boundFixtureContract(id)
  return { ...c, version: 2, projectionVersion: 'utilts-consumption-v2',
    observations: c.observations.map(o => ({ ...o, quantity, quality: 'verified' })) }
}
function fixture(states: readonly (State | undefined)[], quantities?: string[]) {
  const contracts = states.map((_, i) => contract(`T${i + 1}`, quantities?.[i] ?? String(i + 1)))
  const input: UtiltsBoundPersistenceInput = {
    companyId: 'tenant-a', environment: 'test', sourceMessageId: sourceId, messageCode: 'E66',
    rawPayload: "UNH+1+UTILTS:D:08A:UN:S2'BGM+E66'UNT+3+1'", contracts,
    transactions: contracts.map(c => ({ transactionId: c.transactionId, disposition: 'accepted', responseType: 'positive_aperak', issueCodes: [],
      seriesKind: 'actual', meteringPointId: 'point-a', externalMeteringPointId: 'external-a', gridAreaId: null,
      periodStart: null, periodEnd: null, registrationDate: null, latestUpdateDate: null, resolution: null, unit: 'KWH', reasonForTransaction: null, quantities: [] })),
  }
  const rows: Returned[] = contracts.map((c, i) => ({ transactionId: c.transactionId, disposition: 'accepted', responseType: 'positive_aperak', persistenceStatus: 'persisted',
    seriesId: `series-${i}`, contractHash: 'a'.repeat(64), contractVersion: 2, consumptionContract: structuredClone(c),
    sourceBinding: { sourceMessageId: sourceId, rawHash: createHash('sha256').update(input.rawPayload).digest('hex'), boundAt: '2026-10-14T00:00:00Z' },
    ...(states[i] === undefined ? {} : { versionState: states[i] }) }))
  return { input, rows }
}
const sinkInput = (rows: Returned[], selectedMessage = message) => ({ actorUserId: actor, message: selectedMessage, boundOutcomes: rows })
const bill = (rows: Returned[], selectedMessage = message) => createBoundUtiltsBilling({ ...sinkInput(rows, selectedMessage), existingBillingUnderlayId: 'diagnostic-id' })
const meter = (rows: Returned[], selectedMessage = message) => ingestBoundUtiltsMetering(sinkInput(rows, selectedMessage))
const effects = () => ({ meter: ports.meter.mock.calls.length, readiness: ports.readiness.mock.calls.length, bill: ports.bill.mock.calls.length })

beforeEach(() => {
  vi.clearAllMocks()
  ports.meter.mockResolvedValue({ status: 'stored', meteringValue: { id: 'finite-meter' } })
  ports.readiness.mockResolvedValue(undefined)
  ports.bill.mockResolvedValue({ id: 'finite-underlay' })
})

describe('private validated version classification, with legacy explicitly separate', () => {
  it('the real RPC adapter retains accepted positive history while both consumers do nothing', async () => {
    const f = fixture(['late_older_history'])
    ports.rpc.mockResolvedValue({ data: f.rows, error: null })
    const rows = await persistUtiltsTransactionResults({ ...f.input, actorUserId: actor })
    expect(rows[0]).toBe(f.rows[0])
    expect(rows[0]).toMatchObject({ persistenceStatus: 'persisted', disposition: 'accepted', responseType: 'positive_aperak' })
    expect(ports.rpc).toHaveBeenCalledWith('gridex_persist_utilts_consumption_v1', expect.objectContaining({ p_actor_user_id: actor, p_source_message_id: sourceId, p_raw_payload: f.input.rawPayload }))
    expect(await meter(f.rows)).toEqual([])
    expect(await bill(f.rows)).toBeNull()
    expect(effects()).toEqual({ meter: 0, readiness: 0, bill: 0 })
  })
  it.each(['current', 'late_older_history'] as const)('captures %s instead of trusting later state/contract/is_current changes', async state => {
    const f = fixture([state], ['0.12345678901234567890123456789'])
    validateUtiltsPersistenceResults(f.input, f.rows)
    f.rows[0].versionState = state === 'current' ? 'late_older_history' : 'current'
    f.rows[0].is_current = state !== 'current'
    f.rows[0].consumptionContract!.observations[0].quantity = '999'
    f.input.contracts[0].observations[0].quantity = '777'
    const read = storedUtiltsConsumption(f.rows[0], sourceId)!
    read.observations[0].quantity = '888'
    expect(storedUtiltsConsumption(f.rows[0], sourceId)!.observations[0].quantity).toBe('0.12345678901234567890123456789')
    expect(storedUtiltsConsumptionVersionState(f.rows[0], sourceId)).toBe(state)
    await meter(f.rows); await bill(f.rows)
    if (state === 'current') {
      expect(ports.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: '0.12345678901234567890123456789', qualityStatus: 'verified' }))
      expect(ports.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: '0.12345678901234567890123456789' }))
      expect(effects()).toEqual({ meter: 1, readiness: 1, bill: 1 })
    } else expect(effects()).toEqual({ meter: 0, readiness: 0, bill: 0 })
  })
  it('missing versionState retains the explicit legacy ABI, without treating is_current as classification', async () => {
    const f = fixture([undefined], ['0'])
    f.rows[0].is_current = false
    validateUtiltsPersistenceResults(f.input, f.rows)
    expect(storedUtiltsConsumption(f.rows[0], sourceId)).toEqual(f.input.contracts[0])
    expect(storedUtiltsConsumptionVersionState(f.rows[0], sourceId)).toBe('legacy_unspecified')
    expect(storedUtiltsConsumptionVersionState(f.rows[0], 'foreign')).toBeNull()
    await meter(f.rows); await bill(f.rows)
    expect(ports.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: '0', qualityStatus: 'verified' }))
    expect(ports.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: '0' }))
  })
  it('retains numeric V1 legacy consumption and an injected late marker cannot suppress it', async () => {
    const f = fixture([undefined])
    const legacy = boundFixtureContract('T1', 0.25)
    f.input = { ...f.input, contracts: [legacy] }
    Object.assign(f.rows[0], { consumptionContract: structuredClone(legacy), contractVersion: 1 })
    validateUtiltsPersistenceResults(f.input, f.rows)
    f.rows[0].versionState = 'late_older_history'
    expect(storedUtiltsConsumptionVersionState(f.rows[0], sourceId)).toBe('legacy_unspecified')
    expect(storedUtiltsConsumption(f.rows[0], sourceId)).toEqual(legacy)
    await meter(f.rows); await bill(f.rows)
    expect(ports.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: 0.25 }))
    expect(ports.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: '0.25' }))
  })
  it.each([null, true, false, 0, '', 'CURRENT', 'historical', 'legacy_unspecified', {}, [], undefined])('refuses provided malformed versionState %j, leaving its original object unbound', async state => {
    const f = fixture(['current'])
    malformedState(f.rows[0], state)
    expect(() => validateUtiltsPersistenceResults(f.input, f.rows)).toThrow('version_state')
    expect(storedUtiltsConsumption(f.rows[0], sourceId)).toBeNull()
    await expect(meter(f.rows)).rejects.toThrow('sink_unbound_outcome')
    await expect(bill(f.rows)).rejects.toThrow('sink_unbound_outcome')
    expect(effects()).toEqual({ meter: 0, readiness: 0, bill: 0 })
  })
})

describe('historical exclusion is guarded and does not hide invalid current context', () => {
  it.each([['current', 'late_older_history'], ['late_older_history', 'current']] as const)('consumes only current in %s/%s order', async (first, second) => {
    const states = [first, second]
    const f = fixture(states, ['0.1', '0.2'])
    const historical = states.indexOf('late_older_history')
    f.input.contracts[historical].billing.customerId = 'unrelated-historical-context'
    f.rows[historical].consumptionContract = structuredClone(f.input.contracts[historical])
    validateUtiltsPersistenceResults(f.input, f.rows)
    await meter(f.rows); await bill(f.rows)
    const current = states.indexOf('current')
    expect(ports.meter).toHaveBeenCalledTimes(1)
    expect(ports.meter).toHaveBeenCalledWith(expect.objectContaining({ sourceTransactionReference: `T${current + 1}`, quantityKwh: current === 0 ? '0.1' : '0.2' }))
    expect(ports.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: current === 0 ? '0.1' : '0.2', boundContracts: [f.input.contracts[current]] }))
    expect(ports.readiness).toHaveBeenCalledTimes(1)
  })
  it.each(['id', 'company_id', 'environment', 'message_code'] as const)('validates historical source %s before no-op', async key => {
    const f = fixture(['late_older_history'])
    validateUtiltsPersistenceResults(f.input, f.rows)
    const foreign = { ...message, [key]: key === 'environment' ? 'production' : 'foreign' } as EdielMessageRow
    await expect(meter(f.rows, foreign)).rejects.toThrow(key === 'id' ? 'sink_unbound_outcome' : 'sink_source_scope')
    await expect(bill(f.rows, foreign)).rejects.toThrow(key === 'id' ? 'sink_unbound_outcome' : 'sink_source_scope')
    expect(effects()).toEqual({ meter: 0, readiness: 0, bill: 0 })
  })
  it.each(['current', 'late_older_history'] as const)('cloned %s response cannot acquire authority', async state => {
    const f = fixture([state]); validateUtiltsPersistenceResults(f.input, f.rows)
    const clones = structuredClone(f.rows)
    await expect(meter(clones)).rejects.toThrow('sink_unbound_outcome')
    await expect(bill(clones)).rejects.toThrow('sink_unbound_outcome')
    expect(effects()).toEqual({ meter: 0, readiness: 0, bill: 0 })
  })
  it('history cannot bypass original captured transaction-contract membership', async () => {
    const f = fixture(['late_older_history']); validateUtiltsPersistenceResults(f.input, f.rows)
    f.rows[0].transactionId = 'other'
    await expect(meter(f.rows)).rejects.toThrow('sink_source_scope')
    await expect(bill(f.rows)).rejects.toThrow('sink_source_scope')
    expect(effects()).toEqual({ meter: 0, readiness: 0, bill: 0 })
  })
  it.each([false, true])('retains incompatible current billing contexts with history distractor, reversed=%s', async reverse => {
    const f = fixture(['current', 'current', 'late_older_history'])
    f.input.contracts[1].billing.customerId = 'different-current-customer'
    f.rows[1].consumptionContract = structuredClone(f.input.contracts[1])
    if (reverse) f.rows.reverse()
    validateUtiltsPersistenceResults(f.input, f.rows)
    await expect(bill(f.rows)).rejects.toThrow('billing_context_mismatch')
    expect(effects()).toEqual({ meter: 0, readiness: 0, bill: 0 })
  })
  it('preserves current WRITE+SKIP billing context refusal while excluding history', async () => {
    const f = fixture(['current', 'current', 'late_older_history'])
    f.input.contracts[1].billing.capability = 'skip'
    f.input.contracts[1].billing.reason = 'no_eligible_observations'
    f.input.contracts[1].billingContributionOrdinals = []
    f.rows[1].consumptionContract = structuredClone(f.input.contracts[1])
    validateUtiltsPersistenceResults(f.input, f.rows)
    await expect(bill(f.rows)).rejects.toThrow('billing_context_mismatch')
    expect(ports.bill).not.toHaveBeenCalled()
  })
  it('current decimal addition is exact and history never contributes', async () => {
    const f = fixture(['current', 'current', 'late_older_history'], ['0.1', '0.2', '999.999'])
    validateUtiltsPersistenceResults(f.input, f.rows)
    await bill(f.rows)
    expect(ports.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: '0.3', boundContracts: f.input.contracts.slice(0, 2) }))
  })
  it('keeps all-NULL contract empty while a verified zero retains its own quality', async () => {
    const f = fixture(['current', 'current', 'late_older_history'], ['0', '0', '10'])
    // Prepared NULL quantities have no consumption observation. This finite
    // port checks retained projection behavior, not SC053 PostgreSQL storage.
    f.input.contracts[0].observations = []
    f.input.contracts[0].billingContributionOrdinals = []
    f.rows[0].consumptionContract = structuredClone(f.input.contracts[0])
    validateUtiltsPersistenceResults(f.input, f.rows)
    await meter(f.rows); await bill(f.rows)
    expect(ports.meter).toHaveBeenCalledTimes(1)
    expect(ports.meter).toHaveBeenCalledWith(expect.objectContaining({ sourceTransactionReference: 'T2', quantityKwh: '0', qualityStatus: 'verified' }))
    expect(ports.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: '0' }))
  })
})

describe('whole-array authority publication is atomic before any consumer effect', () => {
  for (const order of [false, true]) for (const kind of ['returned_contract', 'source_binding', 'version_state'] as const) for (const firstState of ['current', 'late_older_history'] as const) {
    it(`late ${kind} leaves SAME fresh originals unbound; reversed=${order}, valid=${firstState}`, async () => {
      const f = fixture([firstState, firstState === 'current' ? 'late_older_history' : 'current'])
      if (kind === 'returned_contract') f.rows[1].contractHash = 'invalid'
      if (kind === 'source_binding') f.rows[1].sourceBinding!.rawHash = '0'.repeat(64)
      if (kind === 'version_state') malformedState(f.rows[1], 'invalid')
      if (order) f.rows.reverse()
      expect(() => validateUtiltsPersistenceResults(f.input, f.rows)).toThrow(kind)
      for (const row of f.rows) {
        expect(storedUtiltsConsumption(row, sourceId)).toBeNull()
        await expect(meter([row])).rejects.toThrow('sink_unbound_outcome')
        await expect(bill([row])).rejects.toThrow('sink_unbound_outcome')
      }
      expect(effects()).toEqual({ meter: 0, readiness: 0, bill: 0 })
    })
  }
  it('a failed later call preserves authority from a prior separate successful call', async () => {
    const earlier = fixture(['current'], ['0.75'])
    validateUtiltsPersistenceResults(earlier.input, earlier.rows)
    const later = fixture(['current', 'late_older_history'])
    later.rows[0] = earlier.rows[0]
    later.rows[0].versionState = 'late_older_history'
    later.input = { ...later.input, contracts: [structuredClone(earlier.input.contracts[0]), later.input.contracts[1]] }
    later.rows[1].sourceBinding!.sourceMessageId = 'wrong-source'
    expect(() => validateUtiltsPersistenceResults(later.input, later.rows)).toThrow('source_binding')
    expect(storedUtiltsConsumption(later.rows[1], sourceId)).toBeNull()
    expect(storedUtiltsConsumption(earlier.rows[0], sourceId)).toEqual(earlier.input.contracts[0])
    expect(storedUtiltsConsumptionVersionState(earlier.rows[0], sourceId)).toBe('current')
    await meter(earlier.rows); await bill(earlier.rows)
    expect(ports.meter).toHaveBeenCalledWith(expect.objectContaining({ quantityKwh: '0.75' }))
    expect(ports.bill).toHaveBeenCalledWith(expect.objectContaining({ totalKwh: '0.75' }))
  })
  it('the RPC adapter throws on malformed state without authorizing fresh originals', async () => {
    const f = fixture(['current', 'late_older_history']); malformedState(f.rows[1], null)
    ports.rpc.mockResolvedValue({ data: f.rows, error: null })
    await expect(persistUtiltsTransactionResults({ ...f.input, actorUserId: actor })).rejects.toThrow('utilts_transaction_persistence_invalid_result')
    expect(f.rows.map(row => storedUtiltsConsumption(row, sourceId))).toEqual([null, null])
    expect(effects()).toEqual({ meter: 0, readiness: 0, bill: 0 })
  })
  it('fixture contract qualification uses the retained real contract validator', () => {
    const f = fixture(['current', 'late_older_history'])
    expect(f.input.contracts.map(validateUtiltsConsumptionContract)).toEqual(f.input.contracts)
  })
})
