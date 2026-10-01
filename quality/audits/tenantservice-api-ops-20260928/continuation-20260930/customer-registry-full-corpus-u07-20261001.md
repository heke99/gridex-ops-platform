# U07 customer register — bounded advanced snapshot correction, 2026-10-01

**Phase2 supersedes the phase1 proposed/not-implemented sections below only for the reserved advanced-reader scope.** The exact phase1 three-file receipt remains `/workspace/scratch/b08749f7eca6/customer-registry-full-corpus-u07-20261001-phase1.json`, SHA-256 `e451fdae52cf93174197505ce9657bbb3825be1e6b29f8ccc8382e213fc9deac`. Its meaningful eight full-corpus RED cases now pass through the actual exported reader and installed client. Separately, the actual new SQL owner passes12 PostgreSQL-core cases. Full U07, all other register readers and native/browser authority qualification remain OPEN.

This is a bounded author proof and proposed next read owner, against published `9e59b013d3f7ad4f445d6ed9805705f168c2ec14` in the isolated `codex/customer-registry-u07-20261001` worktree. It does not close original U07, the other register/corpus readers, any API surface, Event-v2 or the unresolved OPS148 semantic denominator. Original `masteruppdrag.md:1147` requires search, filters, sorting and pagination to work together. The unchanged original requirements and `original75-next-priorities-20261001.md` retain the wider work as OPEN.

Recorded with an actual UTC clock on 2026-10-01. Vitest uses the process's Europe/Berlin clock, UTC+02:00; its displayed `13:xx` times below are explicitly converted to `11:xxZ`.

## Two separately qualified faults

1. The current canonical `public.customers` table has no `possible_duplicate`, `duplicate_review_status`, `consolidated_invoice` or `billing_level` columns. The published `CUSTOMER_LIST_SELECT` requests all four. An advanced search catches the real-shaped `42703` missing-column response as an optional relation error and returns `rows: [], total: 0`; basic database pagination throws the error instead. The absent fields are confirmed from current `supabase/schema.sql`'s actual CREATE TABLE and authentic types. Historical eight-digit filenames and derived foundation source pointers are not evidence that the missing customer ALTERs ran. Contract/export-item billing fields and untyped customer duplicate metadata do not establish a customer-level fact source.
2. Once that prerequisite is repaired, the real exported reader misses the oldest matching customer because `loadCustomerRows` selects newest1000 before its JavaScript query/type/flag/contract predicates. The live configuration additionally sets `max_rows = 1000`: relation hydration without a range is also capped. Filtering by `signed` currently means merely `contract_count > 0` in the reader, so a newer closed contract can take the page before the live UI later removes it.

These are business-reader outcomes from an actual exported function and installed client under controlled database transport. They are not observations of a hosted database, native constraints, RLS, Auth, authority or a security exploit.

## Actual transport and rows

The new test imports the actual `listCustomersPage`. Only `@/lib/supabase/service` is replaced with the installed `@supabase/supabase-js` client whose outer fetch is controlled. Every client request stays inside that function; there is no HTTP listener or network call. The reader's actual base predicates, normalization, query/type/flag/contract filtering, status counts and hydration execute.

The controlled transport checks every requested table column against the current canonical CREATE TABLE, evaluates emitted database predicates before ORDER/OFFSET/LIMIT, applies the actual `supabase/config.toml` maximum, and emits faithful PostgREST-shaped errors. The adapter's existing status-count RPC projection is a synthetic known business boundary, not execution of that SQL function. Seeded rows represent canonical read projections; no Auth, provider, ordinary-user, raw database insert, witness or fabricated receipt is exercised. A mandatory after-test assertion rejects any absent selected column, preventing an empty-result negative control from falsely passing through a schema error.

## Executed sequence, without promoting setup faults

| Step | Actual outcome | Qualification |
| --- | --- | --- |
| Initial15, 11:17:18Z | 14 timeout /1 pass | HARNESS SETUP only: a thrown strict-DDL error made the installed SDK retry a transport exception. No product RED is claimed. |
| Faithful canonical adapter, 11:22:19Z | 14 FAIL /1 PASS,15 cases | Genuine canonical column/fallback RED. The after-test schema assertion prevents false empty controls. Not yet a cap proof. |
| Four added prerequisite controls, 11:26:49Z | 4 FAIL,15 filtered | Genuine unknown-facts, unsupported-filter and missing-column propagation RED on unchanged production. Filter selection is not a removed/skipped acceptance test. |
| Narrow prerequisite applied, 11:27:39Z | 5 FAIL /14 PASS,19 cases,1.96s | Genuine five customer-corpus REDs; the four prerequisite controls are GREEN. |
| Additional newest-contract/foreign controls, 11:32:22Z | 8 FAIL /14 PASS,22 cases | One additional newest-status RED. Two provisional malformed foreign tuples violate current composite FKs and are **not** counted as canonical-data defects. They were replaced by legitimate disjoint company/customer/site graph controls with unchanged exclusion expectations. |
| Actual configuration cap + final24, 11:34:20Z | **8 FAIL /16 PASS**,24 cases,1.86s (709ms tests),exit1 | Final causal RED: five customer-corpus cases, one newest-contract-status case and two related-corpus cap cases. Both legitimate foreign graph controls PASS. All canonical column assertions PASS. |
| Retained shell/hydration source checks, 11:29:18Z | 6/6 PASS | Existing checks retained. These are source invariants, not native/performance measurements. |

An intermediate post-prerequisite run had one additional test-only failure because URLSearchParams.get returned the first `not.is.null` value rather than the later repeated `eq.company` value. The corrected assertion checks both emitted predicates with getAll. The data/output expectation already passed; this is not a production tenant-scope defect.

The final eight RED cases are:

- oldest exact saved customer number outside newest1000;
- oldest business customer with two real stored sites;
- oldest multi-site customer derived from those sites;
- only no-contract customer outside1000, with count chips from the pre-contract universe;
- 1001 literal query matches continued to page11;
- newest contract is closed although an older contract is signed; the signed filter must select the actual latest state before page/total;
- 1002 stored site relations split across two customers; the second customer's two sites cannot disappear behind the relation cap;
- 1002 stored contract relations; truncation cannot invent a customer without a contract.

The16 GREEN controls retain exact saved billing revision, explicit unknown facts, early unsupported-filter denial, legitimate foreign graphs, own-company predicates before cap, existing explicit null-company behavior, literal punctuation, no cross-field concatenation, count-set semantics before status, basic database pagination beyond2000, hidden/test/source/archive rules, true no-match, non-schema error and missing-column error propagation. They do not establish ordinary caller authority or an actual switching readiness decision.

## Authorized narrow source prerequisite

Only `lib/customers/getCustomers.ts` changed before a corpus SQL implementation is approved:

- the four absent customer columns leave the SELECT;
- all four DTO facts remain explicit null, including the booleans, without false/default or invented metadata/history;
- `CustomerRegistryFilterUnavailableError` exposes code `CUSTOMER_REGISTRY_FILTER_UNAVAILABLE` and the exact unsupported duplicate/consolidated filter before any query;
- the advanced fallback cannot swallow `42703` or `PGRST204` missing-column errors. Existing optional-relation handling remains separate.

The live `AdminCustomersPage` invokes the reader after unchanged guard and scope checks and has no local catch for this typed error yet. Thus the current source propagates failure instead of claiming no customers; a friendly constant alert/clear-filter UI requires a separately reserved minimal page change. It must catch only this known error, keep every other error propagating, retain current filters in the clear-flag link, and never silently replace the unsupported filter with all. This report does not claim that UI implementation or execution.

Canonical customer `metadata.duplicateResolution`, `duplicateWarnings` and `duplicateOverrideReason` do not constitute a versioned authoritative duplicate fact. Imported consolidated billing persists in the contract graph, not in the canonical customers table. The separate merge writer still requests absent flag/merge columns and suppresses shape errors; that writer remains internally OPEN and is not repaired by this reader change.

## Current callers and null-company floor

| Live caller | Actual boundary before read | Current scope and remaining limit |
| --- | --- | --- |
| `app/admin/customers/page.part-2.tsx` | customers.list guard, ordinary selected/current company comparison and missing-company branch | Ordinary passes exact current company; canonical platform context deliberately passes null. Reader excludes null-company rows. Page later filters/sorts operations and latest contract on the selected100 only; related operational reads are limited150. These remain separate gaps until their full predicates precede range. |
| `app/admin/customers/segments/page.tsx` | customers.segments guard and ordinary missing-company redirect | Exact ordinary company or canonical platform null. `getCustomers` returns only page1/100, then segment relations/counts are calculated. Full segments closure is not inferred from list-page repair. |
| `app/admin/operations/integrity/page.tsx` | operations.integrity guard and resolveAdminTenantReadScope | Passes resolved company directly into `getCustomers`, without the customers-page's explicit local ordinary missing-company branch. It also receives only100 customers. Static dependency, not an executed authority outcome. |

`resolveAdminTenantReadScope` uses the actual canonical platform flag and current operational scope; the optional/null reader parameter is compatibility, not an authority receipt. A new read RPC must add no caller grants or platform inference. No role/session/privilege exercises were performed.

## Proposed next owner — not implemented in this phase

Root allocates any CLI forward. Proposed exact function shape:

```sql
public.gridex_customer_registry_page_v1(
  p_company_id uuid,
  p_query text,
  p_status text,
  p_contract_filter text,
  p_customer_type text,
  p_flag text,
  p_exclude_test_data boolean,
  p_page integer,
  p_page_size integer
) returns jsonb
```

It is a read-only STABLE SECURITY INVOKER function with schema-qualified relations, fixed search_path, no writes/healing, no new table grants, public/anon/authenticated EXECUTE revoked and service_role EXECUTE only. The server's existing canonical caller remains the authority boundary. Null-company compatibility is explicit, never a new authority shortcut. Parameters are validated/bounded; pageSize1–100, positive integral page, checked offset arithmetic, and unsupported fact filters raise an internally unavailable outcome.

One SQL statement takes one snapshot and returns the current envelope `rows,total,page,pageSize,totalPages,counts`. It scans the complete authorized customer set, then returns at most100 actual base projections. The shape is:

1. **Base:** company_id nonnull, optional exact company, permanent `ediel_portal_test` exclusion, existing hidden/archive and explicit test rules, current customer type. Literal query uses per-field `strpos(lower(...), lower(trim(p_query))) > 0`; no wildcard interpretation or concatenation between fields. Preserve normalized full-name fallback separately from first/last.
2. **Actual relation facts:** derive complete counts in SQL rather than fetching capped child lists. Each site/contract/POA is exact company+customer. Points belong to an exact company site chain; nullable point.customer_id is accepted only through that verified site. Legitimate unrelated company/customer graphs do not enter the count. A malformed owned relation with discordant customer/site/point aliases produces an explicit unavailable projection rather than silently inventing no-contract or ready facts. Historical null aliases are accepted only where the existing canonical relation permits them. This is a read projection, not a signed-mandate or readiness command.
3. **Count set:** literal query + customer type + supported derived flag, before selected customer status and selected contract bucket. Existing hidden/archive inclusion is specified explicitly; chips do not count the final page or final contract subset.
4. **Final set:** selected status plus actual newest valid contract bucket, before range. Latest contract uses canonical created_at descending with an explicit id tie break; closed means terminated/cancelled/expired, matching the current live page. No-contract uses complete exact tuple count, not a capped reply.
5. **Page:** deterministic customer created_at descending and id descending, then range. Numeric counts/revisions must fit the existing safe integer DTO; unknown four facts remain null. Total/pages remain available even for an empty/off-end page.

Reserved implementation seam: advanced `listCustomersPage` calls a new `lib/customers/customerRegistryPageRead.ts` parser/adapter; ordinary basic database pagination can remain until its separate whole-snapshot/readset work is approved. Missing/malformed RPC replies must throw, never fall back to newest1000 or empty success. Only root may allocate the forward or modify generated types/workflow/checksums.

Proposed additional uniquely owned proof: `scripts/customer-registry-full-corpus-u07-20261001.postgres.test.cjs`, using actual current canonical table declarations/actual new function under the existing PostgreSQL-core toolchain. Before implementation, calling the absent exact function provides a separately labeled command-presence RED; it must not replace the already meaningful exported-reader RED. Cases must execute >1000 customer and relation rows, latest-state/UUID ties, null aliases vs discordant aliases, legitimate foreign graph exclusion, literal punctuation, off-end totals, errors/unavailable filters and read-only catalog/data preservation. SQL-core models remain separate from native installed roles, Auth/RLS, two-session concurrency and live UI.

## Gates and exact source receipt

Historical phase1 prerequisite-only production SHA-256: `1b3719601320e66b3f27806dc7071638f90faf8473072c18c98ad149ded478d0` (21350 bytes). Original published source SHA-256: `cb1124667fb769b95d9cc802efd839a2660092c92dac110a9d648e9caf78667f`.

Historical final phase1 test SHA-256: `35dbaeacaf86ad92f928fb6282d39c26964bdf6342a454cc61d56c493f673b2b` (22424 bytes).

Executed command:

```sh
/tmp/ediel-toolchain/node_modules/node/bin/node --max-old-space-size=1536 node_modules/vitest/vitest.mjs run __tests__/customer-registry-full-corpus-u07-20261001.test.ts
```

Scoped ESLint for the final source/test passes0 diagnostics; git diff --check passes. Final expanded-test scoped TypeScript uses `/workspace/scratch/b08749f7eca6/customer-registry-u07-20261001.scoped.tsconfig.json`,1536MiB, and passes exit0. No broad application check, SQL/native/GoTrue/Storage/browser/provider/ordinary-role execution, commit, index, migration, generated file, original artifact, memory, workflow, ref or publication was changed by this phase. Deeper older PRODAT boundary tests remain BLOCKED_AUTO_REVIEW/NOT_EXECUTED and are unrelated to this legitimate read-only business fixture.

Independent requirements peer verified the canonical prerequisite source and ran the historical19 case5RED/14GREEN bytes. Its actual config-derived maxRows finding is incorporated into the final24 case author proof; no final24 peer rerun is claimed until received.

## Phase2 implementation and current result

Root explicitly authorized the reviewed read contract and allocated only `20261001114832_customer_registry_full_corpus_u07.sql`. The path existed as an empty successfully allocated draft. A following CLI status poll received an automatic review rejection citing pending approval and possible telemetry. Root re-read the original mandate and directed the materially safer alternative: local file edits in that already allocated path, without another CLI operation, status poll, allocation, network or telemetry retry. This owner used only that local-file alternative and synthetic local business verification; no rejected operation was retried or deployment performed.

The migration is STABLE SECURITY INVOKER with fixed `pg_catalog, public` search_path and schema-qualified tables. It performs one WITH statement for the complete current base, relation facts, count-set, selected status/latest-contract set and bounded page. It declares service_role-only EXECUTE, revokes PUBLIC/anon/authenticated execution, adds no table grant, mutation, actor/session shortcut, readiness healer, writer, four phantom columns or historical metadata backfill. A final PostgREST schema-cache notification is declared; it does not establish an actual native PostgREST receipt.

The advanced reader now invokes this owner through a server-only helper. The helper validates safe integral counters/revision, exact requested company or the existing explicit global floor, valid current fields, intentional null facts, complete bounded page length, duplicate ids, and consistent count/page metadata. It never falls back to a capped legacy search or empty success when the RPC is missing/malformed. The four unavailable fact projections remain null.

The current actual page catches only `CustomerRegistryFilterUnavailableError`, after its original canonical guard, current scope and company comparison. It renders a constant role=alert and a link which clears only the unsupported flag/page while retaining query, operations, status, contract and customer-type selections in the current company context. It exposes no raw database error or fabricated zero total. Other errors throw. The old after-page contract filter is removed because latest-contract membership is now owned before pagination. The guard, selection checks, operations filtering/sorting, other child reads and secondary summary helper remain unchanged.

Installed Next16.3.8 server-component, expected-error and Link documentation was read before the page change. The existing pinned server-only Vitest alias is used; no new global configuration or fake server-only mock was added.

| Current proof | Actual outcome | Exact limit |
| --- | --- | --- |
| Historical24 actual exported-reader cases after new RPC seam | 24/24 PASS at11:59:08Z | Installed client + controlled RPC snapshot boundary. It is not execution of the SQL function in Vitest. |
| Final actual exported reader/page/checked DTO + retained source checks | **32 new +6 retained =38/38 PASS**, three files,12:15:03Z (runner14:15:03+02),1.66s,237ms tests | Original24 preserved, plus two actual SSR unavailable-page controls, unexpected-page-error propagation, missing-RPC no fallback and four malformed snapshot denials. Only page's outer guard/current-scope observations are controlled; no Auth/authority receipt is established. |
| First canonical-core setup | 0/10 business cases reached, all setup42830 | Canonical unique-index dependencies were initially omitted when reconstructing composite FKs. Corrected by installing actual canonical unique indexes, not by weakening FK assertions. Not product RED. |
| Actual initial candidate SQL on faithful canonical relations | 9 PASS /1 genuine FAIL | A legitimate null-customer point with two differing same-company site aliases was missed when only coalesce's first alias was discovered. The second alias belonged to the searched owner. Actual current MATCH SIMPLE FKs admitted the fixture. |
| Narrow source correction and expanded final SQL core | **12/12 PASS**,41094.738ms, completion observed before12:15:05Z | Discovery now checks both aliases before facts; an owned conflict raises55000. Whole actual new migration executes against current canonical CREATE/checks, primary/unique/index keys and every FK between the five real tables/typed company parent. |
| Final scoped TypeScript/lint/syntax/diff | All PASS,1536MiB TS exit0; lint0 | No broad application/test gate or native installer result is claimed. |

SQL core additionally executes complete >1000 customer/site/contract/point/POA facts, pre-status/pre-contract chip universe, latest-contract and microsecond/date ties with UUID ordering, literal punctuation and separate fields, true empty/off-end totals, canonical null point ownership via exact site, legitimate disjoint company graphs, explicit unsupported/invalid parameters, actual hidden/test/archive predicates, and a legitimate owned contract alias disagreement. It compares full table values before/after reads and reads actual function catalog volatility/security/config/declared grants. Those catalog inspections are model SQL facts, not installed Auth/RLS/ordinary-role execution. Defaults for public reference generation and the outer companies parent are explicitly typed synthetic fixture boundaries; unrelated production triggers, Auth, full schema and native privilege paths are not installed or claimed by this core.

The peer's early suggestion to include null-company customers was withdrawn after re-reading the actual published base and advanced loaders: both explicitly exclude `company_id IS NULL`. The new owner preserves that floor. No source change widened this compatibility behavior.

Current source/proof SHA-256:

| Path | SHA-256 |
| --- | --- |
| `lib/customers/getCustomers.ts` | `2b31a526fe0f5e70608e8e7fe12e9cb76fbe0f412a403e85fa32e60b9feffcbb` |
| `lib/customers/customerRegistryPageRead.ts` | `7246c3d3cb7122fcb83c8c530b7e13c95be21082063d14d64149d6b97c25cf09` |
| `app/admin/customers/page.part-2.tsx` | `9f83a7b866da1d20140908a3505b568f4d1bd81ebb8369f6cff26ca67e073b69` |
| `__tests__/customer-registry-full-corpus-u07-20261001.test.ts` | `e97bf2d6cad1c6fa703f83d09aa8f9f9759a33b53ee8f48cd73340795c47fe45` |
| `scripts/customer-registry-full-corpus-u07-20261001.postgres.test.cjs` | `8aa6599346defd60354b35a114e1a589f3d0e853d6c572c7f736903e9cb00ff6` |
| `supabase/migrations/20261001114832_customer_registry_full_corpus_u07.sql` | `5e9a91861d50fa8ddf203c76ad05cd8813706c8205cc1848276f8954db1a396a` |

Permitted local commands:

```sh
/tmp/ediel-toolchain/node_modules/node/bin/node --max-old-space-size=1536 node_modules/vitest/vitest.mjs run __tests__/customer-registry-full-corpus-u07-20261001.test.ts __tests__/customer-registry-hydration-performance.test.ts __tests__/customer-registry-shell-performance.test.ts
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/customer-registry-full-corpus-u07-20261001.postgres.test.cjs
/tmp/ediel-toolchain/node_modules/node/bin/node --max-old-space-size=1536 node_modules/typescript/bin/tsc --project /workspace/scratch/b08749f7eca6/customer-registry-u07-20261001.scoped.tsconfig.json
```

## Remaining exact internal seams

- Ordinary no-query/all-filter database pagination still takes a separate customer, status-count and hydration read. Its complete child facts/same-snapshot qualification are OPEN; this advanced owner is not silently substituted for it.
- The live page's operations filtering/sorting still happens on the returned page, with related operational reads capped150. Latest badge/summary uses the older helper which orders only created_at and is subject to PostgREST max_rows; a same-date tie or many contracts can yield a badge inconsistent with correct advanced membership. That separate summary source remains OPEN, as root adjudicated; it is not reused to filter the current canonical result.
- `getCustomers` still explicitly requests page1/100 for the segment and operations-integrity consumers. Their complete corpus/count/filter behavior remains internally implementable OPEN.
- Four absent fact writers/versioned envelopes, including the separate merge writer, remain internally OPEN. Unsupported filters do not become fake false/empty facts.
- Offset traversal under concurrent changes, native actual installed roles/PostgREST/compiler, live current guard and browser journey, indexes/query plans/large-workload latency, all other register families/API readers, Event-v2 (preserved) and semantic OPS148 closure are not qualified by this packet. No external blanket blocker substitutes for these tasks.

The seven-path source/proof packet is frozen for independent requirements review. No final phase2 independent receipt is claimed until received. Root owns generated schema/types, checksums/workflow, whole gates, index/memory, Git refs, integration and publication. This owner performed no such action.

## Independent final receipt and report-only supersession

The pending-review sentence immediately above is superseded by the actual requirements peer receipt on2026-10-01. The peer verified every seven-path SHA-256, bytes and Git blob against review manifest `b6f5664b07582814fec1a8d5c57f3089385e6efbe6cb13b058ba2097692441e8` before and after its work; postcheck actualUTC `2026-10-01T12:21:01.995040Z`.

It independently executed the actual PostgreSQL-core suite **12/12 PASS**, exit0,44620.668ms, under Node22/NODE_PATH/1536MiB; and default repository Vitest **32 new +6 retained =38/38 PASS**, exit0, three files,1.52s/248ms tests, actual UTC start `2026-10-01T12:20:44.137554Z`, finish `2026-10-01T12:20:46.328702Z`. Vitest's displayed14:20:44 was the UTC+02 runner clock.

The peer read the actual SQL, parser, reader, page diff, core and report and found no concrete bounded blocker. It confirmed the preserved nonnull-company floor, literal per-field query, count-set before status/contract, latest created_at/id ordering before page, exact relation/dual-alias unavailable behavior, malformed/missing-RPC denial and narrow typed page catch. Native/Auth/ordinary/RLS/whole-catalog/actual NextHTTP/browser/provider execution remains0. All explicitly OPEN secondary badge/ops/basic/segments/integrity/fact-writer/performance seams remain unchanged.

Only this report's metadata is appended after review. The other six source/proof/SQL hashes remain exactly those in the reviewed manifest. The previous report SHA-256 `a94aef3b031d2eff1ad7fafdbff10cb7645723910c6dc70501945d33f0cd863a` remains the reviewed historical receipt and is superseded by the final seven-path manifest's report row; no historical source/proof bytes were relabeled or altered.

Skill routing for this bounded author task: installed TDD/systematic-debugging instructions governed RED/setup/false-positive separation; canonical Supabase/Postgres and SQL optimization instructions governed invoker/graph/one-statement semantics. No index or latency improvement is claimed without an actual workload/query-plan receipt. Installed Next docs governed the server-component expected-error rendering. Broad security/credential/provider/ordinary-role exercise groups were outside this task, and the previously blocked deeper legacy boundary remained blocked.
