/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// VENDORED COPY. Origin: claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426:scripts/reality/simulators/platformMailbox.ts
// Only the edits listed in chain/vendor-sync.py PATCHES (and @/ import rewrites) differ from the origin.
// Where a counterparty sends a file: the platform's shared Ediel mailbox of the file's own lane. The platform stores
// every inbound file in the lane of the mailbox it arrived in, so a production answer mailed to the test mailbox
// becomes a test message and no longer matches the production original it answers (FINDINGS T7). The lane is read
// from the file's UNB test indicator, as the receiving system does.
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'

export function platformMailboxFor(edifact: string): string {
  const production = EdifactEnvelopeCodec.decode(edifact).environment === 'production'
  return production
    ? process.env.GRIDEX_SHARED_EDIEL_PRODUCTION_EMAIL ?? 'gridex-ediel@example.invalid'
    : process.env.GRIDEX_SHARED_EDIEL_TEST_EMAIL ?? 'gridex-ediel-test@example.invalid'
}
