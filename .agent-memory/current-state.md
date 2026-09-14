# Current state — database reconstruction, 2026-09-14

Status: PARTIAL

Active work: native initialization, historical ACL fixtures, full schema/ledger/types.
Main/release and plan points85/86 are NOT accepted. No hosted database mutation.

## Published and verified

- Correct portable bootstrap now matches a fresh official CLI2.101.0 Supabase
  on48 privilege checks. Exact old bootstrap fails with33 missing grants.
  Code c8c3ac5a45895909b539a942679356fddd8ca72c; run34831307938
  job103935045832 SUCCESS. Both native and vanilla runtimes, synthetic probes
  and private workspace were cleaned. Actual synthetic CLI migration ledger,
  idempotent repeat and failed-migration rollback pass. NOT Gridex history proof.
- Full selected chain with corrected defaults executes144 foundation/514
  timestamp steps (run34830200878). Privacy/restoration/disposal pass. Missing
  reference grants7761->24, policies1886->59, constraints38->11. Full equality
  and final fingerprint remain blocked; expected baseline is unchanged.
- Code ce0bb1b3d24ddaef5024d6fdf04e6a74ec480ebe corrects historical tests that
  incorrectly assumed NULL ACLs or absent initial SELECT grants. Publication
  run34833507044 verified exact tree,5 new probe regressions,19 constructors
  and migration integrity. Actual native OPS reruns remain required.
- Historical readiness views are recorded as client-readable at the intermediate
  source boundary, NOT certified secure. Read-only live inspection shows both
  current views use security_invoker=true and deny anon SELECT; this is not an
  end-to-end row-access test. No current/live grant was changed.
- Prior Ediel customer-only detach forward remains registered and qualified:
  20260913211625_ediel_intent_customer_company_integrity.sql,
  SHA2562b9cc5e9cb7fad14aa4b30e0bc98274a4a957f47379f456ed0d3c9663ef5f39b.
  Not applied to hosted project in this work. The old private source provenance
  gaps are not the current blocker.

## Exact next actions and blockers

1. Read native OPS results for the corrected historical ACL fixtures and fix
   actual failures without removing policy/ownership/row-preservation controls.
2. Implement the supported ordinary native Supabase historical replay with
   reviewed ownership/private logging and truthful CLI ledger. It currently
   rejects direct invocation; never alias the portable diagnostic as native.
3. Reconcile remaining full semantic parity (including RLS/ACL/keys/indexes),
   regenerate accepted types, pass mandatory OPS/E2E and review before merge.

Preserve seven real company fields and white-label FK. Live read-only ledger:
279 rows, latest20260904222450. No artificial mass-applied history, overwritten
schema fingerprint, weakened security gate, type-manifest waiver or main merge.
Existing application/API work and paused partner/API patch are unchanged.
Temporary publication files are removed; permanent read-only fixtures are in CI.

Primary new evidence: quality/audits/DB_NATIVE_BOOTSTRAP_RECEIPT_2026-09-14.md.
Earlier Ediel evidence: quality/audits/DB_EDIEL_FORWARD_2026-09-14.md.

## Machine-checked continuity contract

Working-tree accounting is 601 inputs: 589 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.

The focused group contains 347 inputs: 335 selected, 2 substituted, 5 unclassified, and 5 excluded.

No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
