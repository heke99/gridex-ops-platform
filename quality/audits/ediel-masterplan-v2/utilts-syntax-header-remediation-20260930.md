# U-03 / ACK-03 / SC-045 — coherent code remediation, 2026-09-30

## Executive summary

Implemented the proved syntax/header defects and their affected override/projection/serialization paths as one coupled package on draft #421. Frozen 121 rules, 231 acceptance contracts and 33 originals are unchanged. Whole U-03/ACK-03, SC-045 formal acceptance, native final-head proof and masterplan completion are **not asserted**.

Base product/test head: `e0bd3641f617edb92e508bd62c2767730e20fca1`; base tree `b2b8259efebb9b44da229ec0390439e43910808a`; main `53bf989b0ad402bb2ce151c186eea31f1ec9cf03`. Last fully green product baseline remains d30fa020 (native439/439 and five workflows), not this candidate.

## Confirmed findings and source authority

OPS36702357516/replay109844514929 proved native439/442 on the test-only head. Its CI synthetic merge was ae12d549389f75e69482221ed6ecc29738897707; distinguish it from PR head e0bd3641. Retained439, all27 S02 and SC044 passed.

| Finding | Exact observed failure | Correction |
| --- | --- | --- |
| UNT count | UNT999 persisted one accepted series and binding contract. | Existing full raw syntax validator runs before legacy guide/function; syntax-only dispositions and negative CONTRL. |
| UNH/UNT ref | OTHER was held by existing identity guard, but persisted positive CONTRL. | Same shared early syntax gate; no claim of a second accepted-data defect. |
| SC045 header | Missing headDTM735 produced two per-IDE APERAKs rather than one message ACK. | Canonical physical-header provenance; one negative APERAK, no ACW; all guide-rejected reservations finalize to its immutable ID. |

Source basis is the frozen U-03/AT-U-03, ACK-03/AT-ACK-03 and SC-045 criteria plus approved U §5.2/5.3–5.5 notes in `utilts-syntax-header-scope-20260930.md`. Independent header reviewer verified the frozen register interpretation, **not newly recovered original PDF bytes**. No new national error code or rule has been invented. BGM313 is response code; missing header field206 owns ERC41.

## What changed and blast radius

- Canonical UTILTS wrapper reuses `validateEdifactSyntax`; only cached `message_failed`/`syntax_check_failed` markers are excluded from physical replay evidence. Lower legacy API remains intact. Syntax rejection now precedes the ERR positive special case.
- Existing header issue derivation moved to `utilts/headerGuide.ts`, shared by runtime and renderer. Token scope is UNH before IDE/UNT; a misplaced transaction field cannot supply a header. No second rule authority or copied field-code list.
- ACK plan retains header-only errors through later rebuilds. Direct consumer creates one message APERAK and uses unchanged tenant/environment/source/transaction finalization guards for every rejected IDE.
- RuntimeDecision and DecisionEngine projections, generic inbound ACK builder, automatic ACK orchestrator and exported draft builders carry provenance. Generic DecisionEngine syntax returns negative CONTRL even in UE certification context.
- Renderer requires negative UTILTS, no target/reference, syntax-valid actual UTILTS UNH and exact canonical deduplicated physical header-error signatures. A caller flag, message scope or arbitrary unreferenced field512 error cannot grant header scope. Source received-at/created-at fallback is preserved.
- Test overrides cannot supersede canonical syntax/header gates. Positive/transaction header flags fail closed. Existing mixed SC044 and same-code ERR identity remain per-IDE. Existing positive inboundERR policy is preserved outside syntax; no empty negative-header provenance is minted for it.
- Semantic fixture repairs change only UNT count after intentional segment addition/removal. Guide/function mutations and assertions are unchanged. Native test file is unchanged.

## TDD and verification

Executed RED on the initial runtime/gateway additions: 3 failed /11 passed, exact UNT/ref classification and two-vs-one APERAK mismatch. Subsequent independently reproduced review findings also had RED probes: all6 override contexts; renderer forgery and runtime projection; generic syntax decision; canonical NAD double-fault dedup. Fixes were applied only after the concrete failure was observed.

Final ordinary suite: **6296/6296 PASS, 388 files**, Node v22.23.3. Quality suite **45/45 PASS**, 2 files. App/tests/scripts TypeScript PASS (4096MB); the first unbounded app run exhausted the default 2GB heap, and an intermediate nullable-code type error was corrected. Scoped ESLint exit0, no errors; six retained unused-variable warnings in existing ACK/inbound/legacy code. Final changed-file lint PASS.

Mechanical checks PASS (75 master points,12requirements,83operations; trace-grid100cells/noinvaliddowngrades). Migration integrity PASS (655files/559groups); no migration changed. Large-file budget PASS (new files capped1800). Service-role ratchet PASS2401 vs2402, no baseline relaxation. Register integrity PASS121/231/33, explicitly inventory-only. ACK-engine regression PASS.

Additional local diagnostics remain openly failing on **both e0 baseline and candidate**: `ediel-rule-regression.cjs:263` Z14N expectedack/actualmanual_review; `gridex-utilts-completion-regression.cjs` stale literal environment check against the unchanged facade. Independent git-archive baseline probe confirmed same outcomes; no unrelated fix or assertion weakening. These extra scripts are not represented as green.

## Differential review and residual gates

Initial independent review found four Important issues plus dedup edge; all were reproduced and corrected. Final bounded review `/root/syntax_header_review`: **APPROVE, no remaining Critical/Important**, independent68/68 targeted tests and normative-authority guard PASS. Fixture count-only repairs approved. No auth/RLS/grant/SQL/actor-owner checks removed.

Adversarial scope: malformed external trailers cannot enter canonical accepted-data path; forged internal header flags cannot suppress physical reference without matching source evidence. Raw service-RPC bypass/future grammar coverage and same-IDE concurrent ACK identity are separate unproved gates, not implied solved by consumer-native tests.

Pending final-head CI: all five mandatory workflows, native442, case/browser/post-browser, generated types and schema snapshot. Docker/PostgreSQL unavailable locally, so no local native claim. Reuse existing retained controls; never rerun an unchanged green head to substitute for new-head proof.

External issuer/representation, archive/deletion history, legal retention, positiveLOC175 owner/mandate and fullE035 records remain BLOCKED only on their affected contracts. No transport, staging/TGT/AGT/counterparty test, merge, main/production deployment or #418/#422/#310 mutation.

## Skill routing and delivery

Activated: using-superpowers, systematic-debugging/root tracing, TDD/good tests, writing/executing plans (one tightly coupled package), dispatching parallel read-only analyses, source/spec compliance, differential review/adversarial/reporting, requesting/receiving review and verification-before-completion. Physical header extraction is a bounded shared-owner refactor, not a broad cleanup. Property-testing guidance inspected; exact example-based gates suffice for this scoped wire/gateway correction, no PBT dependency added.

Not activated: full baseline quality-playbook/Council audit (request is proved remediation, not a fresh repository-wide audit), independent concurrent implementation (coupled files/root sole writer), new worktree (fresh isolated clone), skill editing, UI/Next/React/performance, hosted Supabase operations, SQL refactor/migration, API #422 or deployment/traffic. Existing full quality checks were executed; this is not a new full playbook run.

Publication receipt is recorded in the PR comment after exact-tree fast-forward. A source-tree receipt cannot contain its own future commit SHA; do not substitute a local transport commit SHA for the published one.
