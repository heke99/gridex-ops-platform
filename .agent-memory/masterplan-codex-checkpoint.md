# Codex — masterplan v2, TEN-07

Status: IN_PROGRESS. User authorized parallel implementation with the Claude
agent on PR #491 and requested ongoing documentation and mutual updates.

## Ownership and coordination

- Claude owns PR #491 (`claude/cool-tesla-2pmyua`): TEN-01/02/05/06,
  U-04/U-14, tenant resolution and upgrade CI.
- Codex owns `codex/ediel-ten07-projection-20261004`, based on main
  `fa4147b33dd3215c150cbe91d755db30e5ae6c62`: TEN-07 and AT-TEN-07,
  scoped beneficiary projections and grant distribution.
- Coordination: https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5981383983.
  Claude read and accepted coordination in comment 5981418363. TEN-08 and
  TEN-10 already belong to Claude; Codex relinquished TEN-08 before editing code.
  Claude completed ESCO-01..09 and moved to ACK-04/05. ESCO-10/11 were explicitly handed to Codex in #491 comment 5981510627; Codex accepted in 5981578006.
- Separate checkout: `/workspace/gridex-masterplan-codex`. No writes to
  Claude's branch or its tenant resolver files. This file is Codex's resumable
  checkpoint; Claude retains the shared current-task/checkpoint/handover files.
- Coverage changes are limited to owned IDs after all effects pass. ESCO-10/11 are still unapproved pending the native test run.
  Generated database artifacts require coordination before either agent edits.

## Skill routing

Active: using-superpowers; using-git-worktrees (isolated checkout);
executing-plans (existing rule cards); code-review; verification-before-completion;
spec-to-code-compliance (independent bounded rule review); Supabase (database
grant and projection boundaries). Conditional: systematic-debugging and
test-driven-development for a confirmed defect; Postgres best practices for
SQL changes; finishing-a-development-branch for publication. UI, performance,
hook installation, supply-chain audit and skill authoring have no trigger in
this bounded rule implementation.

## Work plan and evidence

1. Read TEN-07 and its original acceptance contract; map every expected
   and prohibited effect to real caller, SQL owner and asserting behaviour test.
2. Run existing projection/grant baselines. Add missing behaviour tests and
   repair only reproduced implementation gaps; use forward migrations if needed.
3. Independently review the complete rule, run applicable checks, then
   approve only the effects actually verified. Publish a small separate PR.
4. Post changes, test results, blockers and next action to #491; preserve
   Claude's verification and coverage rows during integration.

Completed: identified non-overlapping scope and published ownership. Existing
projection adapter/API and SQL regression owners located. No source change or
rule approval yet. Production/schema/market activation not performed.

Parallel #491 review: 38/38 targeted TEN tests PASS on `23b28318` with Node
22.23.3; U-04/U-14 PGlite regressions PASS (6 + 13 + 10 checks). Sandbox
initially denied child execution (EPERM); the permitted test run passed.
Upgrade-input selftests 8/8 PASS (control-plane only, no native SQL claim).
TEN-06 possible approval gaps are being reproduced and belong to Claude.

Next action: establish the TEN-07 baseline and add assertions for complete
object/product/period/field scope, raw-owner preservation, distinct beneficiary
grants and unchanged market reception/ACK state.

## 2026-10-04 — initial implementation baseline

- Projection/API: 28/28 tests PASS on main base (Node 22.23.3).
- Projection SQL chain PASS: 23 service-scope, 21 grant-set, 4 replay,
  11 provenance and 48 administration checks. Supply EDIEL_SQL_REPOSITORY
  explicitly; source/legal/accepted-storage ports are declared finite fixtures.
- TEN-06 issue reproduced with parser + real resolver; normalized UTILTS_ERR
  restores UNB as legal receiver and resolves a permitted-role identity despite
  missing MR. Handed to Claude in #491 comment 5981434845. No ACK/business
  effect claim. Temporary probe removed from isolated review checkout.
- Next: add TEN-07 assertions for same-source sibling object, product/time/field
  restrictions, original bytes/company ownership and unchanged market ACK state.

## 2026-10-04 — verified projection and original boundary

- TEN-07 / AT-TEN-07 approved only after independent complete-rule review
  by ten07_rule_review: no open effects or confirmed source defects.
- 45/45 targeted API/provenance/original adapter tests PASS; 2/2 node:test
  consumers PASS (17 scoped projection effects +14 transport-copy checks).
  Projection effects execute the final 20261001035402 public RPC, with
  explicitly finite upstream attribution/storage/review dependencies.
- Complete unit suite: 9504/9504 tests, 725 files PASS with the repository's
  unit-loopback-network-boundary preload, Node 22.23.3, two thread workers.
  First run without CI preload had three canonical-header timeouts; the
  same file passes 3/3 separately and the corrected complete suite passes.
- Integrity, immutable migrations/checksums, generated types, service-role
  ratchet, application/tests/scripts typechecks and targeted ESLint PASS
  (CJS intentionally ignored by existing ESLint config; node:test executes it).
- Tagged approval check PASS before final ESCO tag additions; rerun next.
- Claude reproduced and fixed TEN-06 in e1024f09 and ran 194 resolver tests;
  acknowledgement in #491 comment 5981510627. No processor-write-order
  claim beyond the reproduced attribution gap.
- ESCO-10 reviewer requires genuine received-binding receipt assertions.
  ESCO-11 reviewer requires current archive/separate-review legal/data basis,
  rather than the finite review dependency in the projection consumer fixture.
  Added scripts/ediel-esco-10-11-projection-native.test.ts to the mandatory
  source-owner suite: receipt source/hash/members/version and accepted contract,
  no invented permission field, same-object/shared-SMTP ungranted tenant,
  exact DGI/sender/purpose/quality, downstream/privacy representation revocation,
  and unchanged original/retained projection receipts. Native run not executed
  yet; ESCO-10/11 coverage remains NOT_VERIFIED/NOT_EXECUTED.
- Native environment attempt: Docker available, no running containers.
  Supabase CLI cache creation failed in read-only home. Automatic approval
  rejected a proposed helper container with host networking + Docker socket
  as too broad. No helper container started; use existing isolated GitHub
  native CI, without bypassing that rejection. Separate unused native clone
  remains at /workspace/gridex-masterplan-native; original workspace untouched.
- This is a bounded rule implementation, not a repository-wide quality audit;
  the quality-playbook bootstrap has no trigger and would collide with Claude's
  unrelated work. Existing requirements + independent rule review are used.
- Publication follows finishing-a-development-branch and the explicit user
  instruction to continue via GitHub; the already-authorized small-PR workflow
  is retained. No additional integration-choice question is needed.

## 2026-10-04 — publication, CI and ownership refresh

- PR #497 published and attached, initial head 5fdeaf6c8a39a7b2f0d6c2ccd3f5206f50e1d591.
  Exact-head verify, targeted-regressions, coverage, smoke, browser-public and
  pr-certificate PASS. Clean native replay still running; ESCO approvals pending.
- Upgrade replay failed before database work: old d30fa02 is not an ancestor
  after the split stack. Main remains fa4147b3; the initial guess that main
  advanced was corrected publicly. Reuse Claude's A1/H1 CI fix, announced in
  #491 comment 5981874579, rather than implement a parallel CI change.
  Cherry-picked aa2b9d52 as a05c0fb4 and b46a4b60 as 38ebf103, preserving
  authorship. The final upgrade script is byte-identical to 4e71907d; unrelated
  historical helper-file removals and Claude's shared memory edits are excluded.
  Upgrade input selftests 8/8 PASS, bash syntax PASS; no SQL replay claim yet.
- A narrowly approved empty /home/agent/.supabase cache directory unblocks the
  ordinary pinned CLI (2.101.0 --version PASS). The rejected broad helper
  container remains unused. Native proof continues through existing GitHub CI.
- Fresh #491 comment 5981759242 reports TEN-09 already approved by Claude.
  Codex stopped the separate implementation/coverage before changes; comment
  5981860401 records only complementary review of explicit permission reuse.
  Claude now owns remaining P and U cards; no Codex claim on them.

Next: publish the reused CI fixes, examine genuine native results and repair
any failing assertions. Complete and share the bounded TEN-09 review probe;
coordinate remediation with Claude, preserving his single coverage row.

## 2026-10-04 — current main integration

- Claude reports main's authoritative upgrade/history repair in #491
  5982277365. Fetched main 8f3b42f1 and merged it into this isolated branch.
  Upgrade/history-union/applied-TXT scripts and SQL fixtures are taken byte
  for byte from that main, superseding the earlier coordinated A1/H1 reuse.
  Resolved only the two CI script conflicts; retained native ESCO tests and
  main's new staff migrations/config inclusion without editing SQL history.
- Main's upgrade-input selftest 8/8 PASS; bash syntax and git diff --check PASS.
  The known missing marker in the intentionally divergent fixture is expected.
  Real current-head replay remains a GitHub CI requirement.
- The old a01e8dfc CI had verify/upgrade/quality and all auxiliary checks PASS;
  clean replay was still running. Its results cannot certify this merged head.
- TR-01/02 continue in a separate branch with a separate resumable checkpoint.
  User explicitly requires publication of all results and main integration
  after review and CI; status posted in #491 5982337348. Claude keeps TEN-09
  resolver ownership and conservative owner decision 5982240442; Codex has
  made no resolver changes. ESCO-10/11 remain unapproved until genuine native
  assertions execute successfully.

Next: publish the main merge, inspect exact-head native results and integrate
after required checks pass. Continue TR review closure and remaining cards.
