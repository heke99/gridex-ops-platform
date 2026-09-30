# UTILTS syntax/header coherent remediation plan

> For agents: use systematic debugging, test-driven development and independent read-only differential/spec review. Keep this as one coupled implementation package, not independent concurrent writers.

**Goal:** Correct the three native defects proved on `e0bd3641f617edb92e508bd62c2767730e20fca1` in draft PR #421, including all affected internal projection/override paths, without changing frozen requirements or external operating state.

**Architecture:** Reuse the existing raw syntax validator before canonical guide/function execution. Extract the existing physical header findings into one pure shared owner; carry explicit header-only provenance to ACK construction and requalify it against the source wire before rendering. Keep per-IDE business outcomes, canonical writer and finalization guards unchanged.

**Global constraints:** No SQL migration, frozen-register rewrite, #418/#422/#310 change, force-push, merge, production deployment, transport/SMTP, staging or counterpart test. Local unit proof is not native proof or whole-rule acceptance. Preserve accepted SC-044 and previous native439.

### Task 1: Establish exact RED and write focused regression tests

- Inspect OPS36702357516/replay109844514929: 439/442; UNT999 persisted accepted data, OTHER retained positive CONTRL, SC045 produced two APERAKs.
- Add test-first ordinary runtime/gateway checks for those boundaries, cached failed-state replay and malformed ERR syntax.
- Verify existing source/facit, real call paths, SQL boundary and independent read-only root-cause reviews.

### Task 2: Implement the complete coupled code package

- Early raw syntax-only result and negative CONTRL, before header/IDE/function checks.
- One negative message APERAK for qualified physical header faults, no invented ACW; finalize all rejected IDE reservations to that ACK.
- Share the existing header guide derivation with the renderer, bounded to actual header tokens; match exact canonical deduplicated error set.
- Preserve provenance through both decision projections, automatic/generic builders and later runtime rebuilds. Certification overrides cannot trump syntax/header gates.
- Repair only UNT counts in semantic fixtures whose intentional segment mutation had left stale arithmetic; preserve fault intent/assertions and native tests.
- Add RED/GREEN probes for independently reproduced override/projection/forgery/dedup defects. Keep original positive ERR behavior outside syntax scope.

### Task 3: Verify, publish and retain honest acceptance boundaries

- Node22 full Vitest suite, quality suite, app/tests/scripts TypeScript, scoped lint, mechanical checks, migration integrity, service-role ratchet, register integrity and differential review.
- Diagnose extra regression failures against the unchanged baseline; do not alter unrelated PRODAT rules or stale source-text checks to obtain green.
- Recheck PR head/comments, publish exact-tree fast-forward to the same draft branch and verify tree equality.
- Inspect the automatically triggered five mandatory workflows on the published head. Native442 and subsequent case/browser/types/schema evidence remain required before approving affected contracts.

Execution evidence and open gates: `quality/audits/ediel-masterplan-v2/utilts-syntax-header-remediation-20260930.md`.
