import { validateUtiltsPersistenceResults, type persistUtiltsTransactionResults, type UtiltsTransactionPersistenceResult } from '@/lib/ediel/utilts/transactionPersistence'
import { createHash } from 'node:crypto'

/** Successful external RPC double for diagnostic-invariance tests. An empty
 * array is an invalid RPC response, not successful persistence of every input.
 * The digest is a synthetic RPC receipt; PostgreSQL owns the actual jsonb
 * contract digest. Return the prepared contract's own version and content. */
export async function successfulUtiltsPersistenceIo(
  input: Parameters<typeof persistUtiltsTransactionResults>[0],
): Promise<UtiltsTransactionPersistenceResult[]> {
  return validateUtiltsPersistenceResults(input, input.transactions.map((item, index) => ({
    transactionId: item.transactionId!,
    disposition: item.disposition,
    responseType: item.responseType,
    persistenceStatus: item.disposition === 'accepted' ? 'persisted' : 'not_applicable',
    sourceBinding: { sourceMessageId: input.sourceMessageId, rawHash: createHash('sha256').update(input.rawPayload).digest('hex'), boundAt: '2026-09-23T00:00:00Z' },
    ...(item.disposition === 'accepted' ? { seriesId: `synthetic-series-${item.transactionId}`, consumptionContract: structuredClone(input.contracts[index]), contractHash: 'a'.repeat(64), contractVersion: input.contracts[index].version } : {}),
  })))
}
