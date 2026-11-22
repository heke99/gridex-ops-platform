import { errorCode } from '@/lib/http/apiError'

export function manualPricingError(error: unknown) {
  const code = errorCode(error)
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : null

  if (code === '55P03' && message === 'pricing_source_basis_busy_retry') {
    return {
      status: 503,
      code: 'pricing_source_basis_busy_retry',
      message: 'Underlagets källuppgifter används av en annan körning. Försök igen om en stund.',
    }
  }

  const rejectedBasis = code === '23514'
    && (message === 'billing_finalized_source_basis_required' || message === 'billing_finalized_supply_basis_changed')
  const unavailableBasis = code === null && error instanceof Error && message === 'pricing_source_basis_unavailable'
  if (rejectedBasis || unavailableBasis) {
    return {
      status: 409,
      code: 'pricing_source_basis_unavailable',
      message: 'Underlagets källuppgifter behöver granskas innan prisberäkningen kan fortsätta.',
    }
  }

  return null
}
