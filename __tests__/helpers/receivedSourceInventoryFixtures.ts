import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { inspectDurableReceivedSourceInventory as inspect } from '@/lib/ediel/utilts/receivedSourceInventory'
export type FixtureRow = Record<string, unknown> & { receivedContext: Record<string, unknown> }
export const COMPANY = '11111111-1111-4111-8111-111111111111'
export const OTHER = '22222222-2222-4222-8222-222222222222'
export const SOURCE = '33333333-3333-4333-8333-333333333333'
export const CUTOFF = '2026-09-22T10:00:00.000000Z'
export const RECEIVED = '2026-09-22T09:00:00.000001Z'
export const CAPTURED = '2026-09-22T09:00:00.000003Z'
export const hash = (raw: unknown) => { assert.ok(typeof raw === 'string'); return createHash('sha256').update(raw, 'utf8').digest('hex') }
export const child = (lines: string[], ref = 'MSG1', family = 'PRODAT') => [
  `UNH+${ref}+${family}:D:96B:UN`, 'BGM+Z04+DOC+9', ...lines,
  `UNT+${lines.length + 3}+${ref}`,
]
export const wire = (lines = ['LIN+1++MP-A:::9', 'LIN+2++MP-B:::89']) => [
  'UNB+UNOC:3+111:14+222:14+260922:0900+REF', ...child(lines), 'UNZ+1+REF', '',
].join("'")
export function row(overrides: Record<string, unknown> = {}): FixtureRow {
  const item: Record<string, unknown> = { sourceMessageId: SOURCE, companyId: COMPANY, environment: 'test',
    origin: 'database_insert', messageCode: 'Z04', sourceReceivedAt: RECEIVED,
    capturedAt: CAPTURED, rawPayload: wire(), ...overrides }
  item.payloadHash = Object.hasOwn(overrides, 'payloadHash') ? overrides.payloadHash : item.rawPayload === null ? null : hash(item.rawPayload)
  item.receivedContext = Object.hasOwn(overrides, 'receivedContext') ? overrides.receivedContext : {
    version: 1, contextOrigin: 'database_insert', sourceMessageId: item.sourceMessageId,
    companyId: item.companyId, environment: item.environment, messageCode: item.messageCode,
    payloadHash: item.payloadHash, sourceReceivedAt: item.sourceReceivedAt,
    capturedAt: '2026-09-22T09:00:00.000002Z',
  }
  return item as FixtureRow
}
export function snapshot(rows: FixtureRow[] = [row()], overrides: Record<string, unknown> = {}) {
  return { version: 1, companyId: COMPANY, environment: 'test', cutoffAt: CUTOFF,
    openedAt: '2026-09-22T08:00:00.000000Z', readAt: '2026-09-22T10:01:00Z',
    exhaustive: true, sourceCount: rows.length, sources: rows, ...overrides }
}
export function run(s: unknown = snapshot(), extra: Record<string, unknown> = {}) {
  return inspect({ companyId: COMPANY, environment: 'test', cutoffAt: CUTOFF, snapshot: s, ...extra })
}
