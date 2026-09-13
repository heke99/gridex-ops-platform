# Current state

Updated: 2026-09-12.
Status: PARTIAL

## User scope and active task

Continue masterplan points77–86 in this order: database reconstruction and generated types; the two confirmed runtime faults; full RLS/permissions; native billing transactions; background jobs including point86 STARVATION; resume the paused API remainder; final review, merge and deployment. Point86 is fairness/backlog isolation, not a migration ordinal.

The active task remains database reconstruction and acceptance. The timestamp229 session compilation blocker is now resolved in the isolated selected-chain diagnostic. Do not redo the completed API work or restart the solved SQL investigation. No remaining release gate is waived.

## Published session reconstruction and native evidence

Starting head for this batch:57b243734d116c9165ff79a98acccc06742cd961. Final code head:1d40e33cc2d58e274d83a480b2b0cecc096f0fa1 on PR310 / codex/gridex-parity-remediation-20260905. Only five code/test/workflow paths differ from the starting head. The shared private SQL executor has been restored byte-for-byte after temporary diagnosis.

The reconstruction replaces only the invalid four-call session repair block in 20260728170000_live_schema_code_canonical_sync.sql with the exact complete function from the already-versioned 20260730130000_historical_sync_forward_repair.sql. It preserves all surrounding SQL and the original transaction, checks the exact preimage, retains compiler validation and verifies the final body plus unchanged OID/owner/ACL/effective execute permissions. Historical files and manifests are unchanged. This is explicitly a reconstructed execution, not unchanged historical SQL or automatic source-effect acceptance.

The June11 linter hardening migration had changed the original helper to SECURITY INVOKER. The first candidate correctly failed its incorrectly assumed definer preimage. The corrected code pins that predecessor and verifies the explicit invoker-to-definer transition authored by the complete forward repair. The security mode itself is not claimed unchanged.

Native run34718506775/job103619928466 on0bdd572 passed all118 foundation and508 timestamp stages. The cleaned code1d40e33 repeated the complete result in run34718792993/job103620685321, finishing2026-09-12T21:04:24Z. Both runs passed35 constructor/source tests and all six native proof groups: original42601 plus catalog/row rollback; injected pre-COMMIT rollback; full candidate success with exact function and retained ACL; unknown-preimage rejection without partial effects; bounded session/caller behavior; and actual replay application/continuation. Owned cleanup passed.

The bounded session fixture covers unauthenticated/active/blocked states, disabled_at, two users, versioned schema-compatibility cases and anon/authenticated/service_role calls. It is not full managed Auth or two-tenant RLS acceptance. The runtime remains PG170005/PostGIS3.5.2, network=none; neither the mutable image tag nor its observed ID certifies managed Supabase parity.

## Previous session handoff (superseded by current increment below)

Review the source-bound reconstruction, reconcile the37 original unresolved source dispositions with actual effect evidence, and integrate the accepted reconstruction into the supported canonical CLI/replay path. Only then regenerate and verify the schema/types from that accepted complete replay. Generated-types tail20260911114443 remains unresolved. The selected-chain diagnostic now finishes; the ordinary canonical clean-replay/type gate is still not accepted.

Do not skip source effects, alter immutable migration hashes, manufacture ledger provenance or generate accepted types from an uncertified target. Native boundary success is not an independent code review. No separate reviewer result is claimed for this batch.

## Preserved application work

Application baseline52b2de4d81cae370bf250e5a80f12c300bbddd16/tree76e633e2c7189807ae8b7de297a6d2e6e2343234 and all existing API changes remain intact. The partner-price candidate at quality/paused/2026-09-12-partner-price-wip.patch remains unapplied. The move-out contract, historical migrations, manifests and generated types are unchanged by this session.

## Replay accounting and safety

Working-tree accounting is 600 inputs: 562 `FULL_FILE_SELECTED`, 19 `SUBSTITUTED`, 14 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.
The focused group contains 346 inputs: 314 selected, 17 substituted, 10 unclassified, and 5 excluded.

No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.

At the previous session checkpoint, before this increment, the source-accounting gate was rerun locally after cleanup: zero input-contract errors,118 foundation/508 timestamp selected, --require-full-effects exit1. At that previous checkpoint the37 original unresolved dispositions were unchanged. The new session-block reconstruction is separately disclosed and not misrepresented as raw whole-file execution by the unchanged selection accounting. Fourteen new source/negative tests passed locally; the full35 constructor tests passed in hosted CI.

On1d40e33, OPS34718792985 clean-migration-replay103620685512 still failed its clean replay/types step. Other quality jobs had not all finished when inspected. No full CI/E2E, ledger provenance, generated types, full RLS, main merge or production deployment is accepted.

## Remaining plan and continuity

After accepted database reconstruction/types, fix the recorded missing event_scope in platform market/geodata events and ambiguous metering_points-to-customers embed. Preserve the event_scope check and tenant-composite constraints. Then complete full RLS/CRUD/ACL, native invoice/event/evidence/dispatch transactions, job ownership/scale/recovery/starvation, the paused API remainder and final review/E2E/deployment. Preserve Task11b/12/15/16–18 contracts and source pins.

No managed database SQL or Vercel operation occurred. The previously recorded Supabase name gridex-ops-dev/refpiidsfebjqjmnepdpnas and Vercel deployment dpl_6qevcw57wT7X2p5yd5rQA7hzRq8c do not independently establish deployment/database binding.

Current evidence: quality/audits/DB_SESSION_RECONSTRUCTION_2026-09-12.md and DB_SESSION_RECONSTRUCTION_RECEIPT_2026-09-12.json. Older DB_SELECTED_CHAIN_FRONTIER reports and linked archive/pre-db-frontier-20260912 logs remain historical evidence; their previous timestamp229 blocker is superseded by this checkpoint. Continue quality/plans/2026-09-12-current-and-plan77-85.md with the explicit point86 scope and database-first order above.

Current-turn local work used an older source artifact plus verified relevant files. Individual changed blobs were checked; full local-workspace tree equivalence is not claimed. Published commits use real upstream parents and non-force ref updates, and native CI checked out the exact published code SHA.

## Current increment — baseline probes and four whole-source restorations

Starting head ce1578417b8a0cf5bcc47eae012c480cb3d26703. Exact source recovered at803243a85bd04b6eac34b782b26e10b43c611c14; its complete local Git tree matched the published tree. Baseline probe code54914f5116a07749b7b684fa174e3e24731f2589 ran all37 original residual files on separate owned clones at foundation118 and selected626. Native run34719704518 completed74 probes,50 SQL successes and24 SQL failures, with owned cleanup. A SQL success on a checkpoint clone does not establish valid chronological placement or surviving effects. Permanent metadata evidence: quality/audits/DB_RESIDUAL_SOURCE_MATRIX_2026-09-12.json.

The current candidate uses the existing preserveSourceReplay selector contract for four complete originals: system readiness20260531111600, website foundation20260609162000, canonical platform hardening20260801143000, migration truth20260802232000. All six associated bootstrap artifacts remain checksum-identical prerequisites. The ordinary selector now includes118 foundation and512 timestamp inputs, with these four originals once at ordinals8/38/242/256. The remaining33 original dispositions (19 substituted,14 unclassified) remain blocking; the separately disclosed session reconstruction is not full-effect acceptance.

Targeted local tests passed56 cases (8 foundation,13 timestamp,14 session,12 baseline-probe,9 restoration). New native postconditions cover32 schema/seed/ACL properties and include four isolated negative controls. The candidate's complete512-stage native run is still required before these four restorations are described as verified. Historical migrations, checksum manifests, original foundation order, replay shell, generated types and API code are unchanged. No managed SQL or release action. The completed74-case probe and source export workflows are retired from the candidate, rather than repeatedly executing historical repairs on every push.

Next action: verify the four originals in the complete chronological chain and their native postconditions, then continue the remaining33 source dispositions and the supported canonical replay/type integration. Do not manufacture accepted schema/type artifacts or waive full-effects checks.
