# Read-only source-reappearance follow-up

The original reset and post-reset140-table/17-scope zero assertion are retained
as successful historical receipts. A later final assertion found one classified
manual inbound source and its derived event. Its current reset-formula fingerprint
is `42e3d5512970bd2417672f9339e64eef`, different from original
`38ce4b37ae7cea047f146500ef7a6d92`; the manual table was not altered by migration6.
The new source/event creation times are2026-10-13 12:34:07 UTC. The derived event
was updated again at13:55:37 UTC, so the current source is actively reprocessed.

`manual-inbound-reappearance-proof.json` contains only technical IDs, hashes,
classification and runtime-state metadata. No sender, subject, message contents,
credentials or raw provider errors were read. Root owns any fresh classification,
cleanup and final live assertion; this follow-up made no live/source/schema writes.

The exact ingestion path deduplicates only while a raw row with the same mailbox
and provider-message ID exists. After deletion a later provider delivery can create
a new raw row and its correctly anchored derived event. Unmatched rows are
intentionally re-evaluated. The configured manual IMAP poller fetches unseen mail
and marks it Seen only after successful ingestion, while a signed webhook is a
second actual caller and requests retry after failures. Matching production
mailboxes remain active/verified and recently polled, with redacted last errors.

These facts establish the reachable replay mechanism, not the actual original
message identity or current invoking transport. The archive's whole-row hash
cannot prove provider identity; an original provider-key hash or sanitized
transport receipt is needed to distinguish replay from new traffic. The current
FK lifecycle correction works: the event has a valid physical manual anchor and
no deleted customer targets. It cannot suppress a newly ingested raw source.
Do not infer a new migration or blanket producer/mailbox shutdown from this
bounded evidence. Root must record a fresh current outcome; the earlier successful
reset receipt is a timestamped historical observation, not a claim of steady state.
