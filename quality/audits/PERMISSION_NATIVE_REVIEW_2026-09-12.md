# Task11a independent spec and quality review

## Spec Compliance

- ✅ **Spec compliant for reviewed hosted publication of Task11a.** The frozen nine-file implementation is suitable for the dedicated CI proof gate. This is not migration acceptance: native execution remains **NOT_RUN**.
- Review identity: base `fe25765765d592f4b487321a027ce7032fefcd1e`; frozen uncommitted package `task-11a-review-package-1.diff`. Candidate SHA256 `22572cc31819a52fe577dbaa654dbe84cd6ebc0dd7564ab6f9c4f340cbd5a4fe`. The implementation checks that candidate hash, genuine CLI receipt identity, and matching SDD bytes when present (`scripts/canonical-permission-native-fixture.py:407–418`; `scripts/sql/canonical-permission-native-sources.json:1044–1047`).
- Ordinary eligibility, scoped/direct allow filtering, inclusive override bounds, and override-only veto match the final controller decision. Shared ordinary permissions union the independently overridden company sets. Canonical selection and platform context remain separately preserved (`scripts/sql/forward-candidates/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql:16–211,213–383`).
- The private Storage change retains the original path/ownership/permission body and adds only the operation-specific lifecycle/session conjunction. It retains authenticated/service helper access while the arbitrary-user internals become owner-only, including previously granted custom roles (`scripts/sql/forward-candidates/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql:385–546`).
- The permitted F16 staging exception is explicit: exact selected early policies plus actual restrictive lifecycle guards and fixture-only SELECT grants; the June12/August12/August26 transformations remain deferred (`scripts/canonical-permission-native-fixture.py:99–157,285–306`; `scripts/sql/canonical-permission-native-sources.json:1018–1052`). This approval does not close that remaining full-policy gate.
- The workflow adds only the dedicated native lane, with construction checks, native invocation and an `always()` exact-owned cleanup step (`.github/workflows/ops-hardening.yml:168–187`). No immutable migration, replay registration, production target, application code or existing OwnedPostgres implementation is changed in the frozen diff.

## Strengths

- **Admission precedes execution.** Full parent-file hashes, exact byte slices, function declarations/delimiters, definition uniqueness, finite paths and executable ordering are enforced; read-only witnesses cannot enter composition. The runner completes source and candidate construction before creating the container (`scripts/canonical-permission-native-admission.py:34–141`; `scripts/canonical-permission-native-runner.py:132–148`).
- **Actual authority is preserved.** The real override writer retains its target lock, hash/idempotency, global-row scope, validation and audit/result writes. The real original context, current actor/lifecycle bodies, operation metadata, both role-scope triggers and single-active-role index are admitted instead of being replaced by test authorization functions (`scripts/sql/canonical-permission-native-sources.json:937–1016`; unchanged `supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql:489–734`; `supabase/migrations/20260902091000_company_scoped_permission_engine.sql:242–281`).
- **Assertions distinguish denial from setup failure.** Authenticated/anon invocations assert actor identity and non-superuser/non-bypass flags. Real SQLSTATE checks, affected-row checks, paired own/foreign controls, and table/column privilege negatives prevent missing grants from counting as successful reads (`scripts/canonical-permission-native-fixture.py:48–68,99–123,176–193,285–306,327–365`). Service-role command controls explicitly assert their intentional bypass flag.
- **The finite matrix exercises the settled model.** P28/C32/F16/S24/SX2 includes contradictory override scopes and insertion orders, direct nongrants, inactive identity/membership/role cases, catalog-false deny preservation, shared-company independence, actual 23505 second-role rejection, platform authority versus array contents, paused/viewer writes, foreign rename/upsert, malformed paths and other buckets (`scripts/canonical-permission-native-fixture.py:212–282,327–371,421–428`). Definition-only inactivity is characterized without rewriting the original selection invariant.
- **Native evidence cannot be replaced by a construction receipt.** Nine original-source characterizations must precede candidate application. Every case runs inside BEGIN/ROLLBACK and requires a terminal marker. The runner compares baseline rollback state, candidate row preservation, repeat catalog/ACL state, poisoned-grant recovery and final matrix rollback state before reporting success (`scripts/canonical-permission-native-runner.py:49–64,108–116,140–181`; `scripts/canonical-permission-native-fixture.py:77–96,376–404`).
- **Isolation and privacy are concrete.** The unchanged substrate creates a labelled `postgres:17` container with networking disabled, private client/server logs and exact name/label cleanup. The new runner exposes only finite receipts and admitted diagnostic coordinates, and cannot accept a URL or an arbitrary database (`scripts/canonical-permission-native-runner.py:19–23,43–47,66–116,184–211`; unchanged `scripts/canonical-auth-provisioning-legacy-batch.py:171–280,298–317,460–476`).

## Issues

### Critical

None found.

### Important

None found.

### Minor

None raised.

## Cannot verify / remaining gates

- ⚠️ **Native NOT_RUN.** No Docker, psql or native SQL execution was available or attempted. The reported 21 admission, 5 fixture and 11 runner construction tests are author evidence, not rerun reviewer evidence. Only an actual successful `canonical-permission-native-proof` hosted run against the reviewed bytes can establish that composition, baseline9, candidate102, ACL recovery, rollback and cleanup execute successfully (`scripts/canonical-permission-native-runner.py:140–181`; `.github/workflows/ops-hardening.yml:168–187`).
- ⚠️ Full current public-policy composition, critical CRUD100 and relationship18 remain Task11b requirements. The manifest itself lists the omitted transformations; fixture SELECT/DML grants prove the labelled policy subset, not deployed Data API privileges (`scripts/sql/canonical-permission-native-sources.json:1038–1052`; `scripts/canonical-permission-native-fixture.py:118–124`).
- ⚠️ Managed Storage bytes/API behavior and genuinely revoked-token enforcement are outside this offline SQL fixture. S20 tests the source profile/disabled-at session predicate; it does not test GoTrue/token revocation (`scripts/canonical-permission-native-fixture.py:351–357`; unchanged `supabase/migrations/20260730130000_historical_sync_forward_repair.sql:66–112`).
- ⚠️ Whole effective-schema/replay/types parity, production acceptance and registration among the 600 replay inputs are not established. The candidate remains outside `supabase/migrations`; the operation metadata's Ediel production evidence branch is explicitly unexercised (`scripts/sql/forward-candidates/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql:1–11`; `scripts/sql/canonical-permission-native-sources.json:1025–1031`).

## Review checks and scope discipline

- Read the task brief first, then the reviewer prompt, AGENTS/current continuity material, native/algebra contracts, author report and frozen diff. Applied the task reviewer and Supabase RLS/grants/session/Storage discipline. Root's recorded official-document preflight was retained; no new platform feature or dependency was implemented. No broad audit restart, UI review, installation, subagent, Git/index/branch or memory mutation was performed.
- The initial combined tool response truncated the middle of the package. Recovered the missing diff ranges and cut candidate header from the same frozen package; did not separately reread changed implementation files. A subsequent mechanical diff-coordinate pass produced line references only.
- Focused unchanged-source checks addressed named risks: (1) native target/logging/cleanup safety in `OwnedPostgres`; (2) fixture table/default/generated-column and operation-metadata dependency closure in the admitted bootstrap/schema/operation slices; (3) baseline wrapper/platform/writer contracts and role constraints in their admitted source slices; (4) ACL-target closure, session semantics, both scope triggers and complete predecessor/private Storage policy replacement in their admitted source slices. These checks found no source rewrite or concrete runtime incompatibility; execution remains for CI.
- No author suite was rerun, no SQL was executed and no dependency installation was attempted. The sole written artifact is this report.

## Assessment

**Task quality: Approved for reviewed hosted publication.** Findings: **0 Critical, 0 Important, 0 Minor**. The implementation is bounded, source-admitted and fail-closed at the proof boundary; its construction claims remain explicitly distinct from native acceptance. Root may publish this reviewed batch to the existing PR310 branch and evaluate the actual owned PG17 result before accepting Task11a or proceeding to migration registration.
