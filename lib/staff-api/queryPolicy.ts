import type { NextRequest } from 'next/server'
import { ApiInputError } from '@/lib/api/strictRequest'

/**
 * Staff list query parsing policy (ops-api-review F39).
 *
 * `compatible` (default) keeps each endpoint's previously accepted inputs so
 * existing clients are not broken. `strict` is opt-in through the
 * `x-gridex-query-parsing: strict` request header and applies one rule to every
 * Staff list endpoint: each query parameter at most once, and numeric values
 * only as plain decimal digits without sign, whitespace, exponent, fraction,
 * hexadecimal prefix or leading zero. Violations return 422 `invalid_field`
 * before any business/database port is called.
 */
export type StaffQueryParsingProfile = 'compatible' | 'strict'
export const STAFF_QUERY_PARSING_HEADER = 'x-gridex-query-parsing'

export function staffQueryParsingProfile(request: NextRequest): StaffQueryParsingProfile {
  const value = request.headers.get(STAFF_QUERY_PARSING_HEADER)
  if (value === null || value === 'compatible') return 'compatible'
  if (value === 'strict') return 'strict'
  throw new ApiInputError('Okänd query-parsningsprofil.', 'invalid_field', 422, STAFF_QUERY_PARSING_HEADER)
}

/** Strict profile: reject any duplicated query parameter and non-decimal numeric fields. */
export function assertStrictStaffQuery(params: URLSearchParams, numericFields: readonly string[]): void {
  for (const key of new Set(params.keys())) {
    if (params.getAll(key).length > 1) throw new ApiInputError('Sökfält får bara anges en gång.', 'invalid_field', 422, key)
  }
  for (const field of numericFields) {
    const value = params.get(field)
    if (value !== null && !/^[1-9]\d{0,8}$/.test(value)) throw new ApiInputError('Ogiltigt numeriskt värde.', 'invalid_field', 422, field)
  }
}

export function applyStaffQueryPolicy(request: NextRequest, numericFields: readonly string[]): StaffQueryParsingProfile {
  const profile = staffQueryParsingProfile(request)
  if (profile === 'strict') assertStrictStaffQuery(request.nextUrl.searchParams, numericFields)
  return profile
}
