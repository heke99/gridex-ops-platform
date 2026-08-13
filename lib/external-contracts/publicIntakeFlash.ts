export const EXTERNAL_CONTRACT_SUCCESS_CREATED_MESSAGE =
  'Tack. Avtalet är mottaget och ett kundflöde har skapats för granskning.'
export const EXTERNAL_CONTRACT_SUCCESS_NEEDS_REVIEW_MESSAGE =
  'Tack. Vi har tagit emot avtalet och behöver granska några uppgifter innan flödet går vidare.'
export const EXTERNAL_CONTRACT_GENERIC_ERROR_MESSAGE = 'Avtalet kunde inte tas emot.'
export const EXTERNAL_CONTRACT_OFFER_INCOMPLETE_MESSAGE =
  'Det valda avtalet är inte komplett publicerat eller saknar canonical versionskopplingar.'
export const EXTERNAL_CONTRACT_OFFER_UNAVAILABLE_MESSAGE =
  'Det valda avtalet är inte tillgängligt idag.'
export const EXTERNAL_CONTRACT_COMPANY_NOT_FOUND_MESSAGE =
  'Bolaget hittades inte. Kontrollera länken till avtalsformuläret.'
export const EXTERNAL_CONTRACT_COMPANY_CLOSED_MESSAGE =
  'Bolaget tar inte emot nya avtal just nu.'

const ALLOWED_SUCCESS = new Set([
  EXTERNAL_CONTRACT_SUCCESS_CREATED_MESSAGE,
  EXTERNAL_CONTRACT_SUCCESS_NEEDS_REVIEW_MESSAGE,
])

const ALLOWED_ERROR = new Set([
  EXTERNAL_CONTRACT_GENERIC_ERROR_MESSAGE,
  EXTERNAL_CONTRACT_OFFER_INCOMPLETE_MESSAGE,
  EXTERNAL_CONTRACT_OFFER_UNAVAILABLE_MESSAGE,
  EXTERNAL_CONTRACT_COMPANY_NOT_FOUND_MESSAGE,
  EXTERNAL_CONTRACT_COMPANY_CLOSED_MESSAGE,
])

export function externalContractErrorFlash(error: unknown): string {
  const message =
    error instanceof Error ? String(error.message ?? '').trim() : ''
  return ALLOWED_ERROR.has(message) ? message : EXTERNAL_CONTRACT_GENERIC_ERROR_MESSAGE
}

export function sanitizeExternalContractFlash(
  status: string | null | undefined,
  message: string | null | undefined,
): { status: 'success' | 'error'; message: string } | null {
  const normalizedStatus = String(status ?? '').trim()
  const trimmed = String(message ?? '').trim()
  if (!trimmed) return null

  if (normalizedStatus === 'success') {
    return ALLOWED_SUCCESS.has(trimmed)
      ? { status: 'success', message: trimmed }
      : null
  }

  if (normalizedStatus === 'error') {
    return {
      status: 'error',
      message: ALLOWED_ERROR.has(trimmed)
        ? trimmed
        : EXTERNAL_CONTRACT_GENERIC_ERROR_MESSAGE,
    }
  }

  return null
}
