# F1-C: immutable guide authority and valid calendar dates

Base: main `71dc255e5d698e4fb8c9102562b518777db6b1b0`, tree
`fb0da2df576fca5f8a870edc3248d68cf9fe7469` (after PR320 and PR321).
The local source archive was SHA-256 checked against GitHub artifact10470382510;
its reconstructed Git tree matched main exactly. PR310 is paused and untouched.

## Contract and confirmed defects

Masterplan GOV-01 and section3 require source-owned rules rather than mutable
per-request authority. TypeScript readonly does not freeze a JavaScript array:
callers could append/reorder/replace guide entries, change a selected revision or
validity window, or change the nested activation dates before another request.

The guide normalizer checked only date shape. Impossible days such as2026-09-31
could select a guide. This was reachable through the direct selector, acceptance,
inbound guide lookup, current UTILTS helper, version selector and policy resolver,
even though the separate activation-evidence RPC boundary already rejects them.

## Resolution and bounded acceptance

Freeze the registry array, every source record and its nested activation date
array at module initialization. Validate the normalized calendar date by a UTC
roundtrip, rejecting year0000 and rollover dates. Preserve existing valid dates,
caller date-prefix semantics, leap-year rules, source-family APERAK selection,
current-only outbound selection and inclusive two-week inbound grace. No current
clock is introduced. The version selector's pre-existing missing-date fallback is
not changed. No rule constants, RPC signatures, SQL, generated types, external
payloads, source hashes or original normative files are changed.

## Verification

New98-case actual-source harness: before correction19 passed/79 failed; after
correction98 passed. The final98 cases pass separately under UTC,
Europe/Stockholm and Pacific/Apia (98 distinct tests, not294 distinct tests).
The existing source-identity, PRODAT locator and component-escaping harnesses pass
112/112 together. APERAK canonical evidence guard and immutable masterplan
integrity pass (33 source-package files,121 rules,231 acceptance contracts).
Local full npm install failed ENOTCACHED; full Vitest/typecheck/build must be
provided by normal exact-head GitHub CI. Local checks are not claimed as that CI.

This completes these two reproducible guide-boundary defects, not all GOV-01,
F1, the masterplan or live certification. Original-file acquisition/provenance,
full register overlays, energy-sharing capability and TGT evidence remain open.
PR319's stale generic16-B assertion is not imported. Its valid date/family boundary
coverage is replaced by this source-executing harness plus existing CI suites.

## Skill routing and review

Used source/contract comparison, systematic debugging, TDD, variant analysis,
differential review and verification-before-completion. Re-read project memory,
implementation and callers before changes. No independent subagent/human review
is claimed. SQL/RLS, frontend, deployment, performance and dependency-upgrade
skills are not active: none of those surfaces change. Full required CI and review
threads are checked before a SHA-guarded merge. PR310 is not resumed.
