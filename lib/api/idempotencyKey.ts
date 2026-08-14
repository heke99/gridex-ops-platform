export const IDEMPOTENCY_KEY_MIN_LENGTH = 8
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:+~-]+$/

export function isValidIdempotencyKey(value: string): boolean {
  return value.length >= IDEMPOTENCY_KEY_MIN_LENGTH
    && value.length <= IDEMPOTENCY_KEY_MAX_LENGTH
    && IDEMPOTENCY_KEY_PATTERN.test(value)
}

export function normalizeIdempotencyKey(value: string | null | undefined): string | null {
  if (value == null || value === '') return null
  return isValidIdempotencyKey(value) ? value : null
}
