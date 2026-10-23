// The reality harness clock: how long a loop waits between two looks at the world.
//
// Two kinds of waits exist in the scenarios, and only the first may be compressed:
//
//  (a) cronTick: a loop that runs the platform's crons (runOperationalCronSlot, the inbound lanes) and then polls for a
//      condition the world reaches by itself (a Z04 arrived, every file received, a Z01 sent). The default cadence is
//      one look a minute, like Vercel's every-minute crons. GRIDEX_REALITY_TICK_MS compresses it ("fast mode",
//      e.g. 3000): slots run back to back and the loop leaves as soon as its condition holds. Every assertion, cron
//      path and deadline stays the same; deadlines remain wall-clock upper bounds, never waits.
//
//  (b) wallClockWait: real time must pass because product logic reads the wall clock (ACK SLA watches 30 min, a
//      rate-limit window, a fixed observation window for a negative proof). These are never compressed. A loop that
//      only waits for such a timer polls at the default minute cadence (loopTick(true)): faster polling proves nothing
//      more and only multiplies cron runs and report rows.
//
// Product cadence that bounds fast mode (not the harness): the shared Ediel mailboxes are polled only when due
// (ediel_mailboxes.poll_interval_minutes = 5, lib/inbound-mail/edielMailboxPoller.part-1.ts isEdielMailboxDueForPolling)
// and at most EDIEL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX (25) mails per mailbox and poll. Fast mode reaches each due poll
// within one tick instead of up to a minute late; it cannot make a mailbox due earlier.

/** Today's cadence: one look a minute. */
export const DEFAULT_TICK_MS = 60_000
const MIN_TICK_MS = 250

function readTick(): number {
  const raw = process.env.GRIDEX_REALITY_TICK_MS
  if (raw === undefined || raw.trim() === '') return DEFAULT_TICK_MS
  const value = Number(raw)
  if (!Number.isFinite(value) || value < MIN_TICK_MS) throw Error(`GRIDEX_REALITY_TICK_MS must be a number of milliseconds >= ${MIN_TICK_MS} (got "${raw}")`)
  return Math.round(value)
}

/** One harness tick in milliseconds (GRIDEX_REALITY_TICK_MS, default 60000). */
export const REALITY_TICK_MS = readTick()
/** True when condition-polling loops are compressed. */
export const FAST_CLOCK = REALITY_TICK_MS < DEFAULT_TICK_MS

export const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** The compressed length of a condition-polling interval that is `nominalMs` at today's cadence. */
export function tickMs(nominalMs = DEFAULT_TICK_MS): number {
  return Math.max(MIN_TICK_MS, Math.round((nominalMs * REALITY_TICK_MS) / DEFAULT_TICK_MS))
}

/** (a) The pause between two looks of a loop that waits for a condition the world reaches on its own. */
export function cronTick(nominalMs = DEFAULT_TICK_MS): Promise<void> {
  return pause(tickMs(nominalMs))
}

/** (b) A wait that lets real time pass because product logic depends on the wall clock. Never compressed. */
export function wallClockWait(ms: number): Promise<void> {
  return pause(ms)
}

/**
 * The pause of a loop that first waits for the world (compressed) and then only for a product timer
 * (e.g. the 30-minute ACK watches): compressed while `onlyWallClockLeft` is false, a real minute after.
 */
export function loopTick(onlyWallClockLeft: boolean): Promise<void> {
  return onlyWallClockLeft ? wallClockWait(DEFAULT_TICK_MS) : cronTick()
}

/** What a report records about the clock it ran on. */
export function clockSettings() {
  return { tickMs: REALITY_TICK_MS, fast: FAST_CLOCK }
}
