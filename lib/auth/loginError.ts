export const LOGIN_INVALID_CREDENTIALS_MESSAGE = 'Fel e-post eller lösenord'
export const LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE =
  'Inloggningstjänsten är tillfälligt otillgänglig. Försök igen om en stund.'

type AuthErrorLike = {
  code?: unknown
}

/**
 * Keep credential failures intentionally indistinguishable to avoid account
 * enumeration. Everything else is treated as a provider/infrastructure
 * failure so raw Supabase/network details never reach the login UI.
 */
export function loginErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as AuthErrorLike).code ?? '').trim().toLowerCase()
      : ''

  return code === 'invalid_credentials'
    ? LOGIN_INVALID_CREDENTIALS_MESSAGE
    : LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE
}
