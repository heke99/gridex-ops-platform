# Main merge prerequisite batch — 2026-09-15

User instruction: merge the complete work to main, then start the next Ediel phase. Main merge remains blocked; this batch fixes one stale diagnostic fixture and makes two actual database failure boundaries diagnosable.

## Skill routing and independent review

Applied repository continuity, systematic debugging, verification-before-completion, requesting-code-review and finishing-a-development-branch. Existing Supabase instructions apply to database gates; no live SQL or schema change is made. Scoped parallel reviewers were permitted by AGENTS.md. UI, dependency, performance and deployment implementations are absent from this patch, so those skill groups are not triggered. The user's explicit merge choice supersedes the merge skill's selection menu. Its green-test requirement remains unmet.

Root independently reviewed both agents' patches: exact allowlisted removed-policy errors preserve the original exception and success return; native diagnostics are tied to unchanged final SQL SHA and exact failure templates and retain no raw stderr. Parser and actual hook/report tests preserve fail-closed behavior and cleanup diagnostics cannot overwrite the captured report. Schema agent independently approved root's frontier count repair, which retains the exact601 historical inventory and514 historical timestamp hash boundaries plus six admitted forwards.

## Local targeted verification

- Frontier16 tests PASS; foundation8/live-sync14/timestamp-source9/residual-source19 PASS.
- Removed-policy qualification8/formulas9/reference25 PASS (agent); root independently reran qualification8 PASS.
- Native final SQL10/timestamp proof36/schema reference4/probe cleanup5 PASS (root).
- git diff --check PASS.

These checks validate diagnostics and source selection; they do not certify actual schema, application-generated types, tenant isolation or main merge. No migration SQL, independent schema reference, type file or generated-type manifest is altered.

## Actual remote boundaries

See merge-native.md, merge-schema.md, merge-e2e.md for exact run/job evidence. Current ordinary native proves144+514+6 and the ledger, then fails final tenant-isolation SQL. Schema comparison stops before comparison at removed-policy validation/composition. E2E smoke14/15 and verify fail generated-type migration-tail alignment. Ediel masterplan and browser workflows pass on d4f7769e.

Next: publish this combined PR311 ancestry into PR310 without force or history replacement, inspect actual reruns, repair evidenced causes, close schema acceptance, generate genuine application types, verify final-head CI/E2E/review, merge to main, then begin source-backed Ediel locator/register work. No next-phase implementation or main merge is claimed.
