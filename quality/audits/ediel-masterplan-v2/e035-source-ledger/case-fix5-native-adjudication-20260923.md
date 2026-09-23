# E035 case fix5 native adjudication — 2026-09-23

## Actual result

Published bf6d4b5faf645301751c9e2531407d4c84ac3dc9; OPS35903332327 native107324705734. The reviewed ECR override recovered infrastructure: actual local Supabase startup, canonical migrations including20260923180557, and retained124 native tests passed. The case suite failed at scripts/ediel-case-view-native.test.ts:253 reading that migration from supabase/migrations (ENOENT). Protected browser, post-browser assertions, populated-legacy migration replay and generated types/schema were not reached. Case suite is FAILED, not a passing test count. Prior sequential assertions (scoped list, actor/tenant/source negatives, event/audit rollback, frontend ACLs, composite ownership and Support/platform status behavior) executed without failure before line253; this is partial evidence only.

## Confirmed cause and impact

The workflow sources scripts/gridex-aud-003-clean-replay.sh in the same shell to retain its local stack. That script copies original migrations into HOLD at line104, removes the normal .sql files at line106, and uses CLI ledger markers. Its EXIT cleanup restores originals only after all subsequent tests. The new case test reads the original path while the original is still in HOLD. The actual migration applied successfully from HOLD earlier in the log. This is a new fixture/replay integration defect, not missing SQL in Git and not a production status-write failure. It blocks mandatory legacy-preservation and protected browser qualification, so it is load-bearing for Task1 acceptance.

## Round-cap adjudication

Task1 remains fix round5/5 under .agents/skills/subagent-driven-development/SKILL.md. Static SPEC/QUALITY approval did not waive authentic native gates. Rounds1–4 addressed scoped navigation/permission setup, invalid inbound profile selection, exact Z06 profile binding, and ambiguous customer embed; round5 restored the missing event schema and atomic status/event/audit boundary. Round5 now has this genuine acceptance blocker. Ruling: REAL_AND_LOAD_BEARING; do not park it as cosmetic, reset the budget, omit the assertion, claim acceptance, start dependent source-owner tasks, or merge. Stop further implementation dispatches and report BLOCKED to the user as required by the skill's breaker.

## Concrete next repair for a narrow continuation

Pass the checksum-verified original migration from the live replay HOLD directory to the native test explicitly (e.g. an absolute, required local replay environment path set after sourcing the replay). Require the expected registered filename/hash; fail if absent or drifted. The test must read those actual original bytes, never a ledger marker or copied SQL literal. Preserve replay cleanup/stack lifetime and the populated-row preservation plus inconsistent-owner rejection assertions. A pre-replay runner-temporary original copy with explicit checksum equality is another viable option, but choose one path, not silent fallbacks. No migration SQL/history edit, production behavior change, assertion removal, CLI upgrade or generated-file hand edit is needed.

Then run the actual unchanged native/browser flow and independent scoped re-review, obtain genuine generated types/schema, rerun exact-head ordinary CI, and only then continue the remaining E035 source-owner work. This proposed repair is not implemented or verified. Full E035/F3/masterplan remain incomplete; PR370 stays unmerged, PR310 and hosted services untouched.
