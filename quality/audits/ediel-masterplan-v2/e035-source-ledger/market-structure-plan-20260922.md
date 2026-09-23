# E035 market-source continuation (from 64bf971)

Status: IMPLEMENTING / NOT MERGE-READY. Existing PR370 and branch retained. Main and PR310 untouched.

This continuation is not a recovery of the unrecovered 5758-test candidate. The exact 64bf971 qualified source archive and tooling lock hash were checked before editing. Existing Z04 live-owner handoff and same-source assessment chronology remain authoritative for their bounded scope.

## Atomic delivery order

1. Original-wire structural scope and source-owned effective dates. Distinguish Z06E/E34 customer-only, Z06F/E64 and Z06G/E32 without meter change, and Z10M/E58 with meter change. Preserve complete physical register membership; no incoming UTILTS-derived expected inventory.
2. Explicit full-source business review separate from safe-apply's partial masterdata writes. Reuse fresh canonical receipt, legal tenant/party/facility owners, actual supply context, immutable assessment history and committed-visibility witness. Add forward-only SQL and actual native tests. A partial proposal or copied approval is not a source approval.
3. Dated coverage and source replacement. Require a proved coverage anchor, never infer pre-ledger history, latest receipt, or arbitrary UUID ordering. Distinguish scheduled effective transitions from explicit same-case correction. Missing owners, ambiguous same-time sources, incomplete register fields and unqualified historical intervals remain unavailable.
4. Integrate source selection before final UTILTS transaction disposition, ACK and quantity persistence. Compare meter IDs and exact register sets/counts under the selected guide. Local evidence unavailability is internal review, not invented E61/E62 or E14, and must not silently ingest as accepted.
5. Same-final-head ordinary CI, native database verification and independent full-PR review. No merge on an intermediate checkpoint.

## Sources and interpretation

Frozen source manifest and existing audited P26.A/U25-A4 clauses retained. Additional Library reads: P26.A r3 pp42-43,50,76,78,92,109-116; U appendix2 p132 and section3.6.8. Pp110-112 defines E58/E64/E32; Pp115-116 requires every register and local field259, not first-register copying. Pp42 BGM5 labels replacement but is not by itself an identifier of the replaced message. Case reference is not a universal cross-message predecessor. Library U file carries a 25-A-4 filename but displayed extracted headers say25-A-5: do not relabel or overwrite frozen sources or claim its original hash was verified. Use unchanged source-owned register/guide contracts and verify interpretations against frozen manifest/native evidence.

Skill routing: narrow code/consumer acquisition, writing/executing plans, TDD, spec-to-code, tenant/security differential review, systematic debugging, verification-before-completion. No production actions, live messages, PR310 code or migration imports, or weakened gates. Isolated tooling-export branch contains no application changes and is not part of the candidate.

## Executed checkpoint: pure source projection

- Original-wire cases: 14 passing tests after observed red failures. Fixtures corrected to actual P field223 CCI++Z13/CAV first component and local259 fourth component; no parser fallback or fabricated acceptance.
- Dated selection/correction projection: 41 passing tests after 16 observed red failures. Exercises effective-time order independent of receipt/UUID, dated coverage bounds, Z06E/F/G semantics, Z10 old/new register inventories, explicit same-case correction, corrected effective date, forks/cycles, unapproved gaps and exact closing/starting boundaries.
- Combined local command: `vitest run __tests__/ediel-structural-source-selection.test.ts __tests__/ediel-structural-source-wire.test.ts`: 55/55 pass. These pure fixtures are NOT a canonical/live-owner acceptance oracle.
- Next: connect actual business review and dated coverage owners, forward SQL and immutable snapshot projection, then final UTILTS consumer before persistence/ACK. No final acceptance or merge claim.


# E035 market-structure implementation checkpoint — 2026-09-22

IN PROGRESS / NOT MERGE-READY. Continue PR370 from published64bf9713b412ef629e7c8ecc6bc575e02ff5968f; no restart of Z04 or assessment-history work. Main remains eb2b8693130af8fa7976a93891b95973bc473b50; PR310 remains OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a.

Implemented candidate: explicit authenticated/company-scoped review of the whole original Z04/Z06E/F/G/Z10M; fresh actual canonical/party/point/switch/supply/outbound reads; durable SQL-revalidated owner and separate witness; post-ledger dated supply coverage; explicit BGM5 same-case predecessor assessment/hash; pure before/after meter/register transitions; own immutable snapshot at processing time for E30/E66/S07 comparison; genuine E61/E62 only for proven mismatch; unknown evidence produces internal review, no APERAK/ERR invention or billing quantities. UI original-review action is separate from partial masterdata safe-apply.

Actual verification so far: root5786/349 PASS; actual canonical fixture5/5 PASS; new qualification6/6 PASS (after root run); original diagnostic invariance54/54 PASS on still-applicable rejection and high-resolution energy-only acceptance; application typecheck PASS. The previous monthly accepted-without-structure characterization is intentionally no longer accepted after October activation; new tests assert the hold, no APERAK fallthrough and no quantity persistence. The initially failing17 old characterization cases were not deleted. Lint0errors/104warnings before removing3 newly unused bindings. Tests/scripts typechecks found2 nullable native-test arguments, now corrected; need rerun. New17-case native suite and authentic forward20260922205926 HAVE NOT YET RUN. Native success and final exact-head gates must not be inferred from these unit results.

Next: execute authentic forward and expanded native suite on isolated localhost Supabase2.101.0/PostgreSQL17; fix actual findings, generated-contract checks; publish candidate in existing PR370, run ordinary exact-head CI and independent whole-PR review. Scope review still required for unresolved/closure sources, agency89, multiple physical messages, delegated sender and date-changing Z04 corrections. These remain fail-closed, not claims of universal business-case completion. Full E035/F3/masterplan NOT COMPLETE. No hosted database writes, deployment or real market messages.
