import type { persistUtiltsTransactionResults, UtiltsTransactionPersistenceResult } from '@/lib/ediel/utilts/transactionPersistence'

/** Successful external RPC double for diagnostic-invariance tests. An empty
 * array is an invalid RPC response, not successful persistence of every input. */
export async function successfulUtiltsPersistenceIo(
  input: Parameters<typeof persistUtiltsTransactionResults>[0],
): Promise<UtiltsTransactionPersistenceResult[]> {
  return input.transactions.map(item => ({
    transactionId: item.transactionId!,
    disposition: item.disposition,
    responseType: item.responseType,
    persistenceStatus: item.disposition === 'accepted' ? 'persisted' : 'not_applicable',
    ...(item.disposition === 'accepted' ? { seriesId: `synthetic-series-${item.transactionId}` } : {}),
  }))
}
