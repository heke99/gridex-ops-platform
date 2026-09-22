import { test } from 'vitest'
import assert from 'node:assert/strict'
import { inspectDurableReceivedSourceInventory as inspect, parseSourceReceiptInstant as instant, type DurableReceivedSourceInventory } from '@/lib/ediel/utilts/receivedSourceInventory'
// Hostile snapshots intentionally remain unknown records: validation is the subject.
import { COMPANY, OTHER, SOURCE, child, wire, row, snapshot, run, type FixtureRow } from '@/__tests__/helpers/receivedSourceInventoryFixtures'
const hidden = (result: DurableReceivedSourceInventory) => {
  assert.deepEqual(result.sources, [])
  assert.equal(result.authorityStatus, 'not_established')
  assert.equal(result.selection, 'not_performed')
  assert.ok(!JSON.stringify(result).includes('MP-A'))
}
test('all physical objects are discovered without a metering_point_id link', () => {
  const result = run()
  assert.equal(result.status, 'enumerated')
  assert.deepEqual(result.sources[0].objects.map(x => [x.objectId, x.identityAgency]), [['MP-A', '9'], ['MP-B', '89']])
  assert.equal(result.sources[0].occurrences.length, 2)
  assert.equal(result.sources[0].disposition, 'not_checked')
  assert.equal(result.historyCoverage, 'before_ledger_unknown')
  assert.equal(result.authorityStatus, 'not_established')
  assert.equal(result.selection, 'not_performed')
})
test('a false or absent mutable metering link does not filter any object', () => {
  const a = run(snapshot([row({ metering_point_id: 'wrong', status: 'rejected' })]))
  const b = run(snapshot([row({ metering_point_id: null, status: 'accepted' })]))
  assert.deepEqual(a, b)
})
test('register repeats retain each physical occurrence instead of being deduplicated', () => {
  const result = run(snapshot([row({ rawPayload: wire(['LIN+1++MP-A:::9', 'LIN+2++MP-A:::9', 'LIN+3++MP-B:::9']) })]))
  assert.equal(result.status, 'enumerated')
  assert.deepEqual(result.sources[0].objects[0].occurrenceOrdinals, [1, 2])
  assert.equal(result.sources[0].occurrences.length, 3)
})
test('same object text with distinct agencies remains distinct', () => {
  const result = run(snapshot([row({ rawPayload: wire(['LIN+1++MP-A:::9', 'LIN+2++MP-A:::89']) })]))
  assert.equal(result.sources[0].objects.length, 2)
})
test('multiple PRODAT messages are all inventoried, not only the first UNH', () => {
  const raw = ['UNB+UNOC:3+111:14+222:14+260922:0900+REF', ...child(['LIN+1++MP-A:::9']), ...child(['LIN+1++MP-C:::9'], 'MSG2'), 'UNZ+2+REF', ''].join("'")
  const result = run(snapshot([row({ rawPayload: raw })]))
  assert.equal(result.status, 'enumerated')
  assert.deepEqual(result.sources[0].objects.map(x => [x.messageIndex, x.objectId]), [[0, 'MP-A'], [1, 'MP-C']])
})
test('same identity in separate UNH scopes retains separate memberships', () => {
  const raw = ['UNB+UNOC:3+111:14+222:14+260922:0900+REF', ...child(['LIN+1++MP-A:::9']), ...child(['LIN+1++MP-A:::9'], 'MSG2'), 'UNZ+2+REF', ''].join("'")
  assert.equal(run(snapshot([row({ rawPayload: raw })])).sources[0].objects.length, 2)
})
test('escaped separators are identity data rather than composite boundaries', () => {
  const result = run(snapshot([row({ rawPayload: wire(['LIN+1++MP?:A?+B:::9']) })]))
  assert.equal(result.sources[0].objects[0].objectId, 'MP:A+B')
})
test('escaped release character is decoded once', () => {
  const result = run(snapshot([row({ rawPayload: wire(['LIN+1++MP??A:::9']) })]))
  assert.equal(result.sources[0].objects[0].objectId, 'MP?A')
})
test('custom UNA follows the repository tokenizer', () => {
  const raw = 'UNA;*.! ~' + wire().replaceAll(':', ';').replaceAll('+', '*').replaceAll("'", '~')
  assert.equal(run(snapshot([row({ rawPayload: raw })])).sources[0].objects[1].objectId, 'MP-B')
})
test('a malformed identity retains its occurrence and blocks complete inventory', () => {
  const result = run(snapshot([row({ rawPayload: wire(['LIN+1++MP-A:::9', 'LIN+2++:::9']) })]))
  assert.equal(result.status, 'incomplete')
  assert.equal(result.sources[0].occurrences.length, 2)
  assert.equal(result.sources[0].occurrences[1].objectId, null)
})
for (const [label, line] of [
  ['missing agency', 'LIN+1++MP-A'], ['unknown agency', 'LIN+1++MP-A:::99'],
  ['extra composite', 'LIN+1++MP-A:::9:extra'], ['leading space identity', 'LIN+1++ MP-A:::9'],
  ['trailing space identity', 'LIN+1++MP-A :::9'], ['control in identity', 'LIN+1++MP\tA:::9'],
  ['too long identity', `LIN+1++${'A'.repeat(129)}:::9`],
] as Array<[string, string]>) test(`${label} is unresolved, not silently repaired or accepted`, () => {
  const result = run(snapshot([row({ rawPayload: wire([line]) })]))
  assert.equal(result.status, 'incomplete')
  assert.equal(result.sources[0].occurrences.length, 1)
  assert.deepEqual(result.sources[0].objects, [])
})
for (const [label, change] of [
  ['wrong company', x => { x.companyId = OTHER }], ['wrong environment', x => { x.environment = 'production' }],
  ['unexpected origin', x => { x.origin = 'legacy_snapshot' }], ['bad source id', x => { x.sourceMessageId = 'no-id' }],
  ['future capture', x => { x.capturedAt = '2026-09-22T10:00:00.000001Z' }],
  ['capture before activation', x => { x.capturedAt = '2026-09-22T07:59:59Z' }],
  ['malformed receipt context', x => { (x as Record<string, unknown>).receivedContext = [] }],
  ['wrong context company', x => { x.receivedContext.companyId = OTHER }],
  ['wrong context hash', x => { x.receivedContext.payloadHash = 'a'.repeat(64) }],
  ['wrong context source', x => { x.receivedContext.sourceMessageId = SOURCE }],
  ['wrong context origin', x => { x.receivedContext.contextOrigin = 'backfill' }],
  ['wrong context time', x => { x.receivedContext.sourceReceivedAt = '2026-09-22T09:00:00.000000Z' }],
  ['context after ledger capture', x => { x.receivedContext.capturedAt = '2026-09-22T09:00:00.000004Z' }],
] as Array<[string, (x: FixtureRow) => void]>) test(`whole-response boundary withholds earlier good identifiers on ${label}`, () => {
  const bad = row({ sourceMessageId: OTHER }); change(bad)
  const result = run(snapshot([row(), bad]))
  assert.equal(result.status, 'read_failed')
  hidden(result)
})
// Keep receipt and insertion context consistent. The malformed-calendar case
// deliberately has no context, so the row boundary itself must reject it;
// removing that check must not be masked by a second context-date rejection.
for (const [label, overrides] of [
  ['future receipt', { sourceReceivedAt: '2026-09-22T10:00:00.000001Z' }],
  ['invalid receipt date', { sourceReceivedAt: '2026-02-30T09:00:00Z', receivedContext: null }],
] as Array<[string, Record<string, unknown>]>) test(`whole-response boundary withholds earlier good identifiers on ${label}`, () => {
  const result = run(snapshot([row(), row({ sourceMessageId: OTHER, ...overrides })]))
  assert.equal(result.status, 'read_failed')
  hidden(result)
})
for (const [label, overrides] of [
  ['unknown version', { version: 2 }], ['wrong snapshot company', { companyId: OTHER }],
  ['wrong snapshot environment', { environment: 'production' }], ['wrong cutoff', { cutoffAt: '2026-09-22T09:59:59Z' }],
  ['future claimed read window', { readAt: '2026-09-22T09:59:59Z' }],
  ['invalid activation', { openedAt: 'invalid' }],
] as Array<[string, Record<string, unknown>]>) test(`${label} fails closed`, () => {
  const result = run(snapshot([row()], overrides)); assert.equal(result.status, 'read_failed'); hidden(result)
})
for (const [label, overrides] of [
  ['count mismatch', { sourceCount: 2 }], ['null count', { sourceCount: null }], ['negative count', { sourceCount: -1 }],
  ['fractional count', { sourceCount: 1.1 }], ['overflow count', { sourceCount: 1001 }],
  ['partial snapshot', { exhaustive: false }],
] as Array<[string, Record<string, unknown>]>) test(`${label} never reports a prefix as a complete inventory`, () => {
  const result = run(snapshot([row()], overrides)); assert.equal(result.status, 'incomplete'); hidden(result)
})
test('duplicate source IDs never collapse into an apparently complete inventory', () => {
  const result = run(snapshot([row(), row()])); assert.equal(result.status, 'incomplete'); hidden(result)
})
test('empty ledger is not a certificate of complete historical sources', () => {
  const result = run(snapshot([])); assert.equal(result.status, 'enumerated')
  assert.equal(result.historyCoverage, 'before_ledger_unknown'); assert.equal(result.selection, 'not_performed')
})
test('cutoff before activation has no supported historical coverage', () => {
  const result = run(snapshot([], { openedAt: '2026-09-22T10:00:00.000001Z' }))
  assert.equal(result.status, 'unavailable'); hidden(result)
})
test('null original receipt is retained as an uncertainty, not dropped by filtering', () => {
  const result = run(snapshot([row({ sourceReceivedAt: null, receivedContext: null })]))
  assert.equal(result.status, 'incomplete'); assert.equal(result.sources.length, 1)
  assert.equal(result.sources[0].receiptStatus, 'unavailable')
})
test('missing original insertion context never becomes source approval', () => {
  const result = run(snapshot([row({ receivedContext: null })]))
  assert.equal(result.status, 'incomplete'); assert.equal(result.sources[0].disposition, 'not_checked')
})
for (const [label, overrides] of [
  ['wrong payload hash', { payloadHash: '0'.repeat(64) }],
  ['missing payload', { rawPayload: null, receivedContext: null }],
  ['empty payload', { rawPayload: '' }],
  ['dangling release', { rawPayload: wire() + '?' }],
  ['missing terminator', { rawPayload: wire().slice(0, -1) }],
  ['wrong UNT count', { rawPayload: wire().replace('UNT+5+', 'UNT+4+') }],
  ['wrong UNT reference', { rawPayload: wire().replace('UNT+5+MSG1', 'UNT+5+OTHER') }],
  ['wrong UNZ count', { rawPayload: wire().replace('UNZ+1+', 'UNZ+2+') }],
  ['wrong interchange reference', { rawPayload: wire().replace('UNZ+1+REF', 'UNZ+1+OTHER') }],
  ['absent physical object', { rawPayload: wire([]) }],
  ['wrong message family', { rawPayload: wire().replace('PRODAT:', 'UTILTS:') }],
] as Array<[string, Record<string, unknown>]>) test(`${label} does not become complete or authoritative`, () => {
  const result = run(snapshot([row(overrides)])); assert.equal(result.status, 'incomplete')
  assert.equal(result.authorityStatus, 'not_established'); assert.equal(result.selection, 'not_performed')
})
test('an orphan LIN remains an unresolved occurrence', () => {
  const raw = wire().replace('UNZ+1+REF', "LIN+3++ORPHAN:::9'UNZ+1+REF")
  const result = run(snapshot([row({ rawPayload: raw })])); assert.equal(result.status, 'incomplete')
  assert.equal(result.sources[0].occurrences.length, 3)
  assert.equal(result.sources[0].occurrences[2].messageIndex, null)
})
test('per-source byte budget returns no misleading prefix', () => {
  const result = run(snapshot([row(), row({ sourceMessageId: OTHER, rawPayload: 'A'.repeat(262145) })]))
  assert.equal(result.status, 'incomplete'); hidden(result)
})
test('UTF-8 budget counts bytes rather than code units', () => {
  const result = run(snapshot([row({ rawPayload: 'å'.repeat(131073) })]))
  assert.equal(result.status, 'incomplete'); hidden(result)
})
test('source order is diagnostic only and stable regardless of storage order', () => {
  const a = row(), b = row({ sourceMessageId: OTHER })
  assert.deepEqual(run(snapshot([a, b])), run(snapshot([b, a])))
})
test('offset-equivalent cutoffs and source times preserve exact microseconds', () => {
  assert.equal(instant('2026-09-22T12:00:00.000001+02:00'), instant('2026-09-22T10:00:00.000001Z'))
  assert.equal(instant('2026-09-22T10:00:00.000001Z')! - instant('2026-09-22T10:00:00.000000Z')!, BigInt(1))
  assert.equal(run(snapshot([row()], { cutoffAt: '2026-09-22T12:00:00+02:00' })).status, 'enumerated')
})
for (const value of ['2026-02-29T10:00:00Z', '2026-13-01T10:00:00Z', '2026-09-31T10:00:00Z',
  '2026-09-22T24:00:00Z', '2026-09-22T10:60:00Z', '2026-09-22T10:00:60Z',
  '2026-09-22T10:00:00', '2026-09-22T10:00:00.0000001Z', '2026-09-22T10:00:00+24:00',
  '2026-09-22T10:00:00+02:60', '', null, {}, 1]) test(`invalid instant is unavailable: ${JSON.stringify(value)}`, () => {
  assert.equal(instant(value), null)
})
test('leap-year date validation is not based on Date rollover', () => {
  assert.notEqual(instant('2024-02-29T23:59:59.999999Z'), null)
  assert.equal(instant('2100-02-29T23:59:59Z'), null)
  assert.notEqual(instant('2000-02-29T23:59:59Z'), null)
})
test('caller-provided accepted/status JSON cannot establish authority', () => {
  const result = run(snapshot([row({ status: 'accepted', validation_report: { valid: true }, acceptance: 'approved' })], { authorityStatus: 'approved' }))
  assert.equal(result.authorityStatus, 'not_established')
  assert.equal(result.sources[0].disposition, 'not_checked')
  assert.equal(result.selection, 'not_performed')
})
test('malformed input never throws or reveals data', () => {
  for (const input of [null, [], {}, 1, 'input', { companyId: COMPANY }]) hidden(inspect(input))
})
test('more than the old 100 linked rows are inventoried without a silent limit', () => {
  const rows = Array.from({ length: 101 }, (_, i) => row({ sourceMessageId: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}` }))
  const result = run(snapshot(rows)); assert.equal(result.status, 'enumerated'); assert.equal(result.sources.length, 101)
})
test('aggregate UTF-8 budget invalidates all rows rather than exposing an earlier prefix', () => {
  const rows = Array.from({ length: 17 }, (_, i) => row({ sourceMessageId: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`, rawPayload: 'A'.repeat(250000) }))
  const result = run(snapshot(rows)); assert.equal(result.status, 'incomplete'); hidden(result)
})
test('per-wire segment budget invalidates the entire returned inventory', () => {
  const result = run(snapshot([row({ rawPayload: wire(Array(8190).fill('LIN+1++MP-A:::9')) })]))
  assert.equal(result.status, 'incomplete'); hidden(result)
})
test('aggregate segment budget invalidates the entire returned inventory', () => {
  const rows = Array.from({ length: 5 }, (_, i) => row({ sourceMessageId: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`, rawPayload: wire(Array(7000).fill('LIN+1++MP-A:::9')) }))
  const result = run(snapshot(rows)); assert.equal(result.status, 'incomplete'); hidden(result)
})
test('a released apparent LIN inside FTX is not a new physical object', () => {
  const raw = wire(['LIN+1++MP-A:::9', "FTX+AAI+++text?'LIN?+99?+?+FAKE:::9"])
  const result = run(snapshot([row({ rawPayload: raw })])); assert.equal(result.status, 'enumerated')
  assert.equal(result.sources[0].occurrences.length, 1); assert.equal(result.sources[0].objects[0].objectId, 'MP-A')
})
test('inspection does not mutate original source, context or query snapshot', () => {
  const input = snapshot([row()]); const before = structuredClone(input)
  run(input); assert.deepEqual(input, before)
})
test('deterministic generated identities/repeats preserve every wire ordinal and exact tuple', () => {
  const escape = (value: string) => value.replaceAll('?', '??').replaceAll(':', '?:').replaceAll('+', '?+').replaceAll("'", "?'")
  const names = ['A', 'B:C', 'D+E', 'F?G', "H'I", 'ÅJK']
  for (let size = 1; size <= 40; size++) {
    const expected = new Map<string, number[]>(); const lines: string[] = []
    for (let i = 0; i < size; i++) {
      const id = names[i % names.length], agency = i % 2 ? '9' : '89'; const key = JSON.stringify([0, id, agency])
      const ordinals = expected.get(key) ?? []; ordinals.push(i + 1); expected.set(key, ordinals)
      lines.push(`LIN+${i + 1}++${escape(id)}:::${agency}`)
    }
    const result = run(snapshot([row({ rawPayload: wire(lines) })])); assert.equal(result.status, 'enumerated')
    assert.equal(result.sources[0].occurrences.length, size)
    assert.deepEqual(result.sources[0].objects.map(x => [JSON.stringify([x.messageIndex, x.objectId, x.identityAgency]), x.occurrenceOrdinals]), [...expected])
  }
})
