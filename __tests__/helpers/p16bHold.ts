import {expect} from 'vitest'
import {diagnoseProdatAperakOwnReferenceConflict} from '@/lib/ediel/core/unsmSourceConflicts'

/** Blocked send-mode APERAK payloads seen by the real payload preflight. Test
 * files route preflight through captureP16bPreflight (vi.mock delegating to the
 * actual implementation); nothing here changes a preflight outcome. */
export const p16bBlockedAperaks: string[] = []

export async function captureP16bPreflight(importOriginal: () => Promise<Record<string, unknown>>) {
  const actual = await importOriginal() as {preflightEdielPayload: (input: {rawPayload?: string | null}) => {blocking: boolean}}
  return {...actual, preflightEdielPayload: (input: {rawPayload?: string | null}) => {
    const result = actual.preflightEdielPayload(input)
    if (result.blocking && typeof input.rawPayload === 'string' && input.rawPayload.includes('APERAK:D:96A:UN')) p16bBlockedAperaks.push(input.rawPayload)
    return result
  }}
}

/** The documented P16B hold (P16B_APERAK96A_OWN_Z07_LI_CARDINALITY): the national
 * guide requires own RFF+Z07 and RFF+LI in one ERC, D.96A SG4 is C1. Until an
 * external normative clarification exists the own APERAK is held fail-closed:
 * every blocked APERAK must be exactly that diagnosed conflict, and at least one
 * must exist. Any other structural failure does not satisfy this helper. */
export function expectP16bHold(sourceRaw: string, blocked: readonly string[] = p16bBlockedAperaks) {
  expect(blocked.length, 'an own APERAK must actually have been rendered and held').toBeGreaterThan(0)
  for (const raw of blocked) {
    const conflicts = diagnoseProdatAperakOwnReferenceConflict(raw, sourceRaw)
    expect(conflicts.length, 'held APERAK must be the exact P16B dual own-reference conflict').toBeGreaterThan(0)
    expect(conflicts.every(conflict => conflict.blocking && conflict.conflictId === 'P16B_APERAK96A_OWN_Z07_LI_CARDINALITY')).toBe(true)
  }
}
