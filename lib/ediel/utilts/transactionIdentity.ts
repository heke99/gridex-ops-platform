/**
 * Keep TypeScript transaction identity aligned with
 * `gridex_persist_utilts_transactions_v1`, which falls back to
 * `transaction-<1-based-index>` when IDE+24 is absent.
 */
export function resolveUtiltsTransactionId(
  transactionId: string | null | undefined,
  index: number,
): string {
  const trimmed = typeof transactionId === 'string' ? transactionId.trim() : ''
  return trimmed.length > 0 ? trimmed : `transaction-${index + 1}`
}
