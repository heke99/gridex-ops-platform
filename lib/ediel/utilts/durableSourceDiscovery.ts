import { createHash } from 'node:crypto'
import { inspectDurableReceivedSourceInventory, parseSourceReceiptInstant, type DurableReceivedSourceInventory } from '@/lib/ediel/utilts/receivedSourceInventory'

export const RECEIVED_DISCOVERY_ENGINE = 'physical-lin-inventory-v1'
export type ReceivedSourceScope = { companyId: string; environment: 'test' | 'production'; cutoffAt: string }
export type DiscoveryPersistence =
  | { status: 'not_requested' | 'unconfirmed' }
  | { status: 'stored'; snapshotId: string; snapshotHash: string; attemptId: string; inventoryHash: string }
export type PersistedReceivedSourceInventory = DurableReceivedSourceInventory & { persistence: DiscoveryPersistence }
export type ReceivedSourceLedgerIO = {
  openSnapshot(scope: ReceivedSourceScope): Promise<unknown>
  appendDiscovery(input: ReceivedSourceScope & { snapshotId: string; snapshotHash: string; engineVersion: string; inventoryText: string }): Promise<unknown>
}
export function isEvidenceUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
}
export function isEvidenceRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function evidenceHash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
export function emptyReceivedSourceInventory(): PersistedReceivedSourceInventory {
  return { ...inspectDurableReceivedSourceInventory(null), persistence: { status: 'not_requested' } }
}

/** IO owners must enforce a request deadline. No error details or unchecked
 * identifiers are returned. A transport error is UNKNOWN commit outcome, not
 * proof that a transaction was rolled back. This path never controls ACKs. */
export async function discoverAndRecordReceivedSources(input: unknown, io: ReceivedSourceLedgerIO): Promise<PersistedReceivedSourceInventory> {
  if (!isEvidenceRecord(input) || !isEvidenceUuid(input.companyId)
    || (input.environment !== 'test' && input.environment !== 'production')
    || typeof input.cutoffAt !== 'string' || parseSourceReceiptInstant(input.cutoffAt) === null) return emptyReceivedSourceInventory()
  const scope: ReceivedSourceScope = { companyId: input.companyId, environment: input.environment, cutoffAt: input.cutoffAt }
  let snapshot: unknown
  try { snapshot = await io.openSnapshot(scope) } catch {
    return { ...inspectDurableReceivedSourceInventory({ ...scope, snapshot: null }), persistence: { status: 'unconfirmed' } }
  }
  const inventory = inspectDurableReceivedSourceInventory({ ...scope, snapshot })
  if (inventory.status === 'read_failed' || inventory.status === 'unavailable') {
    return { ...inventory, persistence: { status: 'unconfirmed' } }
  }
  // Scope validation above precedes any snapshot handle disclosure/use. The
  // append RPC independently checks the persisted snapshot scope and hash.
  if (!isEvidenceRecord(snapshot) || !isEvidenceUuid(snapshot.snapshotId)
    || typeof snapshot.snapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.snapshotHash)) {
    return { ...inspectDurableReceivedSourceInventory({ ...scope, snapshot: null }), persistence: { status: 'unconfirmed' } }
  }
  const { snapshotId, snapshotHash } = snapshot
  const inventoryText = JSON.stringify(inventory), inventoryHash = evidenceHash(inventoryText)
  try {
    const receipt = await io.appendDiscovery({ ...scope, snapshotId, snapshotHash, engineVersion: RECEIVED_DISCOVERY_ENGINE, inventoryText })
    if (!isEvidenceRecord(receipt) || receipt.version !== 1 || receipt.companyId !== scope.companyId
      || receipt.environment !== scope.environment || receipt.snapshotId !== snapshotId || receipt.snapshotHash !== snapshotHash
      || receipt.engineVersion !== RECEIVED_DISCOVERY_ENGINE || receipt.inventoryHash !== inventoryHash || !isEvidenceUuid(receipt.attemptId)) throw new Error('invalid_receipt')
    return { ...inventory, persistence: { status: 'stored', snapshotId, snapshotHash, attemptId: receipt.attemptId, inventoryHash } }
  } catch {
    // Observed objects may remain diagnostic, but a failed/unverifiable save
    // must not present them as a successfully persisted complete inventory.
    return { ...inventory, status: 'incomplete', issues: [...inventory.issues, { code: 'source_discovery_receipt_unconfirmed' }], persistence: { status: 'unconfirmed' } }
  }
}
