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

## Combined-head rerun and follow-up

1849497413325385b080e33f2bbfffd4073f488f was published with exact local/remote tree equality and incorporated into PR310 without force. GitHub records PR311 merged into the PR310 branch at16:58:18UTC; main remains unchanged. Actual frontier34998326022/job104480139829 PASS, Ediel34998326084 PASS, browser34998325997 PASS, while schema34998326163/job104480142628 now identifies REMOVED_POLICY_EXACT_POLICY_SET_REQUIRED. Its metadata SQL succeeds; comparison remains blocked with counts{}. Actual tenant integrity34998326037/job104480140557 fails2403 direct service calls versus2402 baseline; local reproduction agrees.

Root independently reviewed the follow-up fixes. DSN-safe existing-message lookup is shared by the two public entrypoints, removing redundant screening/message reads and one pre-existing direct call site. Both entrypoints still screen DSNs, propagate failures, preserve newest-first existing IDs and create diagnostics only for missing screened mail. Ratchet baseline stays unchanged; current count2402 PASS. New tests cover errors in both reads, unknown IDs, DSN paths and mixed existing/missing messages. The schema follow-up exposes counts, expected ordinals and validated SHA256 only; exact267/hash requirements and duplicate-row rejection remain unchanged. It is diagnosis, not a schema correction. Root qualification9 tests PASS; agent formulas9/reference25 PASS.

Final follow-up verification: full Node22 Vitest218 files/2134 tests PASS, application/tests TypeScript PASS, DSN20 PASS, unchanged2402 service-call ratchet PASS, whitespace PASS. No full remote acceptance inferred.
