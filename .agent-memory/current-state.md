# Current state — database reconstruction, 2026-09-14

Status: PARTIAL. Main/release and plan points 85/86 are NOT accepted.

## Verified and pushed

- Registered forward: `supabase/migrations/20260913211625_ediel_intent_customer_company_integrity.sql`.
  SHA256 `2b9cc5e9cb7fad14aa4b30e0bc98274a4a957f47379f456ed0d3c9663ef5f39b`.
  Native-qualified code: `76dd87ef62a471a49e8f7fbcbadec25425219cc9`.
- Native FK qualification run34788070725 PASSED. Four combinations of client
  grants and parent company nullability pass. Customer deletion detaches only
  customer_id, preserving company_id and payload. Cross-company/unassigned
  references are rejected; unknown predecessors/dirty rows roll back. Unrelated
  catalog entries, including grants and RLS, remain unchanged.
- The first PR-only candidate was too strict about customers.company_id being
  NOT NULL. Actual Supabase and historical replay both have this parent nullable.
  That regression was reproduced, corrected and retested. The previous candidate
  hash da2d3d... is retained only as an immutable red fixture, NOT release SQL.
- Full selected SQL chain now passes: foundation144 and timestamp514. Residual
  transitions AND original-SQL-absent staged execution passed in
  run34788070766/job103807093120. This is the isolated owned PostgreSQL proof,
  not acceptance of a managed Supabase lifecycle or migration ledger.
- Actual owned shell run34788070766/job103807093005 reaches final schema
  comparison; privacy VERIFIED and disposal VERIFIED. The older five private
  source-writer provenance gaps are not the current blocker.
- Code581ed7c09061ce20fce12d820605064d7f19c540 corrects three historical auth
  group inventories to347 inputs/335 FULL_FILE_SELECTED, with the exact new
  source/hash/timestamp514 pinned. Historical prefixes stay30/31. Publication
  run34788675859/job103808730101 passed those admissions and the6 forward plus
  13 timestamp self-tests. This is not an overall OPS acceptance claim.

## Still blocking

1. Final schema reference reconciliation and independent full semantic parity,
   including all grants/RLS/indexes. Preserve the seven company fields and
   white-label FK: they are present in both history and the connected database.
   No expected fingerprint or baseline was overwritten to force a pass.
2. Ordinary native Supabase clean-migration-replay still uses an unsupported
   launch mode. Implement reviewed native lifecycle ownership/private logging
   and truthful ledger evidence; do not alias owned-compatible as native.
   Read-only inspection found279 actual live ledger rows, latest20260904222450;
   the older48-row August fixture is not current live evidence.
3. Regenerate and verify types only from the accepted schema/lifecycle, then pass
   all mandatory OPS/E2E checks and merge the exact verified PR head. No blanket
   claim that all other CI jobs are green. No checks bypassed or ledger invented.

Evidence: `quality/audits/DB_EDIEL_FORWARD_2026-09-14.md`.
All temporary publishers removed. Main, connected database and deployment are
unchanged. Existing application/API work and paused partner/API patch preserved.
