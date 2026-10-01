# Lifecycle native fixture: genuine seed baseline and one bound delta

## Actual failure and cause

Candidate `df7d43d15f9b2ab88e6a244a0b692ecb622fc15b`, tree `ce210482de2e63041bed3f569d158c5d943dc12a`, was tested as merge checkout `00752667d435e3a1bf762096a21dd9a5464400f0` in OPS run `36802334399`, clean job `110179208381`. At `2026-10-01T01:45:26.6644480Z`, the first lifecycle native case failed its absolute array-length assertion: expected 1, received 5, line 87:84. Clean-retry and concurrent cases failed the same assertion at 114:88 and 127:84. The suite was 2 PASS / 3 FAIL, not a native acceptance receipt for the correction below. Full first-head provenance is retained separately in `ci-candidatedf7d43d1.md`.

An executable PostgreSQL-core reproduction now establishes the cause, rather than assuming a duplicate lifecycle write. The actual company INSERT trigger calls `gridex_sync_company_legal_profile_trigger` and `gridex_rebuild_company_legal_profile`. The incomplete legal-profile INSERT and subsequent completeness UPDATE each invoke `gridex_public_catalog_dependency_revision_trigger_v1`, which calls `gridex_bump_contract_publication_revision` for website and api. Those actual functions create four pre-existing `contracts.publication.changed` domain rows. The lifecycle command adds the fifth domain row. The original absolute-one assertion fails on `domain` in this reproduction.

The core fixture extracts current actual schema table definitions, function bodies, company/legal-profile/catalog triggers, and effect-table unique indexes. It applies the complete production lifecycle migration. It does not disable a trigger or fabricate the four publication rows. PGlite supplies a bounded `extensions.digest(bytea,text)` alias to its built-in SHA-256; the referenced production business bodies are unchanged. The small customer/site/point/contract input tables are typed resource fixtures, not a claim of full historical Supabase schema or RLS execution.

## Bounded fixture correction

Only the native test changes. Before each of the three affected commands it captures the complete company effect snapshot. The assertion then checks every prior timeline/domain/fanout/intent row is identical, and requires exactly one new row in each named collection. Diagnostics identify the collection (`lifecycle_baseline_preserved:domain`, `lifecycle_delta_count:domain`, and corresponding binding markers).

The selected new rows must bind to the exact company/customer/site/point/contract, operation UUID, event/source/idempotency key and original payload. Fanout must reference the selected domain row; intent must carry the exact lifecycle notification key and original request snapshot. Communication, email outbox, webhook delivery, switch-request and EDIEL-message counts must remain unchanged. The fixture retains its independent unsent/no-external-fetch assertions.

The late required-intent fault still compares the entire failed-call effect snapshot before retry. The race still executes four actual Data API calls, requires one fresh receipt and three replays, and binds all returned receipt IDs to the selected new rows. Terminal replay, parent continuation, current revocation, changed-payload conflict and low-role denial assertions are retained. The terminal-fixture UPDATE additionally targets the exact notification idempotency key. No production SQL, grants, current-authority guards, trigger behavior, actor/session authority or sender code changes.

## Executed checks and limits

The prepared core reproduction first ran with the old native source: 1/4 PASS, 3/4 FAIL because the required baseline/delta assertion was absent. The passing cause case independently demonstrated the original absolute-one assertion's real `domain` failure. Initial harness index-name/overload-order errors were corrected before that meaningful RED and are not counted as product TDD evidence.

After the fixture correction, `scripts/customer-lifecycle-native-baseline-20261001.postgres.test.cjs` passes 4/4:

1. Genuine company/legal-profile/catalog triggers create four baseline publication rows; the original absolute-one check rejects the fifth lifecycle row.
2. The exact assertion extracted from the actual native source preserves baseline, selects one bound package and matches genuine command receipt IDs; sequential replay changes nothing.
3. An actual late required-intent trigger fault rolls back all command effects while preserving the full publication baseline; a clean retry adds one bound package.
4. Mutation controls reject altered baseline bytes, an extra unbound domain row, wrong intent source key and wrong operation UUID with named diagnostics.

Commands executed with Node 22 and `NODE_PATH=/tmp/ediel-service-check/node_modules` (PGlite 0.3.14):

```text
node --test scripts/customer-lifecycle-native-baseline-20261001.postgres.test.cjs
node --test scripts/customer-operation-lifecycle-atomic-20260930.postgres.test.cjs
```

Results: new exact-source core 4/4 PASS; retained production lifecycle core 9/9 PASS. Scoped ESLint for the modified native test passes with zero warnings; its strict scripts TypeScript import closure and `node --check` for the new core file pass. These checks do not execute PostgREST concurrency, Supabase RLS, the corrected native fixture, a provider, or the complete historical replay. **Corrected native execution: 0 / NOT_EXECUTED.** The prior head's 2/5 native result is not transferred to these bytes. No unchanged CI rerun or ref mutation occurred.

## Frozen source manifest

| Path | Git blob | SHA-256 | Bytes |
| --- | --- | --- | ---: |
| `scripts/customer-operation-lifecycle-atomic-20260930.native.test.ts` | `85f066d907865c1f3722f2df3002df5931c8760a` | `b009dd0594367ecdb731af3e400ad06821d13c98b852e89bf32eec15c3d59969` | 16567 |
| `scripts/customer-lifecycle-native-baseline-20261001.postgres.test.cjs` | `82ffc735d0171a0fa13abe546a84b81423a85ace` | `ae11bd6b6e9a624bfe665f150bccf964618551114e99bb95be6d7845889ad86a` | 10216 |

Unchanged causal inputs: `supabase/schema.sql`, Git blob `2157bb862adf4dfcd4903f773dfcf636ca9b8e6d`, SHA-256 `1463caa887e94ce18678c3f5256106fc08a500508fb07eeb349ce9b7f9c5eee1`; lifecycle migration `20260930230204`, Git blob `73cad63a30f700aca37736b2d8e4b3aa8c858fef`, SHA-256 `bb067ddf9b4756182b73ace766d3657408defcbb1e17d72e86cb6043600a45bb`. The report is a third publication path; its own digest is communicated separately to avoid a self-referential hash.
