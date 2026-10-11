// masterplan: SC-046
// An older data version arriving after a newer one keeps its positive APERAK
// but is late older history: the strict persistence validator reads the
// versionState flag and the bound sinks never consume it, so neither the newer
// metering value nor the billing underlay is touched. The SQL consumers' skip
// is proven by the companion PGlite regression.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { validateUtiltsPersistenceResults, type UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'
import { boundFixtureContract, bindingRpcRows } from './helpers/utiltsBoundFixture'
import type { EdielMessageRow } from '@/lib/ediel/types'

const sinks = vi.hoisted(() => ({ store: vi.fn(), readiness: vi.fn(), underlay: vi.fn() }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: sinks.store }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: sinks.readiness }))
vi.mock('@/lib/cis/db', () => ({ ingestBillingUnderlay: sinks.underlay }))
const { ingestBoundUtiltsMetering, createBoundUtiltsBilling } = await import('@/lib/ediel/utilts/consumptionSinks')

const message = { id: 'message-a', company_id: 'tenant-a', environment: 'test', message_code: 'E66' } as EdielMessageRow
function bound(versionState: unknown) {
  const contracts = [boundFixtureContract('OLDER', 7)]
  const input: UtiltsBoundPersistenceInput = { companyId: 'tenant-a', environment: 'test', sourceMessageId: 'message-a', messageCode: 'E66', rawPayload: 'synthetic-original', contracts,
    transactions: [{ transactionId: 'OLDER', disposition: 'accepted', responseType: 'positive_aperak', issueCodes: [], seriesKind: 'actual', meteringPointId: 'point-a', externalMeteringPointId: 'external-a', gridAreaId: null,
      periodStart: null, periodEnd: null, registrationDate: '2026-09-20T08:00:00Z', latestUpdateDate: '2026-09-20T08:00:00Z', resolution: null, unit: 'KWH', reasonForTransaction: null, quantities: [] }] }
  return () => validateUtiltsPersistenceResults(input, bindingRpcRows(input, [{ transactionId: 'OLDER', disposition: 'accepted', responseType: 'positive_aperak', persistenceStatus: 'persisted', versionState }]))
}

beforeEach(() => {
  vi.clearAllMocks()
  sinks.store.mockResolvedValue({ status: 'stored', meteringValue: { id: 'value' } })
  sinks.underlay.mockResolvedValue({ id: 'underlay' })
})

describe('SC-046 late older version is not consumed', () => {
  it('keeps the positive APERAK outcome and marks the row late older history', () => {
    const [row] = bound('late_older_history')()
    expect(row).toMatchObject({ disposition: 'accepted', responseType: 'positive_aperak', persistenceStatus: 'persisted', versionState: 'late_older_history' })
  })
  it('skips late older history in both sinks: no metering write, no billing underlay', async () => {
    const outcomes = bound('late_older_history')()
    await expect(ingestBoundUtiltsMetering({ actorUserId: 'actor', message, boundOutcomes: outcomes })).resolves.toEqual([])
    await expect(createBoundUtiltsBilling({ actorUserId: 'actor', message, boundOutcomes: outcomes, existingBillingUnderlayId: null })).resolves.toBeNull()
    expect(sinks.store).not.toHaveBeenCalled()
    expect(sinks.readiness).not.toHaveBeenCalled()
    expect(sinks.underlay).not.toHaveBeenCalled()
  })
  it('still consumes a current version', async () => {
    const outcomes = bound('current')()
    await ingestBoundUtiltsMetering({ actorUserId: 'actor', message, boundOutcomes: outcomes })
    await createBoundUtiltsBilling({ actorUserId: 'actor', message, boundOutcomes: outcomes, existingBillingUnderlayId: null })
    expect(sinks.store).toHaveBeenCalledTimes(1)
    expect(sinks.underlay).toHaveBeenCalledTimes(1)
  })
  it('refuses an unknown version state', () => {
    expect(bound('stale')).toThrow(/version_state/)
  })
  it('skips the late version in the real SQL consumers without conflict or second underlay (PGlite)', () => {
    const root = process.cwd(), require = createRequire(path.join(root, 'package.json'))
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/ediel-sc-046-late-older-sink-sql-regression.mjs')], { cwd: root, encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite') } })
    expect(result.error, result.stderr).toBeUndefined()
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const line = result.stdout.split('\n').find(l => l.startsWith('SC046_LATE_OLDER_SINK_RESULT '))
    expect(JSON.parse(line!.slice('SC046_LATE_OLDER_SINK_RESULT '.length)).checks).toBe(16)
  }, 125_000)
})
