// masterplan: AT-Z10M-SUPPLIER
// UTILTS readings around a Z10 meter exchange link to the correct versioned
// meter/register inventory; the accepted Z04 baseline and earlier readings'
// selection are preserved after the Z10 version is added.
import { expect, it } from 'vitest'
import { compareUtiltsStructure } from '@/lib/ediel/utilts/structuralComparison'
import { selectStructuralSources } from '@/lib/ediel/sources/structuralSourceSelection'
import { comparisonInput, structureVersion, utiltsStructureWire, STRUCTURE_CHANGE, STRUCTURE_POINT } from './helpers/structuralComparisonFixtures'

const baseline = () => structureVersion(1, 'OLD', ['201', '202'])
// Multi-register overlay: the new meter carries a different register inventory.
const exchange = () => structureVersion(2, 'NEW', ['301', '302', '303'])
const versions = () => [baseline(), exchange()]
const compare = (options: Parameters<typeof utiltsStructureWire>[0], list = versions()) => compareUtiltsStructure(comparisonInput(utiltsStructureWire(options), list))

it('the Z10 version carries its own boundary and old/new meter, distinct from the Z04 baseline', () => {
  const [z04, z10] = versions()
  expect(z04.wire).toMatchObject({ messageCode: 'Z04', businessCase: 'supply_baseline', meterNumber: 'OLD', oldMeterNumber: null })
  expect(z10.wire).toMatchObject({ messageCode: 'Z10', businessCase: 'meter_exchange', meterNumber: 'NEW', oldMeterNumber: 'OLD',
    effectiveFrom: { marketMinute: '202610150000', utc: STRUCTURE_CHANGE } })
  expect(z10.sourceMessageId).not.toBe(z04.sourceMessageId)
})

it('old-meter final reading (E30/E24) links to the baseline meter and both old registers', () => {
  const result = compare({ code: 'E30', period: '', reason: 'E24', meter: 'OLD', ids: ['201', '202'] })
  expect(result).toMatchObject({ status: 'matched', codes: [] })
  expect(result.selected).toEqual([expect.objectContaining({ sourceMessageId: baseline().sourceMessageId, meterNumber: 'OLD', registerIds: ['201', '202'],
    meterSourceMessageId: baseline().sourceMessageId, registerSourceMessageId: baseline().sourceMessageId })])
})

it('new-meter start reading (E30/E25) links to the Z10 version, new meter and all three new registers from the boundary', () => {
  const result = compare({ code: 'E30', period: '', reason: 'E25', meter: 'NEW', ids: ['301', '302', '303'] })
  expect(result).toMatchObject({ status: 'matched', codes: [] })
  expect(result.selected).toEqual([expect.objectContaining({ sourceMessageId: exchange().sourceMessageId, effectiveFrom: STRUCTURE_CHANGE,
    meterNumber: 'NEW', registerIds: ['301', '302', '303'], meterSourceMessageId: exchange().sourceMessageId, registerSourceMessageId: exchange().sourceMessageId })])
})

it.each([
  ['old meter on the start reading', { code: 'E30', period: '', reason: 'E25', meter: 'OLD', ids: ['301', '302', '303'] }, ['E61']],
  ['old registers on the start reading', { code: 'E30', period: '', reason: 'E25', meter: 'NEW', ids: ['201', '202'] }, ['E62']],
  ['new meter on the final reading', { code: 'E30', period: '', reason: 'E24', meter: 'NEW', ids: ['201', '202'] }, ['E61']],
  ['new registers on the final reading', { code: 'E30', period: '', reason: 'E24', meter: 'OLD', ids: ['301', '302', '303'] }, ['E62']],
] as const)('a cross-linked %s is a mismatch, never silently re-linked', (_name, options, codes) => {
  expect(compare({ ...options, ids: [...options.ids] })).toMatchObject({ status: 'mismatch', codes })
})

it('interval energies/readings before and after the boundary select their own versions; one spanning it is not guessed', () => {
  expect(compare({ period: '202610010000202610150000', meter: 'OLD', ids: ['201', '202'] }).selected).toEqual([expect.objectContaining({ sourceMessageId: baseline().sourceMessageId })])
  expect(compare({ period: '202610150000202611010000', meter: 'NEW', ids: ['301', '302', '303'] }).selected).toEqual([expect.objectContaining({ sourceMessageId: exchange().sourceMessageId })])
  expect(compare({ period: '202610010000202611010000', meter: 'OLD', ids: ['201', '202'] })).toMatchObject({ status: 'unavailable', reason: 'structural_transition_inside_transaction', codes: [] })
})

it('preserves earlier meter values: the baseline version and pre-boundary selection are unchanged by the Z10 version', () => {
  const list = versions(), frozen = structuredClone(list)
  const query = { ledgerStartedAt: '2026-09-22T09:00:00Z', cutoffAt: '2026-11-02T12:00:00Z', readComplete: true, unresolvedSources: false,
    objectId: STRUCTURE_POINT, identityAgency: '9', legalSender: '12345', legalReceiver: '54321',
    periodStart: '2026-10-05T00:00:00Z', periodEnd: '2026-10-10T00:00:00Z', boundary: 'interval' as const }
  const before = selectStructuralSources({ ...query, versions: [baseline()] })
  const after = selectStructuralSources({ ...query, versions: list })
  expect(after).toEqual(before)
  compare({ code: 'E30', period: '', reason: 'E24', meter: 'OLD' }, list)
  compare({ code: 'E30', period: '', reason: 'E25', meter: 'NEW', ids: ['301', '302', '303'] }, list)
  expect(list).toEqual(frozen)
  // A duplicated Z10 version row is never applied twice: the selection fails
  // closed instead of stacking a second state (storage replay is native-proven).
  expect(selectStructuralSources({ ...query, periodStart: STRUCTURE_CHANGE, periodEnd: '2026-10-20T00:00:00Z', versions: [...list, exchange()] }))
    .toEqual({ status: 'unavailable', reason: 'structural_source_identity_ambiguous' })
})

it('a Z10 whose declared old meter contradicts the predecessor yields no linkage at all', () => {
  const contradictory = exchange(); contradictory.wire.oldMeterNumber = 'UNRELATED'
  expect(compare({ code: 'E30', period: '', reason: 'E25', meter: 'NEW', ids: ['301', '302', '303'] }, [baseline(), contradictory]))
    .toMatchObject({ status: 'unavailable', reason: 'structural_meter_exchange_unresolved', codes: [] })
})
