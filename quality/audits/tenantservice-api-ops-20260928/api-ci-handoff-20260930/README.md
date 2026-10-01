# API CI recovery contribution, 2026-09-30

This is a bounded handoff contribution from published API candidate `026f6bab3b261866aecd1015842dd0f3abb4a7b4`. It is not the active #422 integration branch and does not replace the original integrator. The original checkout at `/workspace/scratch/33c70eb11bb1/gridex-tenantservice` is actively correcting the legal migration. No change to #422, #418, main, production, historical migrations, generated artifacts or releases is part of this contribution.

## Confirmed fix

OPS run `36775178898`, upgrade/restore job `110091164679`, reports `source_file: unbound variable` at restore script line136. Bash expands all assignments in the same `local` command before assigning source_file; command substitution fails but local can still return success and select the wrong `.log` filename. Splitting the dependent log declaration after the source assignment preserves the intended private per-source logs, sanitizer inputs and SQL failure result. No database permissions, checks or proof gates are weakened.

The new test executes the actual extracted Bash function under `set -euo pipefail`, uses a filename with spaces and a stub psql process, and verifies both successful marker/log delivery and a failed SQL exit/sanitized failure path. It does not claim a PostgreSQL, backup or restore test.

## Executed verification

Node22.23.3. RED: both new tests failed against the published script; success exposed unbound source_file and failure exposed wrong sanitizer log. GREEN: 11/11 tests in3files (`tenantservice-upgrade-sql-wrapper`, `customer-profile-commands`, `billing-profile-migration`). Scoped ESLint, `bash -n`, `git diff --check` and migration integrity passed663files/567groups. No migration bytes were changed. Disposable local Docker/psql are unavailable; no native database was executed here.

## Actual published candidate CI

All observations below concern candidate026f6bab and OPS run36775178898, tested merge checkout60b2c0cef3d315df3205c973a681bea2651b2c75/treecd0c6f0459ad9ad9478a5f8e8fe735c359a4b407.

- quality-release-gates110091164636: SUCCESS, including lint, unit tests, docs, compatibility, release, RBAC, build and bundle gates.
- verify110091164614: FAILED at generated-types tail manifest check. Migration integrity passed first.
- clean-migration-replay110091164302: FAILED compiling the candidate legal-profile function in20260930144853..., line274 reported mismatched parentheses; source root cause is missing closing parenthesis near line196.
- upgrade-backup-restore110091164679: pinned older schema and existing synthetic row seed genuinely passed, then failed at the same forward migration; no completed upgrade/backup/restore claim.
- Full E2E36775178776 smoke110091164494:14/15PASS, only migration/generated-type check failed. Coverage passed; certificate failed due required smoke. Tenant integrity, Ediel regressions and public browser workflows succeeded; these do not replace the new native/HTTP/form evidence.

## Ownership and remaining work

#422 is draft on codex/tenantservice-api-structure-20260929; #418 is draft prerequisite codex/tenantservice-api-ops-20260928. On latest read #422 remained026f6bab, while original working tree had an in-progress SQL parenthesis correction and checkpoint change. Do not overwrite those changes or take over publication without an explicit owner handoff. This contribution may be cherry-picked by the sole integrator after checking whether its two code files have already been corrected.

Require a fresh changed candidate's clean replay, actual SQL/concurrency/HTTP/interactive browser/postchecks and upgrade/restore. Adopt generated database types/schema/fingerprint only from authentic current-candidate output, retain unchanged parity gates and exact migration provenance. Historical event-v2 and old API releases are already qualified for their own trees and must not be regenerated or accepted as evidence for this candidate.

Concrete next integration issue: lib/ediel/portalTestCustomer.ts ensureCustomerAddress directly writes registered/billing book rows; the new address guard denies unmarked service-role DML. Use the authorized command and current-session/selected-company authority rather than weakening the guard. Supplier-switch/readiness site continuation remains a separate proof gap. An existing terminal customer-data job with the same unique key might suppress later enqueue; reproduce before classifying/fixing it.

All75 T01-T55/U01-U20 IDs and meanings remain in requirements.csv. Continue P0-P8 and full OPS UI after qualification, with explicit per-row evidence/blocked boundaries. No whole phase/requirement is accepted by test count.

## Skill routing

Activated using-superpowers, using-git-worktrees (isolation), systematic-debugging (real CI root cause), test-driven-development (wrapper RED/GREEN), verification-before-completion (claim limits), and independent review/delegation. Supabase skill was read for replay and security boundaries; no schema/auth implementation occurred here. Library skill applies only to the reusable prompt. Full quality-playbook audit, platform redesign, dependency upgrade, security scanner installation, hooks, UI/performance refactor and skills authoring are skipped: this task is a narrow evidenced CI-wrapper repair and handoff.
