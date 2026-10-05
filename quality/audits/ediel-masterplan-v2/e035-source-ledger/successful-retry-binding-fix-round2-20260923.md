# Successful retry binding — fix round 2/5

Status: implemented, local checks passed, native execution and independent review pending. Base production checkpoint e9778f9db1a7baffb79272326b89c492e241ce80; local parent 3bc2e3166122fd5e1cbfd58052cb266e62d53b11 adds root receipts only. This is not whole-E035 acceptance.

## Actual feedback and repair

OPS35882250390/job107253391474 applied forward150649 and ran 118 native cases: 114 PASS, four positive real-writer cases failed before insertion at the unchanged platform-readiness guard. Artifact10760354455 was log-only, SHA25628fdea314bd0fedb947fc7194eb311cdedbdc75de9f715b36ccd26d6ff608b7e. Native type/schema generation was not reached. Independent scoped review identified an existing-underlay retry gap in frozen period/currency equality; its receipt is successful-retry-binding-fix-round1-review-20260923.md.

The existing persisted readiness snapshot is seeded by migration20260813230000 and clean replay never refreshed it after later canonical migrations. Its actual failure evidence retained migration_version20260813230000, missing canonical_onboard_customer_graph(jsonb) and website_customer_applications policies. The function is recreated in20260831095000; lifecycle policies are created by20260814162500 and occur in the authentic schema snapshot. The new post-replay operation invokes the existing gridex_refresh_platform_runtime_readiness_v1 against the complete actual catalog, prints before/live/after evidence, and fails unless the persisted result equals the ready live capability view. Migration version comes from the checksum-verified executed replay plan, not an invented ledger row. No guard mock, force-ready flag, policy relaxation or hosted operation. Actual final catalog readiness remains for native verification.

New forward20260923154221_ediel_utilts_existing_billing_binding.sql was created by the actual pinned CLI2.101.0 command `/workspace/scratch/db7cad0629c3/tools/supabase migration new ediel_utilts_existing_billing_binding`. Its SHA256 is `59c8ee7d99bb5c4b5993efe8549ad09695391a3591e5844937ae65b1e85e31c7`. Published135706 and150649 remain byte-identical. A direct function-body diff against150649 shows exactly four additional null-safe existing-row comparisons: underlay_month, underlay_year, currency and payload.consumptionContracts. Locks, source seal, stored authority, expected-returned-contract equality, ownership, insertion and service-only ACL remain. Workflow status, readiness annotations and audit actors are deliberately not creation-value equality fields.

Six new actual full-processor regressions stop at completion after actual meter/underlay insertion. Five mutate month/year/currency/contributor quantity/missing contributors and require internal conflict, zero completion, one original row and no replacement/repair. The positive control changes workflow status/readiness/audit actor and adds unrelated payload annotation, then requires the identical retry to return the original row unchanged and complete once. All prior 118 cases remain. These regression tests were added before the repair; native RED and GREEN cannot execute locally because there is no owned PostgreSQL/Docker. The finding is confirmed by the reviewed SQL path, not presented as an executed local RED. Root explicitly accepted that execution limitation and will run the new matrix in native CI.

## Local verification

All Node commands used `/tmp/e035-node22/node_modules/node/bin/node`.

| Command | Actual result |
| --- | --- |
| `node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json --incremental false` | PASS, exit0 |
| `node_modules/eslint/bin/eslint.js scripts/ediel-utilts-consumption-native.test.ts` | PASS, zero errors/warnings |
| `node_modules/vitest/vitest.mjs run __tests__/ediel-utilts-bound-ownership.test.ts __tests__/ediel-utilts-consumption-contract.test.ts __tests__/ediel-utilts-persistence-processor.test.ts __tests__/ediel-utilts-persistence-sideeffects.test.ts __tests__/ediel-utilts-source-collision.test.ts --reporter=dot` | 52 PASS / 5 files, 3.74s, exit0 |
| `scripts/check-migration-versions.cjs` | PASS, 604 files / 508 version groups |
| `scripts/gridex-aud-003-migration-provenance-regression.cjs` | STATIC_PROVENANCE_PASS, 511 timestamped files |
| `bash -n scripts/gridex-aud-003-clean-replay.sh` and `git diff --check` | PASS |

No TypeScript application code changed in this round; prior final5939/364 full coverage and e977 ordinary CI are historical evidence, not claimed reruns on this forward. Native matrix now expects124 cases. Remaining: genuine readiness refresh result, actual new migration compilation and native124, authentic generated artifact reconciliation, same-head independent review and applicable ordinary CI. Root publishes frozen candidate; implementer pauses immediately after own commit. No generated artifacts hand-edited, no hosted database writes, remote changes, deploy, live messages, main or PR310 imports.
