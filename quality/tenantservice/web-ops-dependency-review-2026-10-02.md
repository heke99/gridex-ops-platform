# Gridex Web OPS dependencies: current review and CI repair

Scope: independent Web tenant/support integration dependencies only. No Ediel
masterplan claim, production mutation, branch publication, merge or deployment.
Read the OPS operating contract, current memory and the tenantservice side-track
checkpoint. Applied differential-review, systematic-debugging, test-driven-development,
direct false-positive verification and verification-before-completion. UI,
dependency upgrades, SQL tuning, hook installation and reusable-skill changes
are outside this bounded review.

## Actual repository and release state

GitHub and a fresh fetch agree on main `61fc46fe8dbf0df5fb940ef85ff8d14063159783`
(PR459 memory and PR460 metering-regression follow-up). Public live manifest
`build_commit` is the same SHA. Direct cache-busting public requests return API
release/minimum tenant integration `2026-10-02.3`. Search-engine cached versions
were stale and are not release evidence.

| PR / candidate | Observed state and evidence |
| --- | --- |
| #454 identity | Open draft, mergeable, head `0351df42a908ff6b939c7f9f3e624b42ff571bee`; OPS 37048728454, browser 37048728489 and full E2E 37048728432 succeed. Production crawler skipped. |
| #456 old schema release | Open draft, conflicting, head `f73b57277a6f916c978f0826a216e77ff0bc1d8f`. Its competing `.3` must not replace the independently published PR457 `.3` bytes. |
| #458 merge lifecycle | Open draft, mergeable, head `356211e42114e51a3d2b069758eb81fe3e13931b`. Tenant, browser and full E2E succeed; OPS 37055739561 fails only in clean replay at the inspected point. Local fix starts from this exact remote head. |
| Replacement schema `.4` | Local `900bdcda` keeps PR457 `.3` and corrects the closed support/manifest schemas. Publication and exact-head CI remain required. |

## Confirmed CI fixture defect and correction

OPS clean-replay job `110999881821` first passes the new lifecycle SQL and all
three concurrent INSERT/UPDATE/contact races. Its final cleanup then deletes
the synthetic company. Automatic company onboarding has published legal text
versions, so that cascade correctly raises `Published legal text versions
cannot be deleted`. The race logic and immutable legal guard are not the fault.

The concurrency fixture now removes its mutable identities, merge/audit events,
customers and actor, while retaining the synthetic tenant and its immutable
onboarding documents until the disposable replay database is torn down. The
success log runs only after cleanup. No trigger or published evidence is changed.

Native reproduction uses real PostgreSQL 16, the existing canonical affected
customer/portal graph and exact canonical legal-template tables, seeding
functions, company insert trigger and immutable legal-text trigger. Synthetic
published terms activate the same failing cascade. This is a bounded native
reproduction, not a full Supabase replay.

| Verification | Fresh outcome |
| --- | --- |
| Unmodified remote fixture with canonical automatic published legal text | RED: exact CI error after all race assertions pass. |
| Corrected fixture on Node 22.23.3 / PostgreSQL 16 | PASS: INSERT/contact wait and recheck; UPDATE conflicts without deadlock; cleanup completes. |
| Post-cleanup query | Zero customer fixture rows; published synthetic legal versions retained unchanged. |
| Changed MJS `node --check` and `git diff --check` | PASS. |
| Existing composed `fc93791a` identity/merge/schema candidate, Node 22.23.3 | 66/66 tests in eight support, attachment, identity, unique-sync and merge suites pass. This evidence belongs to that tree, not the new published PR head. |

## Closed-schema correction remains necessary

Fresh latest-main and direct live `.3` support schemas reject the actual detail
`messages` field. Latest-main website response schema rejects the actual live
release manifest on nine documented-property/enum violations, including
generated metadata, minimum version, immutable URLs and compatibility values.
The replacement `.4` corrects these failures while retaining closed objects and
all prior immutable `.2`/`.3` archives. Its current detail validator accepts
the same synthetic response; composed response/schema tests pass.

## Next actions and boundaries

1. Review and publish this fixture-only repair as a fast-forward to #458; keep
   its lifecycle SQL, schema snapshot and security invariants unchanged.
2. Require the new exact-head OPS replay, generated-type provenance, tenant
   invariants and final schema comparison. Last failed artifact 11248208239
   contains the replay log/snapshot but stopped before type generation; it is
   not full replay acceptance.
3. Reconcile #454 with current main and #458 without dropping either immutable
   identity or merge lifecycle guards. A final composed candidate needs its own
   CI evidence.
4. Publish `.4` separately and supersede conflicting #456. Verify exact-head CI
   and, only after deployment, live manifest, OpenAPI bytes/digests and Web's
   matching generated contract.
5. Apply any eventual OPS migration in its correct production ledger order as
   part of the coordinated release; this review performs no production DDL.
