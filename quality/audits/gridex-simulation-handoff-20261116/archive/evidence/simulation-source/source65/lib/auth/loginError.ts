export const LOGIN_INVALID_CREDENTIALS_MESSAGE = 'Fel e-post eller lösenord'
export const LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE =
  'Inloggningstjänsten är tillfälligt otillgänglig. Försök igen om en stund.'
export const LOGIN_MISSING_FIELDS_MESSAGE = 'Fyll i e-post och lösenord'
export const LOGIN_VERIFY_LINK_MISSING_CODE_MESSAGE =
  'Verifieringslänken saknar kod. Begär en ny länk och försök igen.'
export const LOGIN_VERIFY_LINK_EXPIRED_MESSAGE =
  'Länken har gått ut eller är redan använd. Begär en ny länk och försök igen.'
export const LOGIN_ACCOUNT_DISABLED_MESSAGE =
  'Kontot är inaktiverat. Kontakta en administratör om du behöver åtkomst igen.'

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

export const FORGOT_PASSWORD_EMAIL_REQUIRED_MESSAGE =
  'Ange e-postadressen som är kopplad till kontot.'
export const FORGOT_PASSWORD_SEND_FAILED_MESSAGE =
  'Det gick inte att skicka återställningslänken. Kontrollera e-postadressen och försök igen.'

export const AUTH_ACTION_LINK_MISSING_INFO_MESSAGE =
  'Länken saknar giltig verifieringsinformation. Begär en ny länk och försök igen.'
export const AUTH_ACTION_LINK_EXPIRED_MESSAGE = LOGIN_VERIFY_LINK_EXPIRED_MESSAGE

export const COMPANY_INVITE_MISSING_TOKEN_MESSAGE =
  'Inbjudningslänken saknar token. Be administratören skicka en ny inbjudan.'
export const COMPANY_INVITE_ACCEPT_FAILED_MESSAGE =
  'Inbjudan kunde inte accepteras. Kontrollera att du är inloggad med rätt e-post eller be administratören skicka en ny länk.'

const ALLOWED_LOGIN_ERROR_FLASHES = new Set([
  LOGIN_INVALID_CREDENTIALS_MESSAGE,
  LOGIN_TEMPORARILY_UNAVAILABLE_MESSAGE,
  LOGIN_MISSING_FIELDS_MESSAGE,
  LOGIN_VERIFY_LINK_MISSING_CODE_MESSAGE,
  LOGIN_VERIFY_LINK_EXPIRED_MESSAGE,
  LOGIN_ACCOUNT_DISABLED_MESSAGE,
])

const ALLOWED_LOGIN_REASON_FLASHES = new Map<string, string>([
  ['account_disabled', LOGIN_ACCOUNT_DISABLED_MESSAGE],
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

const ALLOWED_FORGOT_PASSWORD_ERROR_FLASHES = new Set([
  FORGOT_PASSWORD_EMAIL_REQUIRED_MESSAGE,
  FORGOT_PASSWORD_SEND_FAILED_MESSAGE,
])

const ALLOWED_AUTH_ACTION_ERROR_FLASHES = new Set([
  AUTH_ACTION_LINK_MISSING_INFO_MESSAGE,
  AUTH_ACTION_LINK_EXPIRED_MESSAGE,
  LOGIN_VERIFY_LINK_EXPIRED_MESSAGE,
])

const ALLOWED_COMPANY_INVITE_ERROR_FLASHES = new Set([
  COMPANY_INVITE_MISSING_TOKEN_MESSAGE,
  COMPANY_INVITE_ACCEPT_FAILED_MESSAGE,
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
 * Proxy and auth redirects may pass a machine `reason=` code. Map only known
 * codes onto fixed Swedish flashes so raw query text never renders.
 */
export function loginReasonErrorFlash(value: string | null | undefined): string | null {
  const reason = String(value ?? '').trim().toLowerCase()
  if (!reason) return null
  return ALLOWED_LOGIN_REASON_FLASHES.get(reason) ?? null
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

export function sanitizeForgotPasswordErrorFlash(
  value: string | null | undefined,
): string | null {
  return sanitizeAllowedFlash(
    value,
    ALLOWED_FORGOT_PASSWORD_ERROR_FLASHES,
    FORGOT_PASSWORD_SEND_FAILED_MESSAGE,
  )
}

export function sanitizeAuthActionErrorFlash(
  value: string | null | undefined,
): string | null {
  return sanitizeAllowedFlash(
    value,
    ALLOWED_AUTH_ACTION_ERROR_FLASHES,
    AUTH_ACTION_LINK_EXPIRED_MESSAGE,
  )
}

export function sanitizeCompanyInviteErrorFlash(
  value: string | null | undefined,
): string | null {
  return sanitizeAllowedFlash(
    value,
    ALLOWED_COMPANY_INVITE_ERROR_FLASHES,
    COMPANY_INVITE_ACCEPT_FAILED_MESSAGE,
  )
}
