# Task 10b2: selected-company billing/pricing authority probe

Date: 2026-09-12. Base: `4d4fe075198ad61b9df85aa456e40965668549dc`.
Disposition: **CONFIRMED, High**, one remaining application authorization defect affecting five selected-company route files (six exported HTTP handlers). All five reach actual wrong-company service queries and write/RPC boundaries in the source-only proof. Period-lock GET and pricing preview additionally return wrong-company information. This is bounded application evidence, not a native SQL exploit or production incident claim.

## Scope and skill routing

Read AGENTS, memory README/current-state/checkpoint, authentication-and-rbac/security-model, relevant decisions/known-failures, actual implementation and the earlier report's “Entity guard: separate default selection can disagree.” The earlier server-action/entity defect is already fixed and was not reimplemented or reprobed. Applied `fp-check` (cross-component data-flow, controls, devil's advocate and gates), `variant-analysis` (the specified remaining family), and `verification-before-completion`. The delegated-task exemption in `using-superpowers` applies. Deep-check phases were performed locally because the assignment expressly forbids subagents. This is a bounded finding check, not the AGENTS repository-wide baseline audit: broad scanner/supply-chain/performance/UI/native/deployment and remediation workflows are not triggered by this scope. No new task, plan, production, permanent-test, memory, SQL, workflow, index or Git edits were made. Existing Task 10b1 changes were preserved. Only this report and its adjacent optional source proof were written.

## Claim, valid trigger and boundary

Invariant: permissions resolved for canonical company A must only authorize selected-company operations for A for an ordinary actor. The actual API guard calls `canonical_authenticated_tenant_context` with the selected-company cookie or NULL, checks authentication/identity, uses the real permission engine, and retains `guard.companyId` (`lib/admin/apiGuards.ts:82–164`, especially 101–107, 135–149). Each selected-company route ignores that field and independently calls `requireOperationalCompanyId(userId)`.

Valid synthetic fixture: one active, confirmed, nonplatform identity; two active `member` memberships, both `is_active=true`; active company-bound custom-role assignments in A and B; both companies active; A membership created January 1 and B February 1. A has billing.read/billing.write/pricing.write; B has only customers.read and thus none of the relevant permissions. There are no global roles, owner memberships or overrides. With no cookie, the canonical selected company is A. The operational service query can lawfully return B then A because it has no ORDER BY. Attacker control consists of an authenticated request with the cookie absent and ordinary month/record/action inputs; the attacker need not alter memberships, role rows or the canonical response. B-first DB order is a precondition, not a claimed user-controlled ordering primitive or a claim about current production physical order.

Canonical derivation is supported by `20260810193450_canonical_access_provisioning_runtime_v1.sql:537–578,622–660`: active identity and assignments, requested company if present, owner first, then membership.created_at, with selected-company role permissions. `20260810224500_canonical_review_remediation_v1.sql:291–294` renames this to `_v1_scoped`; latest wrapper `20260902091000_company_scoped_permission_engine.sql:28–41` directly delegates to it. The proof models only the auth/RPC I/O result from those same membership/assignment fixtures; it does **not** execute SQL or arbitrarily set an unrelated canonical company. A/B/actor/resource IDs are readable synthetic identifiers for application-only execution, not UUID-bearing native SQL inputs.

By contrast, `lib/tenant/scope.ts:105–139` queries active-status memberships without ordering; `145–184` honors a cookie membership or chooses owner-or-first; `187–193` returns the result. No company-scoped permission check runs there. The real role normalization, lifecycle visibility and `hasPermissionRequirement` execute in the proof. React cache and cookie/auth/service responses are controlled boundary I/O.

## Confirmed receiver and effect matrix

All source lines and hashes below refer to the byte-identical base sources, independent of the concurrent API author's files.

| Entry and required permission | Actual receiver and observed no-cookie A → B effect | Classification |
|---|---|---|
| `billing/period-locks GET`, billing.read; route:14–25 | `invoiceReadiness.ts:195–216` executes service SELECT `billing_period_locks` for B and returns B's lock reason in HTTP 200. | Confirmed unauthorized B billing read; Medium standalone. |
| `billing/period-locks POST lock`, billing.write; route:31–67 | `invoiceReadiness.ts:233–272` executes B `billing_period_locks` upsert and B compatibility `price_period_locks` upsert, with actor attribution, HTTP 200. | Confirmed unauthorized B lock/exported/closed transition authority; dynamically exercised default lock. High. |
| Same POST unlock/reopen; route:42–51 | `invoiceReadiness.ts:275–318` executes B reopened upsert, B compatibility unlock update, and B `gridex_unlock_pricing_runs_for_month` RPC, HTTP 200. | Confirmed wrong-company reopening and downstream unlock delegation. High. |
| `billing/generate-underlay POST`, billing.write; route:14–24 | Real `underlayEngine.ts:475–529,592–720,975–997` reads B's supply period/contract/snapshot, takes the legitimate missing-meter-values branch, and passes a B pending/blocked command and actor to `gridex_store_billing_underlay_batch`. | Confirmed wrong-company batch-write delegation. Generated fixture stays blocked; no promotion-to-ready claim. High in shared defect. |
| `pricing/preview POST`, pricing.write; route:14–35 | Real `engine.ts:320–427,575–667` calculates B production settlement; persist:false returns B's -20 SEK versus A's -10 SEK; default persist and month branch call B `gridex_persist_pricing_run` at 305–313. A blocked B fixture also returns its private billing-blocker text. | Confirmed B read and pricing persistence delegation. High. |
| `pricing/reprice POST`, pricing.write; route:10–21 | Real underlay calculation, source-evidence validation and success-persist revalidation call B `gridex_persist_pricing_run`. | Confirmed B pricing-write delegation. High. |
| `pricing/lock-preview POST`, pricing.write; route:10–21 | Real `engine.ts:670–683` runs `loadPricingRunEvidence` then passes B/run-B/actor to `gridex_lock_pricing_run`. | Confirmed B pricing-lock delegation. High. |

The proof loads complete actual TS module bodies; auth guard, access model, operational scope, route, billing receiver, pricing receiver, production calculator, preview builder, Stockholm helpers, schema readiness and underlay/run evidence execute. Only boundary I/O/cache/NextResponse/error formatting is injected. Unused pricing/settlement imports are absent rather than replaced by permissive helper stubs; an unexpected invocation fails the proof. In particular the lock proof uses real complete item-count, quantity, period, customer/company and production-evidence validation. The generation proof uses one active supply period with no available normalized values and preserves the resulting pending/blocked status. It does not invent ready metering evidence or claim invoice generation/export.

## SQL receiver and defense review

`lib/supabase/service.ts:1–12` constructs the service-key client used by all receivers; the requesting user's session is not sent to those service operations. `billing_period_locks` has a service-all policy in `20260609113000_batch_2_3_4_6_period_onboarding_ediel_portal.sql:225–265`; its 4–23 schema checks company/year/month/status and uniqueness, with actor columns used for attribution. No application permission recheck exists between route and these direct writes. A native policy/trigger catalog was not queried in this task.

The complete current checked-in command bodies were read, including actor usage:

- `20260716010000_contract_billing_end_to_end_completion.sql:1004–1098`, `gridex_persist_pricing_run`: requires company/underlay, valid result status, exact contract/snapshot, matching company-owned underlay, and no locked run; then inserts run/lines/evidence and updates the B underlay. **No actor parameter or actor permission assertion.** Calls are service-only by 1422–1423; this route is the service caller. Thus “service-only RPC” does not defeat the confused-deputy path.
- Same migration `1100–1146`, `gridex_lock_pricing_run`: validates matching company-owned successful/locked run and matching underlay, then writes period lock/charge ledger/run lock/underlay readiness. `p_actor_user_id` is written to `locked_by`; it is not checked for B pricing permission. Grants at 1424–1425 are service-only.
- Same migration `1201–1231`, `gridex_store_billing_underlay_batch`: advisory lock plus loop into `gridex_store_billing_underlay`, forwarding company/actor. Latest full store body is `20260901152500_canonicalize_billing_underlay_stockholm_period_semantics.sql:1–77`, with service-only grants at 120–121. It checks company/customer/meter, segment, item-array, direction and matching B customer/meter, upserts the segment, replaces its items and appends an event. Actor appears only in created_by/updated_by/event attribution. The earlier dynamic column rewrite in `20260727010000_contract_flow_integrity_completion.sql:548–582` predates and is superseded by the September full body; it is not an added actor check.
- `20260702120000_gridex_billing_pricing_immutability_constraints.sql:84–128`, `gridex_unlock_pricing_runs_for_month`: checks month shape, enables a local maintenance flag, updates B's locked runs and records actor/reason metadata. It does not reauthorize the actor. Locked-row protection at 53–81 is real, but the route invokes its explicit maintenance exception rather than defeating an immutable-row check by ordinary UPDATE.
- `20260716090000_production_settlement_export_completion.sql:137–148,169–172` adds same-company energy-flow inheritance and repairs command search_path; it does not add actor permission checks. Other checked protections include same-company underlay parent triggers (`20260615_multitenant_integrity_and_claim_locks.sql:192–218`), exact contract/snapshot checks (July16 migration:985–995), price-area canonicalization (`20260804190000_svk_geodata_and_billing_price_area_canonicalization.sql:350–426`), and company/snapshot FKs (`20260805085617_api_contract_billing_tenant_hardening.sql:166–216`). They protect consistency within B, not whether A permission may authorize the actor in B. The fixtures have a matching SE3 snapshot and matching B entities. These SQL protections were source-read, not natively executed.

Consequently, confirmed effects are actual application service query/write or RPC invocations and returned data. SQL source supports mutation semantics without a B actor permission barrier. No fake RPC success is presented as proof that native SQL, all historical transformations, managed catalog, PostgREST, trigger/FK composition or production commits succeeded.

## Refuted and bounded cases

- **Refuted for this bug: the two spot routes.** `spot/import-month/route.ts:16,23` and `spot/lock-month/route.ts:38,53–59` discard the operational company result. The import receiver (`spotPriceImporter.ts:399–460`) works on shared provider/area/month import/summary tables, and `settlementLocker.ts:20–38` supplies provider/price area/month/actor without company. `20260724120000_canonical_market_resolution_quote_billing_flow.sql:136–195` checks service role, shared provider/area/month coverage and performs the shared settlement lock. A B-company effect cannot be inferred from their incidental scope-helper call. No spot-provider operation ran, and this is not a broader approval of shared-market permission policy.
- **Refuted: explicit cookie A plus foreign B record ID overrides scope.** Four ID-taking pricing branches query A plus the B ID and fail before an RPC. Cookie A plus A ID succeeds even with B-first membership I/O. Cookie B lacks the required permission and is denied before any operational service query.
- **Refuted: no permission is required.** Canonical A lacking the relevant permission returns 403 with zero service reads/writes/RPCs for every tested route branch.
- **Refuted: data-validation and billing locks are absent.** Locked B month blocks generation/preview/month preview (409) and reprice (500) before a write. An invalid B underlay blocks lock-preview's actual evidence helper before its RPC. Price/billing record identity filters, legal/snapshot consistency, source gates and native immutability remain separate protections.
- **Not claimed:** arbitrary nonmember-company access, unauthenticated access, platform-role escalation, cookie forgery, control of DB row ordering, SQL injection, races, raw authenticated RPC execution, actual invoice issuance/export, provider action, or a production tenant incident. Both memberships in the confirmed trigger are legitimate; the missing authority is operation-specific B permission.
- Search `rg -n 'requireOperationalCompanyId' app/api/internal` also encounters read-only invoice-export/provider-status receivers outside the assigned five-plus-two comparison. They are explicitly **not adjudicated by this bounded report** and were not added to the frozen API task.

## Verification and false-positive gates

Executable: `node .superpowers/sdd/2026-09-12-current-and-plan77-85/task-10b2-company-authority-probe.mjs` from repository root, Node v24.19.0. Exit 0, **64/64 PASS**, experimental `stripTypeScriptTypes` warning only. Output is synthetic JSON and source hashes; it is not a permanent test or native acceptance receipt.

| Controlled scenario | Cases | Result |
|---|---:|---|
| No cookie, canonical A older/granted, B-first operational list | 9 | 200; B read/write/RPC as matrix above |
| Same-company A, A-first | 9 | 200; A only |
| Reversed fixture: canonical B older/granted, A-first operational list | 9 | 200; A read/write/RPC |
| Explicit A cookie, B-first membership list | 9 | 200; A only |
| Explicit B cookie lacking operation permission | 9 | 403; zero operational queries/effects |
| No cookie, canonical A lacking operation permission | 9 | 403; zero operational queries/effects |
| B month locked | 4 | Existing period guard rejects; zero writes/RPCs |
| Invalid B source evidence at lock-preview | 1 | 500; zero RPCs |
| B blocked preview read | 1 | 200; B private blocker returned; zero writes |
| Explicit A cookie with B ID | 4 | 500/not found under A filter; zero RPCs |

Fresh final verification also compared every source hash in the manifest with `git show 4d4fe075198ad61b9df85aa456e40965668549dc:<path>`: all 37 files byte-identical. `git diff --name-only -- lib/admin/apiGuards.ts lib/tenant/scope.ts lib/billing lib/pricing app/api/internal/billing app/api/internal/pricing` returned empty. No Git mutation command ran.

Gate disposition: reachability is proven for actual entry/receiver code; the authority mismatch is A≠B under the two lawful selection orders; read and write/RPC-boundary impact is demonstrated; same-company/reverse/cookie/permission negatives challenge fixture validity; no actor-permission receiver check was found in the complete named SQL bodies. Memory safety, arithmetic overflow and concurrency gates are not applicable to this logic defect. Environment/native gates are explicitly bounded: there was no Next transport/browser/SQL/PostgREST/native-RLS test. Thus High **application finding confirmed**, while end-to-end native commit and production reachability remain **UNVERIFIED**, not silently accepted or labeled false positive.

## Bounded recommendation; no implementation

In a separately authorized change, replace the second company selection in the five selected-company route files with the canonical company from the permission guard and reject missing canonical binding. The existing `assertAdminApiCompanyAccess(access.guard)` (`apiGuards.ts:62–80`) already binds requested/default company to `guard.companyId` and applies writable membership/lifecycle rules for write paths. For period-lock GET preserve intended readable/paused lifecycle semantics while binding the lookup to the canonical company; do not accidentally turn a read policy into a writable-company requirement without review. Preserve authoritative platform behavior deliberately. Do not repair this solely by sorting memberships: role/activity/lifecycle filter differences would remain and authorization would still be recomputed independently.

Keep spot shared-market routes outside this company-effect patch. Add supported route-level regression coverage for no-cookie A→B and reverse, explicit cookies, missing binding, permission denial and retained data guards, inverting the admitted cross-company cases to canonical-target operation or denial before effects. No mutation to Task 10b1's four files is needed. Native SQL hardening or wider read-only variants require their own scoped disposition.

## Exact SHA-256 source manifest

Proof SHA-256: `51ee01da8dfb67616c647c6657d0c6d54a304db446ce000afc0ae459fc1c1d41`.

| Source | SHA-256 |
|---|---|
| `lib/time/stockholm.ts` | `dc85350d43db406a772fbc3297a4bce13b316b0d6d0a6d48ac7e8b946edbe568` |
| `lib/pricing/types.ts` | `f13d142c874b9d3181d8d718bbb9785addfd4871a95f9fdb563897daae32ce36` |
| `lib/tenant/lifecycle.ts` | `36184609a4a80f904c11f83f9d2cbdfed4c17d0be5e03294ed2d9ba43ad14602` |
| `lib/rbac/roleKeys.ts` | `d16005d099f972f0ef9cb2ddc5df7b20d63866ff55788b800e0edff2d572edea` |
| `lib/admin/accessModel.ts` | `b2f79ed4917b2239942d3fd9ff92b2f6115a9632d833290c4a8482f0335428f4` |
| `lib/pricing/pricePreviewBuilder.ts` | `90553f54069c7a08317c606536335e7a4f16791d3f5996f4bd31ad4f24b99c82` |
| `lib/pricing/productionSettlement.ts` | `a05990177cab992f23cf1dd149b95701bc224417a0115ae197c4d5f492f0cf1e` |
| `lib/tenant/scope.ts` | `954a1951457b2140a4cd4b8e0531fd2f626fa6bd0ed2e2b6af384e6ccdf6aa96` |
| `lib/admin/apiGuards.ts` | `e504dc9e3c243c3f66beba46881521bbb11d0aad874b99d0de15b763b59d952b` |
| `lib/platform/schemaReadiness.ts` | `8e2f23936d3207bdbc968d63dd29e404c7e070efb90cddbf886246d9987fb38e` |
| `lib/billing/invoiceReadiness.ts` | `4e9ea26cfdacc883e344ecfc8813cce497b4bc96a4acc186effaa6d4607dfe3e` |
| `lib/billing/underlayEvidence.ts` | `720a8799ab4994422503d210620c8bda4fbb6b1cd2c9aa94c18de9884599d89f` |
| `lib/pricing/engine.ts` | `cb2e2225fca0b7d9f0fea71ff9675482075f2078f38faa22c323f0ea6a8d8acb` |
| `lib/billing/underlayEngine.ts` | `5b253baef318236f3d19f85ef9fe293489fbf7de7295b0dc17d14b2cbaca9b7f` |
| `app/api/internal/billing/period-locks/route.ts` | `f2ce3d034ecbc32a2e7e1c95667c291c31fd8b8fe064d88e37633a387182629e` |
| `app/api/internal/billing/generate-underlay/route.ts` | `287ff0a4e5ea3c6e2c20b837a0d47d1875f77bcf53e00ddce819fa71f10972fd` |
| `app/api/internal/pricing/preview/route.ts` | `5d4e02dd1d08c700ccc4e3df4a56292d8e72b830e16ff9e2af1032ef717ec16f` |
| `app/api/internal/pricing/lock-preview/route.ts` | `4970d2ac9bd789dfa8d1ae9a404836f91c3494f1c17de809b899d3ac1cca87f0` |
| `app/api/internal/pricing/reprice/route.ts` | `7cbcd55605432f0510f91e01f41ca91a6621d4f3c858d166eaf93e2ad0c46ed1` |
| `lib/supabase/service.ts` | `0dcb62b49c731a2bb51cf088a922e8d731b6a21137222993da544faa3ee3cf1c` |
| `app/api/internal/spot/import-month/route.ts` | `754f1a130a6a15c78aad7041aac0f1e1ba9c269633dcd6e131bca6f14be0b8c7` |
| `app/api/internal/spot/lock-month/route.ts` | `045c0775ea3eb8fc9b2302ef9c83c7e395bfd9ee474e97c6e0d0ec700566ff5a` |
| `lib/pricing/spot/spotPriceImporter.ts` | `ef39a43935465834cee6e1889bab38b63641e43f5849a04e3bf6a90ff04033c7` |
| `lib/pricing/spot/settlementLocker.ts` | `9bead191aeaf72b0e1b6cc45c340a0d4c34ebf81ef862d2e9e910672acec4092` |
| `supabase/migrations/20260810193450_canonical_access_provisioning_runtime_v1.sql` | `390b0223a8fbafb633795f1ad0116d6cf8ebbddea056226be84711e7d878a4b8` |
| `supabase/migrations/20260810224500_canonical_review_remediation_v1.sql` | `12fb80b8c13f7e105e4c5b63a6145e863872874fd4a2caaea9f669df5a80010d` |
| `supabase/migrations/20260902091000_company_scoped_permission_engine.sql` | `dc72cc26cbb53ab814fcf214dc9324f27bfac9f4bf77940b9e9a0527428f359a` |
| `supabase/migrations/20260609113000_batch_2_3_4_6_period_onboarding_ediel_portal.sql` | `822fa054543dc5d5b45188a060742ac50465177338fc4e262c60205c3177cc7b` |
| `supabase/migrations/20260702120000_gridex_billing_pricing_immutability_constraints.sql` | `e27c10de31bbc04cc06e39e894cc9b6fa9f1aec6490bfbb5e4b403d0cd3faddf` |
| `supabase/migrations/20260716010000_contract_billing_end_to_end_completion.sql` | `681f2061678aa4c22075d730925367a824400a9bd9c58f71281c9e182dee9014` |
| `supabase/migrations/20260716090000_production_settlement_export_completion.sql` | `d50c8f7e755c026d1af9be693bf42b0d0001b4b8a4680c96c4e0d611f03b64eb` |
| `supabase/migrations/20260901152500_canonicalize_billing_underlay_stockholm_period_semantics.sql` | `1722e8bda642ca12c2ca2f337aaaf929bde83ecf82955979d4c671554c2abcbd` |
| `supabase/migrations/20260615_multitenant_integrity_and_claim_locks.sql` | `046c7ec8c885eca46d8dde306bc1b289aa7bccea3f9d4ebdd5f8580c07ca9a37` |
| `supabase/migrations/20260804190000_svk_geodata_and_billing_price_area_canonicalization.sql` | `cfee635bdbc74b82c60017db34d4cf30f7f8a318e2c5e99001822c8cf8e6afc2` |
| `supabase/migrations/20260805085617_api_contract_billing_tenant_hardening.sql` | `b17abd19803511156eb21902e9d57b4ca8219fef303c9238e33a03a69ff140b7` |
| `supabase/migrations/20260724120000_canonical_market_resolution_quote_billing_flow.sql` | `bc2a4685be28c810dfb55abfee93575ae6e71e4167bad717bd3b6eb5e5cb97b6` |
| `supabase/migrations/20260727010000_contract_flow_integrity_completion.sql` | `392d9e90c4fcec6752644fb75721ed7a113c3dcd2cb68d3185e3bfd44a065c4f` |
