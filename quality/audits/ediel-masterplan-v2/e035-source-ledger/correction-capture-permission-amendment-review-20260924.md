# Task2 correction-capture permission amendment review

**SPEC: APPROVE. QUALITY: APPROVE the proposed narrow correction, subject to actual fix/native verification.** Replace the nonexistent `communication.write` requirement with existing `communication.send` in both the authenticated company-scoped action and the capture SQL owner through a new forward migration. Do not add a permission, compatibility alias, role grant, testing fallback or semantic-review power. This is a bounded implementation-contract correction under the approved operational capture intent; no new policy/role design is needed.

## Evidence and least-privilege assessment

- `lib/rbac/catalog.ts:311–322` defines communication.read as low-risk history access and communication.send as high-risk communication mutation. There is no communication.write catalog entry. Existing tenant/white-label role seed lists reference communication.send.
- `lib/ediel/actionAccess.ts` names communication.send as legacySend and uses it for established operational send-level access. Its communication.write compatibility string does not establish a seeded capability; the broader write helper also admits ediel_testing.write and therefore does not satisfy this task's intentional exclusion of testing-only authority.
- Current capture action requires company-scoped access and an operational company, derives actor from authenticated context, and accepts only source identity plus confirmation. Current SQL additionally requires active profile/company, evaluates actor permission in the selected company, checks sealed source company/environment/hash and uses service-only wrapper access. The amendment can replace only the permission literal while preserving these controls.
- communication.send is stronger existing operational privilege than mere read/test access. Reusing it does not grant users a new send permission: its current holders may perform this bounded unreviewed capture, and all other callers still fail. The endpoint still has no outbound send, semantic review, positive C or correction-cause operation. No generic write/read or test-only permission is substituted.

Existing platform-admin semantics remain whatever the shared guards/resolver already implement; this amendment must not invent a bypass or silently claim every platform admin has a tenant role. For ordinary tenant users, SQL's company-specific permission evaluation remains decisive even if an upstream general guard resolves broader permissions. Preserve the selected-company operational/admin membership check in the action and all SQL active-actor/company checks.

## Required bounded fix proof

1. Action and forward SQL use the same exact communication.send capability. Preserve published migration bytes and update only this task's expectations/fixtures; do not globally rewrite other review owners or add aliases.
2. Native fixture asserts exactly one canonical permission exists and verifies the actor's effective selected-company permission after grant. INSERT SELECT affecting zero rows must fail fixture setup explicitly. Assert actual successful capture and separate witness, not only a mocked permission call.
3. Use a separate active non-platform-admin actor for testing-only denial, preserving the last administrator. Confirm it has ediel_testing.write and lacks communication.send in the selected company; capture must fail without a concern/witness write. Read-only and wrong-company permissions must not acquire authority. Keep inactive actor/company and cross-tenant source negatives.
4. Preserve unreviewed disposition, source byte/hash/2 MiB constraints, separate committed witness and no market-send/semantic side effects. Repeat relevant action/unit and native cases on the corrected final head; current196/204 result is failure evidence, not acceptance of the fix.

This review approves the proposed contract amendment, not yet its implementation or execution. Source review was read-only; no code/schema/memory edits, commits, delegation, tests or live operations. Wrote only this review.
