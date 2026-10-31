/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// VENDORED COPY. Origin: claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426:scripts/reality/simulators/gridOwnerProfile.ts
// Only the edits listed in chain/vendor-sync.py PATCHES (and @/ import rewrites) differ from the origin.
/** How the simulated grid owner (gridOwner.ts) answers our files. Kept apart so it can be tested without the server. */
export type GridOwnerProfile = {
  /** Answer our files at all (a silent counterparty tests our deadline handling). */
  respond: boolean
  contrlDelayMs: number
  aperakDelayMs: number
  /** Delay of the Z04 that confirms a switch request (Z03). */
  z04DelayMs: number
  /**
   * Delay of the Z02 that answers a customer information request (Z01). Separate from z04DelayMs: a scenario that
   * leaves switch requests unanswered must still get the facility facts a website customer's Z01 asks for (FINDINGS K-B4).
   */
  z02DelayMs: number
  /** Share of switch requests rejected with a negative APERAK instead of Z04. */
  rejectShare: number
  /** Share of outgoing files sent twice (duplicate delivery). */
  duplicateShare: number
}

export const DEFAULT_GRID_OWNER_PROFILE: GridOwnerProfile = {
  respond: true, contrlDelayMs: 30_000, aperakDelayMs: 60_000, z04DelayMs: 120_000, z02DelayMs: 120_000, rejectShare: 0, duplicateShare: 0,
}

/** The delay of the grid owner's business answer to one of our PRODAT files, or null when it sends none. */
export function businessAnswerDelayMs(profile: GridOwnerProfile, code: string): number | null {
  if (code === 'Z01') return profile.z02DelayMs
  if (code === 'Z03') return profile.z04DelayMs
  return null
}
