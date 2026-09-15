# Native foundation1-57 verified — 2026-09-14

Status: VERIFIED for the bounded native1-57 chain, PARTIAL for the full release.
Runtime f0fe979992fb5ba320e7bb089db012e2ecf8b43e; tree a99f82e2b963f143347f8735bfed5f3a483ea92d.
Parent fe4bc0491ae447a89ad05b12c283c807c86c2189. This extends the entire PR310 branch.

## Actual ordinary OPS evidence

Run34892240717; artifact10366968355, gridex-rem-002-clean-replay.
The artifact belongs to the exact runtime commit above. Its downloaded ZIP SHA256
matches GitHub's published digest:
eeee062e7b08b00e55d66c2554a594a4d563337ce0ac8d6ad033373d5efed91b.
Native JSON SHA256:
f524321bbcace18fe0823cec1186e533c93808883c2352d5cdf10ac5d9d94d8f.
Actual result NATIVE_HISTORICAL_THROUGH57_VERIFIED; official CLI2.101.0 and
Supabase PostgreSQL17.6.1.106. Owned/private resources were disposed.

The exact H2 source is executed through the official CLI, without removing its
BEGIN, COMMIT or trailing verification SELECT. Its genuine additional ledger
entry is 20260914202850_gridex_native_f0057_98522e209332.sql. No original applied
version is fabricated. Program/source SHA256:
98522e209332c44c804d7acccf831f25fb13b75b048fbe3613c8d69fcb373a9b.
Ledger-statement SHA256:
a34933bef4c7e9a3515a230e43acb0891cbb49fb77a87298079295b9558bdd36.
The real ledger has47 canonical entries. Its prior46 entries are unchanged.

## Commit semantics, not a false whole-file atomicity claim

H2 commits BEFORE its final SELECT and the CLI ledger INSERT. The parent owns
an isolated, unlinked test database with an admitted empty user_roles preimage.
Unexpected errors terminate that lifecycle; they are not repaired in place.
This is not a generic nonempty upgrade or production-concurrency proof.

Three native fault paths are verified:

- P5750 before COMMIT: SQL transaction rollback removes both new indexes and
  preserves the previous ledger and scoped rows/sequences/catalog.
- P5752 after the complete source: the two indexes remain committed while the
  ledger is unchanged. Their exact oracle-checked definitions are then explicitly
  disposed in the owned test fixture. That disposal is NOT transaction rollback.
- P5751 inside the CLI ledger INSERT: the guard verifies a different transaction
  ID from the source transaction, both committed indexes and the empty role
  preimage. Earlier ledger entries are unchanged. The same explicit test-index
  disposal restores the scoped preimage.

The actual receipt correctly sets sourceAndLedgerAtomic=false and
rollbackAcrossSourceCommitClaimed=false. Domain row/sequence values, provider
static catalog/routine contracts, no-op repeat and complete cleanup pass. The
provider GraphQL cache-sequence VALUE is not claimed to roll back.

## Independent revalidation

Independently rechecked the ZIP and JSON hashes, all57 source hashes,43 prepared
prefix-program hashes and9 support hashes. All three locally regenerated H2
fault-program hashes match the native receipt and the expected commit outcomes.
The positive H2 is exactly its source bytes. No raw historical CLI output or
private fixture identity values are stored in this document.

Local source/control suites on the step57 tree:60 prefix/57 integration,
9 lock,22 legacy,44 repair,8 ledger,15 lifecycle,14 bootstrap =172 PASS.
These local callbacks are simulated. Native acceptance comes from the actual
ordinary OPS artifact, not those offline tests. Original601 migrations /505
version groups retain their checksums. No application/API file changed.

## Release status

The ordinary replay entry intentionally remains nonzero after the bounded
native result: NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED.
completeReplayVerified=false and generatedTypesVerified=false are preserved;
zero timestamp inputs have run. Foundation58-144,514 timestamp stages, full
independent schema equality, the auth-group failure, actual type generation and
mandatory same-head CI/E2E remain separate gates. No main merge, hosted mutation,
reset, privilege elevation or deployment occurred. Merge the ENTIRE PR310 only
when its mandatory gates pass; do not cherry-pick just this continuation.
