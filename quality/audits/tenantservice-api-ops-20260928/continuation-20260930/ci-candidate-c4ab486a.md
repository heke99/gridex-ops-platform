# Actual eighth candidate CI receipt — c4ab486a

Repository `heke99/gridex-ops-platform`, existing draft #422. This is a terminal read-only receipt of the actual first-attempt GitHub runs/jobs/logs/artifacts requested by root. No rerun, ref/index mutation, generated-source adoption, product/SQL edit, live Auth/DB exercise or provider traffic was performed. Raw decoded logs and ZIPs remain in a private directory outside the repository. This report contains only bounded public source references, counts, safe fixed diagnostics and byte hashes. All original T01–T55/U01–U20 and P0–P8 acceptance outcomes remain OPEN unless their separate root acceptance ledger establishes otherwise; this receipt does not promote whole rows.

## Exact tested source

| Provenance | Observed value |
| --- | --- |
| Published head | `c4ab486a9c83d629a9dbd26f8b974f9186e860f6` |
| Head parent | `57534afc4621e084251a6a878f23b67a2d4ac62e` |
| Actual PR merge checkout | `f2f5cf878b0af4c6815505700015edd0d5726ff7` |
| Merge parents | `ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8`, `c4ab486a9c83d629a9dbd26f8b974f9186e860f6` |
| Head and merge tree | Both `077bcab05ab7ae4015908114f04ad5937daa81bf`, independently read from GitHub Git-commit metadata |
| OPS run | [36819509793](https://github.com/heke99/gridex-ops-platform/actions/runs/36819509793), pull_request, attempt1, created/started `2026-10-01T05:23:07Z`, terminal FAILURE, updated `05:31:06Z` |
| Exact OPS workflow source | Fetched at the immutable head, 37,511 UTF-8 bytes, SHA256 `32210880d8d083ac7638a1551442af43b509655113a2167286683b7c9778e91d` |
| Genuine replay/upgrade tail | `20261001042748_customer_lifecycle_case_source_binding.sql`, 653 pinned baseline migrations plus29 forwards |
| Actual replay CLI | Supabase `2.101.0`, both immutable workflow pin and actual job installation/update notices |

Each timestamp below is an actual GitHub Z-prefixed log or UTC run/artifact metadata value. ZIP DOS member mtimes are explicitly separate metadata with two-second resolution; they do not establish an exact absolute creation instant. No local Vitest time is relabeled as UTC. All fetched run metadata binds the same published head and first attempt; actual checked-out jobs bind the merge above.

## Terminal OPS jobs

| Job | Actual terminal result and first failed boundary |
| --- | --- |
| verify `110231824326` | FAILURE. Migration integrity682 files/586 version groups and checksums PASS at `05:23:28.133Z`; legal/hardening checks PASS, then generated-types manifest rejects changed tail042748 at `05:23:28.518Z`. Exit1 `05:23:28.615Z`; all subsequent verify steps skipped. |
| quality-release-gates `110231824209` | SUCCESS. Actual whole unit7461/7461 in513 files at `05:28:11.154Z`; separate quality45/45 in2 files at `05:26:13.237Z`. Lint, script/test typechecks, mechanical, docs, compatibility, local release, RBAC, file/performance budgets, build and bundle gates all completed SUCCESS. |
| clean-migration-replay `110231824354` | FAILURE. Empty replay and authentic generation PASS; six subsequent bounded native batches PASS. The new three-case lifecycle-source-binding fixture then fails during each afterEach cleanup at `05:26:08`; exit1 `05:26:24.866Z`. All later native/HTTP/browser packages NOT_REACHED. |
| upgrade-backup-restore `110231824437` | FAILURE overall. Genuine29-forward upgraded archive/catalog/data/Auth/owner/ACL and current command proofs PASS. Then tracked old schema byte comparison fails. Independent pre-forward archive/catalog proof PASS, followed by fixed old-authenticated SQLSTATE P0001 failure. Fresh pinned-old backfill native1/1 separately PASS. |

The generated-types manifest failure is a genuine fresh-capture barrier. It does not establish a SQL migration or business-command defect. Authentic generated files below were produced before the later failing native fixture and are available for root's byte-exact adoption; this owner does not edit tracked generation or the manifest.

## Clean replay: actual order and reachability

The last forward is applied at `05:25:28.123Z`. Official Supabase CLI ledger48 rows is verified at `05:25:28.198Z`; reconstructed replay fingerprint `c70fa2f017f6ce3af3ff806d948f18b58a3c196e4bf94daa9304629a3926680c` is verified at `05:25:28.310Z`. Live catalog readiness is true and the replay emits its canonical checksum-pinned-history PASS at `05:25:28.431Z`. This replay-specific fingerprint is distinct from the full generated snapshot fingerprint below.

Snapshot postprocessing records the generated full fingerprint at `05:25:29.904Z`. Type generation connects at `05:25:30.128Z`, and actual nullability overrides are applied to `rem002-database.types.ts` at `05:25:35.101Z`. Later source-defined SQL regressions execute; genuine portal revocation, Event-v2 and contact markers appear at `05:25:38–39Z`.

| Sequential batch | Genuine count / completed boundary |
| --- | --- |
| Webhook fairness | 6/6 PASS `05:25:42.085Z`, including all six persisted turn/eligibility/ACL/late rollback/real-two-session markers |
| Residual queues, aggregate tenant budgets and lease CAS | 14/14 PASS `05:25:49.551Z` |
| Provider event order and customer-operation queue | 10/10 in2 files PASS `05:25:55.025Z` |
| Reachable Ediel resume fairness | 7/7 PASS `05:26:00.682Z` |
| Current contract target/authority | 1/1 PASS `05:26:03.585Z`, actual authority marker `05:26:03.580Z` |
| Atomic lifecycle event/required intent | 5/5 PASS `05:26:06.029Z`, all five required operation-bound markers emitted with external_delivery=0 |
| New lifecycle source-binding fixture | 3/3 FAIL `05:26:08.179Z`; none is qualified PASS from its earlier stdout marker |
| Agreement atomic/cleanup, old source-owner batch, notification/profile/address/site/inbound/scanner/billing/support and all later local browser journeys | NOT_REACHED in this clean job, by exact immutable workflow order and stop-on-failure behavior |

The first three listed failures belong to `scripts/customer-lifecycle-source-binding-20261001.native.test.ts`:

1. Actual PostgREST producer creates a durable withdrawal and replays after title edit.
2. Current cancellation cases use cancelled and replay concurrently without duplicate decisions.
3. Late statement failure preserves existing case, quiet tenant and zero decisions.

All three printed their target business markers before failure: `CUSTOMER_LIFECYCLE_SOURCE_POSTGREST_NATIVE_PASS` at `05:26:07.208Z`, `CUSTOMER_LIFECYCLE_CANCELLED_REPLAY_NATIVE_PASS` at `05:26:07.580Z`, and `CUSTOMER_LIFECYCLE_STATEMENT_ROLLBACK_NATIVE_PASS` at `05:26:07.965Z`. Their shared failure stack points to the afterEach cleanup call at native fixture line35 and `proofSql` in `scripts/customer-read-proof-native.ts:28`. The exposed error is only the fixed `customer_api_proof_database_failed`; that helper intentionally drops private psql context. No underlying SQLSTATE/raw cause is available in the actual job log.

Source inspection shows the cleanup attempts to delete its decisions, cases, contracts, customers and companies. Prior immutable legal-version cascade failures are a plausible diagnostic lead, but are **not established as this actual cause** by the discarded context. The correct next action is a narrow legitimate cleanup/diagnostic repair retaining all business assertions and immutable history. This receipt does not disable guards, infer successful cleanup or reinterpret marker output as completed tests.

The old source-owner 43/377 failures from the seventh candidate were not reached here, so the eighth run neither re-proves nor clears their corrections. Prepared scanner14 native cases and the separate real-GoTrue/Next denial journey, stored-staff positive support SQL/HTTP/page and all billing/reference/browser continuations likewise remain pending exact-candidate execution, rather than externally blocked by this fixture failure.

## Upgraded real archive and pre-forward rollback

The actual upgrade plan validates653 baseline migrations and29 forwards at `05:23:53.422Z`. All29 apply; the final migration is observed at `05:25:53.854Z`. Existing country/channel/contact separation, explicit-equal copies/relationships, historical lifecycle prerequisites and issued bytes PASS before the real backup.

The random empty template0 target and local administrator authority PASS. A genuine pg_dump archive restores at `05:26:05.227Z`, and source-bootstrap ACL reconciliation passes at `05:26:06.665Z`. Application/Auth data and owner/column/default-ACL equality pass at `05:26:07.041Z`. **Complete schema/function/RLS/ACL parity passes at `05:26:07.900Z`.** No comparison category, owner, grant, policy or function is ignored for that actual receipt.

At `05:26:08.072Z` the restored database emits all five required current command markers: authenticated/anon ACL and tenant RLS, current-permission/foreign-tenant command denial, authorized atomic command/replay, expired/revoked session replay denial, and issued-invoice locked snapshot guards. The final post-proof zero-persisted-effects marker passes at `05:26:08.750Z`.

The first failure afterward is the plain tracked-vs-generated schema comparison at `05:26:08.752Z`: byte875762, line17307. Step exit1 is `05:26:28.488Z`. This is a tracked snapshot-generation boundary after the protected actual restore proofs, not a remaining owner/ACL/catalog mismatch.

The separate old rollback is a fresh pinned ae56 replay with no candidate forward. Actual baseline653, seeded real old business rows, template0 target and local restore authority pass. Its old archive restores at `05:27:58.435Z`, source bootstrap ACL reconciles at `05:27:59.933Z`, old business/Auth/issued/owner/ACL equality passes at `05:28:01.457Z`, and complete old schema/function/RLS/ACL parity passes at `05:28:01.599Z`.

The next protected SQL proof fails. Its only authentic diagnostic is `proof=old_schema stage=old_authenticated sqlstate=P0001` at `05:28:01.712Z`; failure cleanup removes private logs and exits1 at `05:28:21.697Z`. No raw assertion/cause is available. It remains a concrete internally pending old-authenticated proof failure and must not be marked PASS, described as provider/IdP-blocked, or resolved by weakening old ACL/current guard assertions.

The independent fresh-old-schema backfill step continues afterward and passes1/1 at `05:30:11.114Z`. Its genuine receipt includes eight witnesses: complete SQL dry-run zero effects; real42501 low-role no effects; late-audit whole-database rollback; agreed-NULL repair; conflicting-NULL, missing-parent and nonnull-mismatch manual zero company/correlation/audit effects; and replay whole-database zero effects. This qualifies that bounded fixture, not all P8 rollback or all legacy imports.

## Other requested terminal runs

| Run and actual job | Genuine outcome and qualification |
| --- | --- |
| [Full E2E36819509784](https://github.com/heke99/gridex-ops-platform/actions/runs/36819509784), coverage110231824296 | SUCCESS;7461/7461 in513 files at `05:26:11.664Z`. This repeats unit coverage, not a second unique business denominator. |
| Same run, smoke110231824458 | FAILURE. Actual15-step report14 PASS/1 FAIL; sole failed ID `migrations`, exit1, database_or_migration_drift, from the same generated-types tail042748 barrier. Started `05:23:38.371Z`, finished `05:24:27.199Z`. Its separate `typecheck` step PASS/exit0,45.371s. |
| Same run, PR certificate110232585990 | FAILURE because SMOKE_RESULT is failure while COVERAGE_RESULT is success; exit1 `05:26:20.445Z`. Full, runtime-staging, real-customer-staging and nightly jobs SKIPPED, not executed business qualification. |
| [Browser36819509794](https://github.com/heke99/gridex-ops-platform/actions/runs/36819509794), browser-public110231824562 | SUCCESS, actual `e2e/browser/public.spec.mjs`4/4 at `05:24:17.253Z` using local Next. Staging browser/k6 load/k6 soak/ZAP/certificate jobs SKIPPED. This is public-page coverage, not the later protected OPS/customer/scanner journeys. |
| [Ediel36819509940](https://github.com/heke99/gridex-ops-platform/actions/runs/36819509940), targeted-regressions110231824321 | SUCCESS. Actual source/renderer/reference/document/party/register/dependent/escaping/protocol suites execute; register627 and dependent798 cases PASS, plus scoped17/21/19/137 and other documented groups. Repeated380-case runs are repetitions, not a unique aggregate acceptance count. No real transport/market acceptance is inferred. |
| [Tenant36819509850](https://github.com/heke99/gridex-ops-platform/actions/runs/36819509850), tenant-integrity110231824096 | SUCCESS; actual source tenant-integrity/shutdown regressions pass `05:23:16.335–16.387Z`. No new live Auth/RLS/every-caller qualification is inferred from these source scripts. |

Smoke's other fourteen passed step IDs are whole-project-coverage, tenant-platform-contract, tenant-model, tenant-source-of-truth, test-production-separation, website-intake, route-readiness, edifact-customer-flow, metering, billing, portal-api, RBAC, API-boundaries and typecheck. These retain each source gate's actual scope. The public `.1` docs/compatibility/local-release quality receipts do not replace the NOT_REACHED authenticated staff-message/support/portal positive native journey.

## Authentic generated files and verified artifacts

Clean artifact [11142174393](https://github.com/heke99/gridex-ops-platform/actions/runs/36819509793/artifacts/11142174393), `gridex-rem-002-clean-replay`, created `05:26:25Z`,1,045,454 ZIP bytes. API digest and downloaded ZIP SHA256 both equal `fc19eb3af03058180457f35c4b8d2c2dff02d7acda52547f033159fa0c3a58b0`. All four ZIP members were inventoried; only the three generated source members were extracted. They bind actual head/merge/tree/replay29/CLI above, not the newer unpublished working-tree forwards.

| Authentic ZIP member | Bytes | SHA256 | ZIP DOS mtime only |
| --- | ---: | --- | --- |
| `rem002-database.types.ts` |3,398,200| `dbb01fc8e2592b1e3366043faf20544852ed26fb1553d73dee1c2d588ef5c3cc` |2026-10-01 05:25:34,2s resolution |
| `rem002-schema-snapshot/schema.sql` |6,042,365| `f467e8d8ccd1e88f74c4909875faaebf90fc6d3da19d978e0febfdb6688aef10` |2026-10-01 05:25:28,2s resolution |
| `rem002-schema-snapshot/schema.fingerprint.json` |1,895| `91cc85856aa70fcbf451c767c1dbd6485a696c052f6bebce388cb2d464bfafb7` |2026-10-01 05:25:28,2s resolution |

The fingerprint's own canonical SHA is `61b6d626bcf00589d7cb66b9f154a5503cb317e3602f1884f6a552b954dffc79`, algorithm sha256/canonical-json/v1, schemas public and gridex_received_sources. Its exact value also appears in actual snapshot postprocessing at `05:25:29.904Z`. The file SHA and canonical fingerprint are different quantities. Final generated-type byte comparison/echo after all native/browser commands was NOT_REACHED; artifact-derived byte hashes remain independently verified, without inventing that later gate.

Safe upgrade artifact11143520198 is3,868 ZIP bytes, API/download SHA256 `a7cee2e9996277410d18edd996ccc3bef5e014257b42a10e856a3701c6db123c`, created `05:30:11Z`. It contains exactly the sanitized upgrade, baseline rollback and backfill logs; no private SQL error context is recovered or inferred. Smoke artifact11142159294 is21,455 ZIP bytes, API/download SHA256 `62dc1195b4f13700ff1216cbb7f2f7ffed9534f0f8a38d7087f0115463118c24`, created `05:24:28Z`; its actual report supplies the15-step outcome above. Other coverage/certificate artifacts were identified through metadata but not downloaded or represented as independently verified bytes.

Private generated extraction: `/workspace/scratch/b08749f7eca6/ci-evidence/candidate-c4ab486a/generated/`. Root alone owns adoption, genuine manifest advancement, index/ref operations and publication. No raw credential, signed download URL, decoded private SQL context or fixture payload is copied into this report.

## Concrete continuation boundaries

Root must first integrate the authentic29-tail generation, correct the new lifecycle fixture's legitimate cleanup, and diagnose the old-authenticated baseline proof from its permitted safe boundary. Then the prepared downstream native/HTTP/browser suites must actually execute on a newly published exact candidate. The remaining account8/manual fairness/producer/delegation packages are newer unpublished source; this eighth report does not qualify them. Real scanner/provider/issuer/hosted/PITR/operator dependencies remain precise separate external boundaries; fixture cleanup, local rollback, source handoff and NOT_REACHED suites are internally executable pending work.

Routing reuses project source/differential review and verification-before-completion. This read-only CI task uses connector run/job/log/artifact/Git source reads and private byte hashing; it adds no local product test or privilege exercise and needs no new migration/worktree/publication workflow. Shared original requirement CSVs, prior frozen packages, historical SQL/checksums and project memory are unchanged by this owner.
