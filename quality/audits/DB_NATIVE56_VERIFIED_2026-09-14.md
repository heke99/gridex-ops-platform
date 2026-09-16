# Native foundation 1–56 verified — 2026-09-14

Status: VERIFIED for the bounded native1–56 chain; PARTIAL for the full release.
The previous publication blocker and repair56 P0004/P5653 mismatch are SUPERSEDED.

## Published runtime and actual native evidence

- Runtime commit: b1a80fb1829463eea57f026080e248005a720e94.
- Complete source tree: e03c94394d124a42038df6ca63d5a4e38c9423de.
- Parent: d07b84669ab9e76eacd8b9f11ccbf8579a30e857.
- Ordinary OPS run: 34888356621; clean job: 104124511143.
- Native artifact: 10365822727 (gridex-rem-002-clean-replay).
- ZIP SHA256: 3b2add320cbdc5d91b9d59061cb2955e71315e4d0563883c0f006141d143d6b6.
- Native JSON SHA256: 0f99465190dd7e2a3237ef586a442c5f12f89af2a3df3d1c70b6b20e6a77d5a2.
- Official CLI2.101.0; Supabase PostgreSQL17.6.1.106.
- Actual outcome: NATIVE_HISTORICAL_THROUGH56_VERIFIED.

The entire eight-file provider-event patch is published in one normal commit.
No partial candidate is left on the PR branch. All4049 pre-existing tracked
files from the independently downloaded d07b8466 archive were compared with the
published candidate tree: only the six intended existing patch files changed;
the other two patch files are additions. No original migration, application/API
file, company/white-label field or paused partner-price patch was dropped.

## Native53–56 acceptance

All four original R2/E2/S2/W sources execute in one additional atomic CLI unit.
Their source hashes and order are unchanged. The actual CLI file is
20260914194920_gridex_native_f0053_0056_e47b61442e27.sql.
Program SHA256: e47b61442e277345ee327196acf21e297ad0841882c3538da35161c97bbcfbb5.
Ledger statements SHA256: 5a312cc38785562074666d6645d6681998f505a8df27cca59fb241d21329e91d.
The earlier ledger is unchanged. No original historical applied versions are
fabricated. No-op repeat, source-preservation assertions and complete disposal
of private inputs and owned database/network resources pass.

The pristine native-image provider contract matches before repository SQL and
again at native52. Eight event triggers retain their exact reviewed definitions,
owners, grants, configuration and execution flags. No event trigger is disabled
and no privilege is elevated. Provider catalog and sequence definitions are
preserved. GraphQL's cache-version sequence VALUE is explicitly not a business
rollback claim; the provider's DDL invalidation counter is not reset.

| Native negative control | Result |
| --- | --- |
|42501 original provider metadata lock denial|PASS; exact identity checked|
|P0004 original blanket event-trigger ban|PASS|
|Three P0004 expected-contract mismatch controls|PASS; missing item/body/owner|
|P5653 after first complete source|PASS|
|57014 original60-second statement timeout|PASS|
|P5656 after all sources and marker DDL/DML|PASS|
|P5657 in the CLI ledger INSERT|PASS; locks/temp context/timeouts held|

All nine controls preserve the earlier ledger and restore the scoped catalog,
rows and domain sequences. The mismatch controls change the expected contract;
they are not claims that malicious provider routines were installed.

## Independent revalidation and local tests

The downloaded ZIP digest was checked against GitHub's artifact digest. All56
original source hashes,43 prepared prefix program hashes and8 pinned support
hashes match the actual report. Native verified flags, exact nine error cases,
no-op repeat, cleanup and explicit incomplete flags were asserted separately.

Fresh local controls:33 historical +9 lock +22 legacy +44 repair (including
provider/diagnostic tests) +8 ledger +15 lifecycle +14 bootstrap =145 PASS.
Migration integrity:601 files/505 version groups PASS. git diff --check PASS.
These local callbacks are simulated; the native claim comes from the actual
ordinary OPS artifact, not from those unit tests.

## Remaining release gates and whole-PR merge

The ordinary clean job still correctly exits nonzero after native56 with
NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED. Zero timestamp inputs have
executed; completeReplayVerified=false and generatedTypesVerified=false.
The separate full-schema/reference, residual-source and full-E2E workflows fail.
Auth-email-source-effects and the generated-types gate also remain failed.
Do not refresh the type manifest to hide the migration-tail mismatch at
20260913211625_ediel_intent_customer_company_integrity.sql.

The user requires ALL PR310 changes to reach main. Keep the full existing PR
branch and its ancestry; do not cherry-pick only this repair. No main merge is
performed while these mandatory gates fail. Main remained
eb9a25bc989c6de808903f41c2314d5465e9c07b at inspection. PR310 stays draft.
No hosted Supabase mutation/reset or deployment was performed.

## Exact next implementation

Native foundation57, the source-pinned H2 dedupe boundary in
scripts/canonical-user-rbac-dedupe-batch.py. The original H2 SQL has its own
BEGIN/COMMIT followed by a verification SELECT. The existing generic outer-
transaction transfer does not cover that shape: retain the whole source and
qualify the transaction/ledger handling rather than deleting the trailing
verification or claiming rollback across an already committed transaction.
The accepted prefix must feed57, then the fixed-target58–63 atomic group and
remaining foundation64–144/514 timestamp stages. Full independent schema
semantics, auth tests, actual type generation and all required same-head CI
must pass before merging the entire PR.

## Review routing / session record

Supabase, PostgreSQL source-contract review, systematic debugging, differential
review and verification-before-completion apply. The eight-file implementation
and its existing test-driven controls were rerun. No UI, React, deployment,
marketing or unrelated performance work was triggered. The actual source and
CI evidence, not stale PR prose, advanced the accepted boundary from52 to56.
Historical receipts remain preserved; this receipt supersedes only their
unpublished-candidate/current-P0004 status, not the remaining release gates.
