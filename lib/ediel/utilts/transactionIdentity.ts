/**
 * Preserve a physically supplied IDE+24 without normalizing its identity.
 * Only absent/empty IDEs use the existing transaction-<1-based-index> diagnostic
 * identity; this helper grants no guide or persistence acceptance.
 */
export function resolveUtiltsTransactionId(
  transactionId: string | null | undefined,
  index: number,
): string {
  return typeof transactionId === 'string' && transactionId.trim() !== '' ? transactionId : `transaction-${index + 1}`
}
