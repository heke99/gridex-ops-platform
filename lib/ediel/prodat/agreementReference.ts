import { createHash } from 'node:crypto'

/** PRODAT RFF+ANJ (field 261, C506/1154) is an..35. */
export const PRODAT_AGREEMENT_REFERENCE_MAX = 35

/**
 * The agreement reference (RFF+ANJ) a power of attorney is sent with. The website and portal flows name their
 * powers of attorney `POA-<uuid>` (40 characters), which the Z03 envelope preflight refused
 * (UNSM_ELEMENT_LENGTH_INVALID RFF/C506/1154, FINDINGS A-B6), so no website customer's Z03 could be sent. A reference
 * that fits is sent as it is. `POA-<uuid>` becomes `POA` + the 32 hex digits of the uuid (exactly 35, still unique);
 * any other longer reference becomes `POA` + the first 32 hex digits of its SHA-256. Deterministic, so every message
 * about the same power of attorney carries the same reference.
 */
export function edielAgreementReference(reference: string | null | undefined): string | null {
  const value = typeof reference === 'string' ? reference.trim() : ''
  if (!value) return null
  if (value.length <= PRODAT_AGREEMENT_REFERENCE_MAX) return value
  const uuid = /^POA-([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(value)
  if (uuid) return `POA${uuid.slice(1).join('').toUpperCase()}`
  return `POA${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32).toUpperCase()}`
}
