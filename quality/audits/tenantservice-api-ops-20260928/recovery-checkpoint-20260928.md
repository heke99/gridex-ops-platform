# Publication package recovery checkpoint — 2026-09-28

## Exact state before changes

- Draft PR #418, branch `codex/tenantservice-api-ops-20260928`; local and GitHub head `68d7bffdd2cc094df8921605c5b4724fde5234ac`, tree `542ee520a22f2b211558972de3aaf0e31e33aa53`. Working tree clean, no local commits ahead of upstream.
- OPS run `36413206017` on that head: `verify` and `quality-release-gates` passed; clean replay job `108898062718` failed on attempt 1. Tenant integrity, browser/quality E2E, and full E2E succeeded; production crawler skipped.
- CLI installation, empty migration, generated schema/type collection, old native fixtures (378/378) completed. `scripts/ediel-case-view-native.test.ts` first published successfully, then its stale revision call failed at line 192 after approximately 60 seconds with `The upstream server is timing out`; exit 1. Its next publish, revoke, browser fixture, browser execution, post-browser check, and final schema/type equality checks never ran. Artifact `10965727709` contains the replay log, generated types, and schema snapshot; those artifacts are partial evidence only.
- `supabase/migrations/20260928113000_customer_case_publication_boundary.sql` uses SQLSTATE `40001` for both intentional revision conflicts. Supabase documents that PostgREST 14 retries intentional `40001` errors, causing this exact timeout pattern. Root-cause classification: RPC error handling / unbounded internal transaction retry, not Vitest `testTimeout` (180 seconds), CLI installation, or migration syntax.

## Scope and skill routing

Active: repository `systematic-debugging`, `test-driven-development`, `verification-before-completion`, Supabase and Next.js version documentation, tenant E2E, and scoped React review, for the SQL/RPC, OPS page and browser evidence. Conditional: performance review only if measured query bottlenecks remain. Full repository audit and agent delegation are outside this isolated package; sole author retains the branch. No production database change, market traffic, or merge.

## Exact next action

Use a forward migration to replace intentional `40001` with a non-retried conflict status; retain the original migration untouched. Add native assertions for the code and bounded latency, then finish the real support page's database-filtered pagination, withdrawn revision handling, browser permissions, schema/type parity, and same-head CI before updating PR evidence.

## Intermediate replay and current candidate

- Intermediate remote commit `5caaad3e14e3a588f788ae18a5b24450835f2c07` retained the original migration and added forward migration `20260928130000_customer_case_publication_conflict_and_history.sql`. OPS run `36424300271` passed `quality-release-gates`; native clean replay passed the previously failing `scripts/ediel-case-view-native.test.ts` (1/1), including bounded PT409 conflict, publish, revoke and republish. The browser step then failed 2/3: its pagination assertion counted the prioritized support row twice conceptually (201 distinct support cases, not 202), and a nested locator did not find the support case article. These failures do not establish a product failure. The generated-type manifest was still at the old migration tail, so `verify` failed `db:types:check` on this intermediate head.
- Run `36424300271` artifact `10971342588` contains types and schema generated after successful isolated migration replay, with the new function, grants and PT409 in the schema. The exact artifact files were copied into `supabase/database.types.ts`, `supabase/schema.sql`, `supabase/schema.fingerprint.json`; `scripts/supabase-types-manifest.json` records its provenance and hash. Local `npm run db:migrations:check` passes. Artifact provenance does not imply that the later browser and post-browser checks passed.
- The next candidate corrects the browser selectors and support count; adds a forged read-only Server Action attempt, double-submit, stale revision notice, withdrawal and republish checks; disables form submit controls while pending. Final-head CI is required before assigning a green result to these changes.
