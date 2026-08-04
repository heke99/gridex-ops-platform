# PHASE-43 next actions

1. Sync this delivery into the Git checkout and review the focused changed-file list.
2. Run `npm ci` with Node 22, then the full project typecheck/test/lint/build gates.
3. Deploy OPS after confirming the already-applied migration appears as
   `20260804190000` in the target database ledger.
4. Invoke the authenticated grid-area import cron repeatedly until `hasMore=false`.
5. Verify the current geodata version is `verified`, its source/layer are current,
   and active geometry/grid-area counts are non-zero.
6. Create a real SE-area quote and application, sign the customer contract, ingest
   metering values and generate a billing underlay.
7. Prove the underlay header/items and invoice readiness all retain the exact locked
   snapshot area and that an intentional mismatch is blocked.
