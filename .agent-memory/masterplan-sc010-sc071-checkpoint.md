# SC-010 / SC-071 — grant revalidation

Agent: Codex grant-revalidation-20261005. Status: component VERIFIED; whole SC-010 BLOCKED, publication/review/CI/integration pending. No whole-scenario approval.
Branch: `codex/ediel-sc010-sc071-grant-revalidation-20261005`.
Checkout: `/workspace/gridex-sc010-sc071`.
Base/source commit: `985724f58ef15e222cf4d3b2e1c643c674852106` (actual main, 2026-10-05).
Exact technical/component commit: `b06c58fd837f2405ee20eafcd82dbaded025c1c1`; later document-only HEAD is read from Git. Tests/production inputs do not change in the metadata follow-up.
Claim: https://github.com/heke99/gridex-ops-platform/issues/530#issuecomment-5991253973.

## Scope and ownership

Own NEW test: `__tests__/ediel-sc-010-071-grant-revalidation.test.ts`.
Own evidence: `quality/audits/ediel-masterplan-v2/sc010-sc071/`.
Existing TEN-10/TEN-12, projection, administration/revocation, SQL/native fixture and integration owners retain all their paths. No shared-memory or coverage edits are reserved before full proof. The initial checkout in `/workspace/gridex-ops-platform` remains untouched.

Complete board530 (90 comments) and coordination491 were read before claiming, together with 69 open PR filename inventories. Pagination was subsequently expanded to all 5,178 paths; 55 current-head coverage ledgers were read and 14 older pre-ledger heads returned 404. No pair path or PASSED pair row existed in that inventory. SC010/071 rows are NOT_EXECUTED. Main counts: 91 VERIFIED rules and 111 PASSED contracts, 202 distinct approved IDs out of 352; this is code-ledger status, not market verification. Earlier shared-memory sections about #421/#426/#491 integration are historical relative to the actual Git main. This checkpoint does not replace another owner's shared state.

Later raced claims5991275815/5991278834 were discovered before publication. Explicit handoff https://github.com/heke99/gridex-ops-platform/issues/530#issuecomment-5991386261 RELEASES whole SC-071/native completion to the announced revocation-20261005 owner, with the distinct new native test and SC071-only records. This owner retains SC-010 and the existing coupled component test/checkpoint/evidence paths. The third claimant was asked to release overlapping primary paths. No other session's files or branch were changed.

## Skill routing

Active: using-superpowers (routing); using-git-worktrees (isolated separate checkout authorized in the user contract); spec-to-code-compliance (independent literal review); verification-before-completion; requesting-code-review; Supabase (actual RPC/current-grant boundaries). Conditional: systematic-debugging/test-driven-development for a confirmed defect; Postgres best practices if a SQL change is explicitly coordinated; finishing-a-development-branch for publication. UI/design/performance/hook installation/skill authoring and repository-wide static/supply-chain audits are outside this bounded evidence pair.

## Current evidence and limits

- `git fetch origin main` and `git rev-parse origin/main`: actual `985724f5`, clean original checkout. Network-denied gh attempts were recovered with the supported additional network permission; the initial empty snapshots were not used.
- Actual public projection calls: `lib/ediel/services/projection.ts`, `projectionRequest.ts`, `app/api/ediel/beneficiary/series/[seriesId]/route.ts`.
- Independent full-literal/source review is saved in `quality/audits/ediel-masterplan-v2/sc010-sc071/independent-literal-review.md`: no actionable defect in the new component test; full SC010/071 proof BLOCKED. Existing native SC071 cases use user-permission DENY rather than revoking an `ediel_data_access_grants` row. Actual native grant revocation is sequential before beneficiary reads or concurrent before storage; those source witnesses were read, not rerun here.
- Full callsite/job/cron/queue/lease search independently found the synchronous beneficiary route as the only production caller of `projectEdielSeriesToBeneficiary`. No actual beneficiary export worker/lease/sink was established. This is a literal delivery/evidence gap, not a proved production data leak. Existing SQL current-grant checks and conflicting read/writer graph locks are implemented; full native grant-race/worker proof remains unexecuted.
- Node22.23.3 focused coupled suite 38/38 PASS, zero failures/errors/skips: 10 owned tests plus unchanged 18 API and 10 provenance tests. Actual route/parser/adapter executed; auth and RPC are named finite ports. Tests TypeScript, scoped ESLint, frozen33/121/231 integrity/evidence-reference gate and diff check PASS. Raw log/JUnit, exact commands and hashes are in the own `evidence/` directory and `verification-receipt.json`.
- 22 bounded source/spec/config/test inputs are byte-equal to base, individually SHA256-pinned in `source-manifest.json`; coverage and production/SQL/native/helpers/schema remain unchanged. No native, lease, destination write, transport, whole-card or final-current CI/main success is inferred from the mocks.

## Failures and corrections

Initial gh reads were sandbox-network denied; supported additional network permission recovered them, and empty snapshots were discarded. Dependency setup under host Node24 emitted the declared engine warning; actual verification used locally installed Node22.23.3. Older gh rejected `--slurp`; the same full paginated results were parsed as consecutive JSON arrays and every path count matched changedFiles. No product test failure or source repair occurred. These records remain in the verification receipt rather than being rewritten as successful first attempts.

## Next action

Publish this independently reviewed component packet on the unique branch and a small draft PR, retain exact technical commit and live CI receipt. Hand SC010's real producer requirement to the retained TEN10/TEN12/service owner and coordinator; identify the real job or explicitly clear one implementation owner before adding any worker/schema/helper. SC071's announced native owner must qualify the distinct real grant race and snapshot projection receipts/history as well as existing counters, retaining legitimate revocation/history effects. Root owns native registration/capture and main composition. No coverage promotion or whole-scenario merge follows solely from these component tests.
