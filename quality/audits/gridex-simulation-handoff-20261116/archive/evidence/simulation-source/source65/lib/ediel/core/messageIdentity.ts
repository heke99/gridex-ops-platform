/** Logical canonical policy identity. Numeric ACK document/status values remain
 * physical source data validated by the common ACK guide; they are not profile
 * codes and must never choose another business rule pack. */
export const CANONICAL_LOGICAL_MESSAGE_CODES = Object.freeze({UTILTS_ERR:'ERR',APERAK:'APERAK',CONTRL:'CONTRL'} as const)
export function canonicalMessageCode(family:string,code:string):string {
  const key=family.trim().toUpperCase()
  return CANONICAL_LOGICAL_MESSAGE_CODES[key as keyof typeof CANONICAL_LOGICAL_MESSAGE_CODES] ?? code
}
/** Same authority for native derivative generation, with no duplicate alias list. */
export function canonicalLogicalMessageCodeProjection(){return CANONICAL_LOGICAL_MESSAGE_CODES}
