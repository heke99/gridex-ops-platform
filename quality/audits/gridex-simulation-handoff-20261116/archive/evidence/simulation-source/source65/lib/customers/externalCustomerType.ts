export type ExternalCustomerType = 'private' | 'business'

export type ExternalCustomerTypeResult =
  | { ok: true; value: ExternalCustomerType | null; deprecatedAlias: 'company' | null }
  | { ok: false; value: null; deprecatedAlias: null }

export function normalizeExternalCustomerType(value: unknown, options: { allowEmpty?: boolean } = {}): ExternalCustomerTypeResult {
  if (value === undefined || value === null || String(value).trim() === '') {
    return options.allowEmpty === false
      ? { ok: false, value: null, deprecatedAlias: null }
      : { ok: true, value: null, deprecatedAlias: null }
  }

  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'private' || normalized === 'business') {
    return { ok: true, value: normalized, deprecatedAlias: null }
  }
  if (normalized === 'company') {
    return { ok: true, value: 'business', deprecatedAlias: 'company' }
  }
  return { ok: false, value: null, deprecatedAlias: null }
}
