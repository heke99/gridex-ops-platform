# E035 durable received-source evidence — substantive working candidate

Base: `eb2b8693130af8fa7976a93891b95973bc473b50`, tree `effc5600a2f09e3e21329451b65c10b25f51aa40`.
The extracted accepted source reproduced the exact Git tree before any changes.
PR369 acceptance comment 5768848443 supersedes its stale pre-merge memory. Do not redo PR369.
PR310 remains paused at `e961135199f292b8210884f07de3b616a670161a` and is not a dependency.

## Status and precise boundary

Working implementation, NOT final-PR CI/review acceptance. Native results, when available,
are in `native-preparation-receipt.json` and the exact GitHub preparation run artifacts.
No production database, provider, settings, market-message or explicit deployment action.

This batch implements a forward-only immutable source ledger, an exact persisted read-set,
bounded whole-response physical discovery in the actual UTILTS path, immutable discovery
attempts, and source-bound **canonical-runtime facet assessments** from the live validator
invocation. These are NOT full approved source/object/party dispositions. Missing approval
must stay `not_established` / `not_checked`. No timeline, supersession or E61/E62 selection.

## Source/design and trust boundaries

Reused owners: unchanged `edifactTokenizer`/UNA; existing PR369 insertion sealer;
`resolveInboundTenantForMessage`; actual `resolveCanonicalRuntimeDecisionWithRegistry`;
existing UTILTS runtime/ACK/persistence path. Only the actual fresh decision object enters
the assessment producer, never cached `validation_report`, status or onboarding receipts.
`EdielMessageRow` adds an optional unknown-typed original context already returned by
`getEdielMessageById`'s SELECT *. This is a DTO clarification, not fabricated generated SQL types.

The private ledger captures AFTER INSERT under a migration installation lock. It has no
FK/cascade from operational messages or company links. Retries do not recapture. Missing
original bytes/context/time remain unknown. Existing rows are not backfilled. Original
company/environment survive operational reattribution/deletion. Reusing a deleted source
UUID fails instead of replacing history. Lawful retention/purge policy remains unresolved;
there is no new purge/export endpoint and no claim of resistance to a database superuser.

Source count, budgets and returned rows are from one MVCC query. Its immutable manifest
and MVCC descriptor are saved in that transaction. Subsequent commits cannot expand the
saved read-set. This is NOT reconstruction of historical transaction-commit visibility.
1001 is an overflow sentinel; limits return an incomplete empty set, never a complete
prefix. Per-source original receipt/context/scope and exact microsecond cutoff validation
precedes any source identifier disclosure. Physical LIN grouping never replaces canonical
register-chain, accepted legal-party or per-object tenant validation.

Only service-role invoker RPC facades may create snapshots/discoveries/assessments.
Private definers have fixed paths and explicit revoked PUBLIC execution. No caller role,
including service_role, receives direct evidence-table write rights. Human reads use the
existing company/session predicate under enabled/forced RLS. Engine evidence cannot carry
approval fields. Persisted observations bind source UUID/hash and exact snapshot hash;
assessment facts bind original source bytes, current actually resolved tenant, real rule
pack/profile/hash, decision reasons and a database decision time. Concurrent corrections
append a single per-source predecessor chain, with no overwrite or automatic supersession.

A transport/receipt error is an UNCONFIRMED transaction result, not a claim of rollback.
It is a redacted diagnostic and never changes the existing business ACK/persistence/ingestion
decision. The old linked-source reader remains unchanged alongside the durable path.

## Verification history (do not overstate)

The original 89 inventory assertions were migrated to the normal Vitest test location;
assertions retained, fixture typing made explicit. Another 60 behavioral tests cover
snapshot receipts, scope boundaries and actual-owner facet preparation. All 149 passed
strict isolated TS5.8.3 compilation and execution through a local node:test adapter; this
is not root npm/Vitest execution. Four self-run behavioral mutation probes caught wrong
receipt-hash acceptance, tenant-owner bypass, count bypass and lost microseconds; originals
were restored and all149 passed. The 60 additional tests were not all independently run
red before implementation. No self-run probe is independent review.

Native preparation must generate the real migration with the pinned CLI, apply the real
file through CLI while proving concurrent installation lock behavior, preserve prior
62+84 SQL/3 upgrade controls, exercise the new SQL actor/immutable evidence suite, verify
concurrent read-set and assessment behavior, generate real repeated types/schema and lint
new private functions. `gridex-schema-snapshot.cjs` now additionally covers the private
schema; no old schema section or policy check is removed. Prep workflows/archive/tooling
are not final delivery files. Final ordinary exact-head CI and independent TASK/SPEC,
QUALITY, TENANT-BOUNDARY and WHOLE-PR review remain mandatory before any merge.

## Still substantive work, not a completed E035 certificate

Full source disposition requires real **per-object canonical register, original/accepted
tenant, legal-party and business-acceptance owners**, with explicit accepted/rejected/
unavailable outcomes and correction linkage. Current canonical field acceptance is only
a facet; it cannot approve every physical object or a source for comparison. Unknown
historic coverage, bounded overflow and unresolved identities must keep completeness
closed. Then implement dated timelines, supersession and authoritative expected selection
for E61/E62. Full E035/F3/masterplan remain incomplete; D110/110 + parents10/10 retained.
