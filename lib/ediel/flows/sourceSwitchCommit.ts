import type {EdielMessageRow} from '@/lib/ediel/types'

/** A transient handoff from the successful business-write path. Never serialize
 * this capability into status JSON or restore it from a database receipt. */
export type SourceSwitchCommit = Readonly<{
  message: EdielMessageRow
  switchRequestId: string
  supplyPeriodId: string
}>
export type SourceSwitchCommitObserver = (commit: SourceSwitchCommit) => Promise<unknown>
const committed = new WeakSet<object>()

/** Called only after the actual switch and supply writes succeed. Evidence
 * failures must not rewrite an already committed business operation or its ACK. */
export async function publishSourceSwitchCommit(observer: SourceSwitchCommitObserver | undefined, fields: SourceSwitchCommit): Promise<void> {
  if (!observer) return
  let capability: SourceSwitchCommit | undefined
  try {
    capability = Object.freeze({...fields, message: structuredClone(fields.message)})
    committed.add(capability)
    await observer(capability)
  } catch { /* Evidence remains unavailable. */ }
  finally { if (capability) committed.delete(capability) }
}

/** In-process provenance, not a substitute for scoped database revalidation. */
export function isSourceSwitchCommit(value: unknown): value is SourceSwitchCommit {
  return typeof value === 'object' && value !== null && committed.has(value)
}
