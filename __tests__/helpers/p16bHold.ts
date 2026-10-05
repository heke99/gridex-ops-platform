import {expect} from 'vitest'
import {validateUnsmGrammar} from '@/lib/ediel/core/unsmGrammar'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'

/** Blocked send-mode APERAK payloads seen by the real payload preflight. Test
 * files route preflight through captureP16bPreflight (vi.mock delegating to the
 * actual implementation); nothing here changes a preflight outcome. */
export const p16bBlockedAperaks: string[] = []

export async function captureP16bPreflight(importOriginal: () => Promise<Record<string, unknown>>) {
  const actual = await importOriginal() as {preflightEdielPayload: (input: {rawPayload?: string | null}) => {blocking: boolean}}
  return {...actual, preflightEdielPayload: (input: {rawPayload?: string | null}) => {
    const result = actual.preflightEdielPayload(input)
    // P16B resolved: every rendered own APERAK E2SE6A is captured for assertion.
    if (typeof input.rawPayload === 'string' && input.rawPayload.includes('APERAK:D:96A:UN')) p16bBlockedAperaks.push(input.rawPayload)
    return result
  }}
}

/** P16B resolved (owner decision 2026-10-02): the formerly held dual
 * own-reference APERAK is now rendered. Every captured APERAK must carry the
 * Z07+LI pair in one ERC and pass the full grammar. */
export function expectP16bHold(_sourceRaw: string, rendered: readonly string[] = p16bBlockedAperaks) {
  expectOwnReferencePair(rendered)
}

/** P16B resolved (owner decision 2026-10-02, national guide P26A/16B p105):
 * an own APERAK E2SE6A carries RFF+Z07 then RFF+LI in one ERC and passes the
 * full D.96A grammar with only that pair widened. Asserts every given APERAK
 * wire is such a valid dual-own-reference reply. */
export function expectOwnReferencePair(raws: readonly string[]) {
  expect(raws.length, 'an own APERAK must actually have been rendered').toBeGreaterThan(0)
  for (const raw of raws) {
    expect(raw).toContain('APERAK:D:96A:UN:E2SE6A')
    const wire = tokenizeEdifact(raw), segments = wire.segments
    const pairs = segments.flatMap((segment, at) => segment.tag !== 'ERC' ? [] : [segments.slice(at + 1).filter((next, i, rest) => rest.slice(0, i).every(prior => prior.tag !== 'ERC' && prior.tag !== 'UNT') && next.tag === 'RFF').map(ref => segmentComposite(ref, 1, wire.una)[0])])
    expect(pairs.some(qualifiers => qualifiers.join(',') === 'Z07,LI'), 'an ERC carries RFF+Z07 then RFF+LI').toBe(true)
    expect(validateUnsmGrammar(raw).issues.filter(issue => issue.severity === 'error')).toEqual([])
  }
}
