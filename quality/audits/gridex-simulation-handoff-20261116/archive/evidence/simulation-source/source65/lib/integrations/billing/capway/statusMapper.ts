export function purchasableValue(financingMode: string | null | undefined): 0 | 1 | 2 {
  if (financingMode === 'factoring_without_recourse') return 1
  if (financingMode === 'factoring_with_recourse') return 2
  return 0
}

export function shouldRequestPurchaseAfterCreate(financingMode: string | null | undefined): boolean {
  return financingMode === 'factoring_without_recourse' || financingMode === 'factoring_with_recourse'
}

export function normalizeCapwayFinanceStatus(value: unknown): string {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return 'unknown'
  if (text === '2' || text.includes('purchasedwithoutrecourse')) return 'purchased_without_recourse'
  if (text === '3' || text.includes('purchasedwithrecourse')) return 'purchased_with_recourse'
  if (text === '4' || text.includes('recoursed')) return 'recoursed'
  if (text === '5' || text.includes('pledged')) return 'pledged'
  if (text === '1' || text.includes('service')) return 'service'
  if (text === '0' || text.includes('ownledger')) return 'own_ledger'
  return text.replace(/[^a-z0-9_]+/g, '_')
}

export function normalizeCapwayInvoiceStatus(status: unknown): string {
  const n = typeof status === 'number' ? status : typeof status === 'string' ? Number(status) : NaN
  if (!Number.isFinite(n)) return 'unknown'
  if ((n & 1) === 1) return 'paid'
  if ((n & 4) === 4) return 'overdue'
  if ((n & 8) === 8) return 'reminder_sent'
  if ((n & 16) === 16) return 'collection'
  if ((n & 64) === 64) return 'credited'
  if ((n & 2) === 2) return 'unpaid'
  return 'registered'
}
