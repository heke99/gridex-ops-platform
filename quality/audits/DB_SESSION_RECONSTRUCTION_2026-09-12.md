# Session reconstruction: native verification and selected-chain completion

Date: 2026-09-12. Scope: isolated database reconstruction only.

**The timestamp229 SQLSTATE42601 blocker is resolved in the isolated selected-chain diagnostic. The complete canonical replay, generated types and release are not accepted.**

## Implementation and source preservation

Starting commit: 57b243734d116c9165ff79a98acccc06742cd961. The implementation was published in 8cacda1614b92f0c808a421ef19138ab659e0fb1, corrected against the actual predecessor in 0bdd572d705927995bd388d05ce061542b3be14b, then cleaned up in 1d40e33cc2d58e274d83a480b2b0cecc096f0fa1. Temporary closed error labels from 0b6f328ddf0301fcda639e0e409c1e84d194255b were removed; the shared private executor is byte-identical to the starting version.

The final implementation diff contains only the three new canonical-live-sync scripts, the timestamp diagnostic hook and its workflow. No API/application source, paused partner-price patch, historical migration, migration manifest or generated type changed. No production SQL, migration-history registration, main merge or deployment occurred.

The historical migration 20260728170000_live_schema_code_canonical_sync.sql contains four successive function-text replacements. Its first replacement removes v_disabled_at's declaration before references are removed, causing compilation failure. The reconstruction replaces only that defective block with the exact complete function already authored in 20260730130000_historical_sync_forward_repair.sql. All bytes outside the block, including the original transaction boundaries and other source effects, are retained.

This is an explicit reconstructed execution, not a claim that the original SQL file executed unchanged. The normal source selector is unchanged; the additional substitution is disclosed in the runtime receipt and is not automatically accepted by the source-effects gate.

## Security and transaction boundaries

The first candidate incorrectly expected a SECURITY DEFINER predecessor. Native tests rejected that preimage. The immutable 20260611190000_launch_linter_hardening_security_definer_rls.sql had changed this helper to SECURITY INVOKER. That source is now pinned and the exact invoker preimage is required.

The corrected reconstruction verifies the explicit invoker-to-definer transition already specified by the complete forward-repair function. This is not described as an unchanged security mode. It requires the exact original body, signature and compiler validation before replacement, then verifies the exact repaired body, configured search path and unchanged function OID, owner, ACL and effective EXECUTE permissions. Unknown preimages fail closed inside the original transaction. No function-validation switch, trigger disable, SQL-error waiver or broad grant is introduced.

## Executed native proof

The verified implementation run was 34718506775, job103619928466, on commit0bdd572d705927995bd388d05ce061542b3be14b. It passed 35 source/constructor tests (8 foundation,13 timestamp,14 new tests) and all six native proof groups:

1. Execute the complete original migration on a clone of the actual228-stage prefix, reproduce42601, and verify catalog and table-row rollback.
2. Execute the complete candidate with an injectedZX001 immediately before COMMIT and verify catalog and row rollback.
3. Execute the complete candidate successfully and verify the exact repaired function plus retained OID, owner, ACL and effective permissions.
4. Reject an altered preimage with55000 and verify no partial effects remain.
5. Run a bounded session/caller fixture: unauthenticated, active, four blocked statuses, disabled_at, two distinct users, supported missing-column/profile/table cases, and anon/authenticated/service_role calls.
6. Apply the reconstructed migration to the actual replay target, verify its postimage and continue the unchanged selected chain.

The cleaned final code head1d40e33cc2d58e274d83a480b2b0cecc096f0fa1 was independently rerun by CI run34718792993/job103620685321. It again passed all35 constructor tests, all six native proof groups,118 foundation inputs and508 timestamp inputs. All cleanup finished successfully at2026-09-12T21:04:24Z. This is a repeat execution, not an independent code review.

The behavior fixture uses the existing auth.uid definition and the exact observed repaired function. It is a bounded function/ACL test, not full managed Auth, two-tenant CRUD or production RLS acceptance. Missing-profile/table behavior is retained from the versioned authority rather than silently redefined.

All118 foundation inputs and all508 timestamp inputs, including all five existing prerequisite boundaries, completed. The previously unreachable later repair executed in its original chronological position. Owned-clone and owned-container cleanup passed.

The runtime was PostgreSQL170005/PostGIS3.5.2, network=none, image postgis/postgis:17-3.5. The observed image ID is recorded in the companion JSON. The tag is mutable, not an immutable input pin, and this runtime is not certified as exact managed Supabase parity.

## Local checks and remaining blockers

The14 new source/negative/fixture-construction tests passed locally after cleanup. The older21 constructor tests were verified in hosted CI, not claimed as an additional local run. Current source accounting was rerun locally:600 inputs,558 FULL_FILE_SELECTED,23 SUBSTITUTED,14 UNCLASSIFIED,5 EXPLICITLY_EXCLUDED;118 foundation/508 timestamp selected; zero input-contract errors; --require-full-effects exits1.

The unchanged normal clean-migration-replay job103620685512 in OPS34718792985 still failed its clean replay/types step on1d40e33. The other quality jobs were not all finished when inspected; no full-CI success is claimed.

Those37 original unresolved dispositions are unchanged. The extra session reconstruction has its own native receipt but has not been independently reviewed or promoted to full canonical source-effect acceptance. Selected-chain SQL success does not justify generating accepted types or marking the migration ledger.

Next database work: independently review the source-bound reconstruction, reconcile the37 unresolved dispositions with actual effect evidence, integrate the accepted reconstruction into the supported canonical CLI/replay path, and only then regenerate and verify types/schema from that accepted replay. Generated-types tail20260911114443 remains unresolved. Full RLS, billing transactions, jobs/point86, remaining API acceptance and final E2E/release review retain their existing gates.

Current-turn publication used actual upstream parents and non-force updates. Individual changed blobs were checked locally; the source artifact was older than the current branch, so complete local-workspace tree equivalence is not claimed. Native CI checked out the exact published head. No separate independent reviewer result is claimed.
