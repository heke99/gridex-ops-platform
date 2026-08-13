export const LOGIN_INVALID_CREDENTIALS_MESSAGE = 'Fel e-post eller lösenord'
export const LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE =
  'Inloggningstjänsten är tillfälligt otillgänglig. Försök igen om en stund.'
export const LOGIN_MISSING_FIELDS_MESSAGE = 'Fyll i e-post och lösenord'
export const LOGIN_VERIFY_LINK_MISSING_CODE_MESSAGE =
  'Verifieringslänken saknar kod. Begär en ny länk och försök igen.'
export const LOGIN_VERIFY_LINK_EXPIRED_MESSAGE =
  'Länken har gått ut eller är redan använd. Begär en ny länk och försök igen.'

export const LOGIN_EMAIL_CONFIRMED_MESSAGE =
  'E-postadressen är bekräftad. Du kan logga in.'
export const LOGIN_INVITE_ACCEPTED_MESSAGE =
  'Inbjudan är accepterad. Din verifierade Auth-identitet har nu fått åtkomst.'

export const UPDATE_PASSWORD_TOO_SHORT_MESSAGE = 'Lösenordet behöver vara minst 8 tecken.'
export const UPDATE_PASSWORD_MISMATCH_MESSAGE = 'Lösenorden matchar inte.'
export const UPDATE_PASSWORD_SESSION_MISSING_MESSAGE =
  'Sessionen saknas. Logga in igen med det temporära lösenordet.'
export const UPDATE_PASSWORD_FAILED_MESSAGE =
  'Det gick inte att uppdatera lösenordet. Begär en ny återställningslänk och försök igen.'
export const UPDATE_PASSWORD_SUCCESS_MESSAGE = 'Lösenordet är uppdaterat.'

const ALLOWED_LOGIN_ERROR_FLASHES = new Set([
  LOGIN_INVALID_CREDENTIALS_MESSAGE,
  LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE,
  LOGIN_MISSING_FIELDS_MESSAGE,
  LOGIN_VERIFY_LINK_MISSING_CODE_MESSAGE,
  LOGIN_VERIFY_LINK_EXPIRED_MESSAGE,
])

const ALLOWED_LOGIN_SUCCESS_FLASHES = new Set([
  LOGIN_EMAIL_CONFIRMED_MESSAGE,
  LOGIN_INVITE_ACCEPTED_MESSAGE,
  UPDATE_PASSWORD_SUCCESS_MESSAGE,
])

const ALLOWED_UPDATE_PASSWORD_ERROR_FLASHES = new Set([
  UPDATE_PASSWORD_TOO_SHORT_MESSAGE,
  UPDATE_PASSWORD_MISMATCH_MESSAGE,
  UPDATE_PASSWORD_SESSION_MISSING_MESSAGE,
  UPDATE_PASSWORD_FAILED_MESSAGE,
])

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

function sanitizeAllowedFlash(
  value: string | null | undefined,
  allowed: Set<string>,
  fallback: string | null,
): string | null {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null
  return allowed.has(trimmed) ? trimmed : fallback
}

/**
 * Login flashes travel through the public `?error=` query string. Only allow
 * the fixed Swedish messages produced by login/auth actions so crafted URLs
 * cannot inject phishing or social-engineering copy into the form.
 */
export function sanitizeLoginErrorFlash(value: string | null | undefined): string | null {
  return sanitizeAllowedFlash(
    value,
    ALLOWED_LOGIN_ERROR_FLASHES,
    LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE,
  )
}

/**
 * Login success flashes also travel through the public query string. Drop
 * unknown copy instead of substituting a fallback so phishing cannot ride a
 * green "success" banner.
 */
export function sanitizeLoginSuccessFlash(value: string | null | undefined): string | null {
  return sanitizeAllowedFlash(value, ALLOWED_LOGIN_SUCCESS_FLASHES, null)
}

export function sanitizeUpdatePasswordErrorFlash(
  value: string | null | undefined,
): string | null {
  return sanitizeAllowedFlash(
    value,
    ALLOWED_UPDATE_PASSWORD_ERROR_FLASHES,
    UPDATE_PASSWORD_FAILED_MESSAGE,
  )
}
