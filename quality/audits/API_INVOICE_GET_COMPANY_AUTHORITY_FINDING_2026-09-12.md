# Task 10b2: two remaining GET company-authority variants

Date: 2026-09-12. Base: `4d4fe075198ad61b9df85aa456e40965668549dc`.
Disposition: **CONFIRMED**, both routes, for the bounded application authorization finding. Both accept a permission decision for A while operating on B, through no-cookie fallback **and through explicit companyId/company_id B under an A cookie**. Export GET discloses B invoice-export records. Provider-status GET reads B integration configuration, reaches B provider-request boundaries, updates B local invoice status metadata, and returns B provider payloads. High for the combined financial-data/provider-operation authority defect; the pure export-read variant is Medium standalone. No native database, provider or production exploitation is claimed.

## Scope, continuity and process

This is the explicit two-route follow-up to `task-10b2-company-authority-probe.md`, which remains byte-for-byte unchanged. Only these new report/proof files were written. No production, permanent-test, SQL, memory, plan, Git or Task 10b1 files were changed, and no subagents were used. Continued the already-read AGENTS/auth/security memory and `fp-check`, `variant-analysis`, `verification-before-completion` workflow. The scope is point78 permission-variant preparation, not a new implementation task or a whole-system audit.

Claim and trust boundary: an ordinary authenticated actor may use A's billing.read to select B via a separate membership helper. Membership establishes a relationship with B but not B's billing.read. Both routes invoke `requireAdminApiAccess(['billing.read'])`; `lib/admin/apiGuards.ts:82–164` computes and retains canonical company and company-scoped permissions. Neither GET binds subsequent company selection to that returned company.

## Reachable fixture and entry paths

The proof derives the canonical RPC I/O from the same valid fixture as the frozen report: active confirmed nonplatform identity; two active nonowner member memberships and active company-bound custom-role assignments; both companies active; A older than B; A grants **only billing.read** and B grants customers.read, with no B billing.read or billing.write. There are no platform/global roles or role overrides. The canonical fixture models active role assignments explicitly. Identifiers A/B/actor/run/item are application-only placeholders, not native UUID SQL fixtures.

No-cookie: canonical SQL selects oldest nonowner membership A, while the actual unordered operational service query returns B-first. Source derivation is `20260810193450_canonical_access_provisioning_runtime_v1.sql:537–578,622–660`, renamed at `20260810224500_canonical_review_remediation_v1.sql:291–294` and called by the latest wrapper `20260902091000_company_scoped_permission_engine.sql:28–41`. SQL is read, not executed. Attacker control is an authenticated request without the cookie; B-first physical order is a lawful precondition, not claimed attacker control over the database.

Explicit-company path: with cookie A, query `?companyId=B` or `?company_id=B` invokes the actual `assertUserCanOperateCompany(actor,B)`. `scope.ts:196–253` normalizes B, resolves nonplatform role status through service `gridex_get_user_roles`, finds active B membership, and checks writable company lifecycle. It **does not** compare B with `guard.companyId` or check billing.read for B. This path does not depend on unordered results at all. Both directions and both query aliases are exercised without a contradictory canonical response.

The no-cookie path uses actual `scope.ts:105–139,145–193`: unordered active membership lookup, cookie if present, else owner-or-first. The source-only loader executes complete actual guard/access/role/lifecycle/scope modules and both route bodies. Auth/RPC/DB/cookies, environment and fetch are injected terminal I/O; React cache and NextResponse/error formatting are harness boundaries. Canonical decisions are derived from fixture membership/assignment data rather than arbitrarily forced across companies.

## Actual receiver and effect evidence

| Route | Source chain | Observed boundary/result with canonical A and selected B |
|---|---|---|
| `app/api/internal/invoice-exports/[id]/route.ts GET` | 12–21: billing.read guard, requested company or operational fallback, `getInvoiceExportRun` | HTTP 200 includes B run summary and B item request payload. |
| `lib/integrations/billing/invoiceExportCore.ts getInvoiceExportRun` | 904–913: parallel `invoice_export_runs SELECT *` by company/id and `invoice_export_items SELECT *` by company/export_run_id | Both real query builders carry B. No provider request, RPC, service write, event or worker is invoked by this receiver. |
| `app/api/internal/invoices/[id]/provider-status/route.ts GET` | 19–32: billing.read guard, company selection, `invoice_export_items SELECT *`, provider GUID guard, actual client factory | B item is selected by B/id; B's stored environment controls test versus production configuration. |
| Actual Capway config and client | `capway/client.ts:301–307`; `capway/auth.ts:54–160`; `client.ts:43–112` | Service query selects B/`capway_aptic`/item environment/ready-or-active configuration. Synthetic env references provide credentials only in the harness. Real header building, URL construction, timeout setup, response parsing and error mapping execute against fake fetch. |
| Four provider invoice reads | Provider route:33–38; client:221–246,259–263 | Four fake-fetch boundaries, all GET: `/v1/Invoices/guid-B`, `/FinancialDetails`, `/Purchase`, `/Recourse` appended to the invoice path. They use the B-configured provider origin/credentials. |
| Status normalization and local write | Provider route:39–48; actual `statusMapper.ts:11–38` | Actual normalizers map invoice status 1 to `paid` and financeStatus 2 to `purchased_without_recourse`. Service UPDATE on B/item-B sets only `provider_status`, `purchase_status`, `status_payload`, `updated_at`. |
| Returned provider data | Provider route:14–16,50 | HTTP 200 returns all four fulfilled/rejected result envelopes, including the synthetic B private-provider marker when fulfilled. |

**Provider-status GET is not read-only.** It initiates provider reads and persists local provider-status data. The fixture actor has no billing.write anywhere, because this existing route contract requires billing.read; this report adjudicates cross-company reuse of that permission, not a separate decision to change same-company read permissions.

The provider read calls do **not** call createInvoices, postPurchase, dispute or deprecate. An OAuth connection can additionally execute the token-endpoint POST in `auth.ts:166–242` when no valid token is cached. The actual uncached OAuth fixture reaches four synthetic token POSTs followed by four invoice GETs because all four reads start concurrently; this characterizes the observed source path, not a production request-count guarantee or a separate token-cache finding. API-key mode makes only the four invoice GET calls. No real token, environment secret, provider endpoint or network request was accessed.

Even when all four fake provider reads reject, `Promise.allSettled` completes, actual status normalization yields `unknown`, and the route still issues the B local UPDATE containing rejected result envelopes and returns HTTP 200. This demonstrates that provider success is not a prerequisite for the wrong-company local write boundary. It is not a claim that a native write committed or that provider invoice state was changed.

## Receiver actor checks and SQL defenses

The export reader has no actor parameter or permission check; the provider config resolver similarly accepts company/environment and does not authorize the requesting user. `lib/supabase/service.ts:1–12` constructs the service-key client, so these calls do not carry the actor's authenticated Supabase session. Actual source tables define customer/financial references, provider identifiers, amounts, request/response/error/status payloads; the export reader returns `SELECT *` without a narrower DTO (`20260609100000_batch_1_2_5_3_capway_invoice_foundation.sql:57–120`). No invoice PII from real data was read in this task.

The same foundation migration `230–247` enables RLS and grants service-role all-operation policies for provider connections, export runs and export items. These policies do not re-evaluate the route actor's B billing.read. No native catalog was queried or replayed. SQL and trigger review distinguishes tenant consistency from actor authority:

- `20260702150000_gridex_sent_invoice_protection.sql:8–67,70–76` protects sent/credited items against delete, resend reset, changes to financial fields/request payload/customer/pricing/underlay identity and rewritten provider invoice GUID. The provider-status update changes none of those fields, retains status `sent`, and is therefore not rejected by the reviewed body. This is source characterization, not a native trigger test.
- `20260820113132_invoice_export_locked_pricing_guard.sql:5–39` checks locked same-company pricing only on INSERT or UPDATE OF company_id/pricing_run_id. Neither column is updated by provider-status.
- `20260727010000_contract_flow_integrity_completion.sql:287–353,395–401` enforces the same-customer/contract chain when INSERT or specified ownership/chain columns are updated. Status/purchase/payload refresh does not target those columns, and the function is not an actor permission assertion.
- `20260826213000_invoice_review_projection_sync.sql:8–67` updates a billing-underlay projection from changes to **customer_invoices**, not from this invoice_export_items status refresh. This particular trigger is not evidence that this route issues an invoice or updates the whole customer-invoice graph.

No custom mutation RPC, billing dispatch, purchase submission, provider financial mutation, domain event or worker-processing function is directly called by these two actual receivers. The named SQL protections do not repair the missing company-permission binding. Whole live-trigger composition, native policy enforcement and downstream database commit remain unverified.

## Controls and dispositions

| Scenario | Cases | Result |
|---|---:|---|
| No cookie, A canonical/granted and B-first operational membership I/O | 2 | Both 200 with B effects described above |
| Explicit B/cookie A (companyId and company_id aliases) | 4 | Both 200; explicit foreign target is confirmed |
| Same A plus explicit-same A | 4 | 200; A only |
| Reverse no-cookie B→A and explicit A/cookie B | 4 | 200; A effects from B permission |
| Cookie A with B-first, no requested company | 2 | 200; A only |
| Explicit cookie B without billing.read; canonical A without billing.read | 4 | 403 before operational service lookup, provider request or write |
| Cookie A, B record ID, no requested company | 2 | 500/not found under A filter; no returned B data/provider/write |
| Explicit B with no B membership | 2 | 500 before domain reads/provider/write |
| Explicit B with paused B company | 2 | 500 before domain reads/provider/write |
| Missing provider invoice GUID | 1 | 400 before config/provider/write |
| No usable connection row and no global fallback configuration | 1 | 500 before provider/write; missing row alone is not claimed to deny if defaults exist |
| All four provider reads reject | 1 | 200; one B UPDATE with unknown/rejected payload |
| Uncached OAuth mode | 1 | 200; four synthetic token POST + four invoice GET boundaries + one B UPDATE |
| Test environment in B export item | 1 | 200; test config selected + four fake GET boundaries + one B UPDATE |
| **Total** | **31** | **31/31 PASS** |

Refuted claims: arbitrary nonmember-company access through the explicit path; absent permission requirement; foreign ID alone defeating a correctly selected A query; bypass of the explicit-company paused lifecycle guard; missing GUID/configuration always reaching provider; provider invoice creation/purchase/credit/dispute submissions; pure read-only semantics for provider-status GET. The last is refuted by an actual local write. Both memberships in the main exploit fixture are legitimate; operation-specific B permission is what is missing.

Other cases not adjudicated: authoritative platform behavior; unrelated lifecycle/default-selection variants; optional empty/whitespace query semantics; CSRF/transport behavior; full schema/trigger catalog; production tenant data and deployment binding. The original five-plus-two report is untouched and its spot-route disposition is unchanged.

## Verification, limitation and bounded fix recommendation

Exact executable command from repository root:

```sh
node .superpowers/sdd/2026-09-12-current-and-plan77-85/task-10b2-read-company-variant-probe.mjs
```

Node v24.19.0, exit 0, **31/31 PASS**; experimental stripTypeScriptTypes warning only. Loader transform mode supports the actual Capway constructor's TypeScript parameter property. The proof exposes only fake fetch and a synthetic process.env to the actual auth/client modules; it cannot invoke the real provider/network via an injected SDK. Four endpoint path/method/company checks, query scopes, returned private markers, local update fields and all negative-control effect counts are asserted. Fake HTTP success is not native provider acceptance; fake DB success is not SQL execution. The proof output contains synthetic IDs and source hashes, no credentials.

Fresh source binding: 21 traced/probed files below all byte-identical to `git show 4d4fe075198ad61b9df85aa456e40965668549dc:<path>`. Original report hash remains `7638b200a08274a3d98b63b19461bb9608e6924ab24869b7b2d5b4186f603780`; original proof remains `51ee01da8dfb67616c647c6657d0c6d54a304db446ce000afc0ae459fc1c1d41`. No production or Git mutation occurred.

False-positive gate conclusion: actual source proves externally selectable company inputs/defaults cross the permission boundary, protected same-company/cookie/membership cases work, and meaningful B data plus service-update/provider-request boundaries are observed. SQL protections examined do not apply actor permission checks to these effects. Thus the application variants are confirmed; **native DB commit, provider processing and production reachability remain UNVERIFIED**. No arithmetic, memory-safety or concurrency exploit is asserted.

In a separately authorized, independently reviewed patch, bind these two routes' explicit/default company resolution to the canonical guard, reject ordinary A→B requests before domain/config reads or provider work, and fail closed on missing canonical company. The existing `assertAdminApiCompanyAccess(access.guard,requestedCompanyId)` is the obvious write/operational binding primitive and already uses the authoritative platform flag; preserve intended read lifecycle semantics deliberately for the pure export reader. Provider-status must be treated as a local mutation/provider interaction when reviewing lifecycle behavior, despite its GET verb. Do not change its same-company permission requirement or redesign HTTP semantics merely as part of this authority fix without a separately scoped decision. No SQL or other provider endpoint change is required to make the immediate route authority binding concrete. Add no-cookie, explicit-company and reverse route regressions plus retained positive/data guards before release. Task 10b1 remains separate.

## Exact SHA-256 source manifest

Proof SHA-256: `38082e5bc4eac674dc7eb93b7fc7b317c6f471f2509c82cbdd858dbddf42e916`.

| Source | SHA-256 |
|---|---|
| `lib/tenant/lifecycle.ts` | `36184609a4a80f904c11f83f9d2cbdfed4c17d0be5e03294ed2d9ba43ad14602` |
| `lib/rbac/roleKeys.ts` | `d16005d099f972f0ef9cb2ddc5df7b20d63866ff55788b800e0edff2d572edea` |
| `lib/admin/accessModel.ts` | `b2f79ed4917b2239942d3fd9ff92b2f6115a9632d833290c4a8482f0335428f4` |
| `lib/admin/navigationPreferences.ts` | `4e0f037208cdd7a9e2c296f5bce3d8235427f8839ce2fd6eb05bba7e6c296a23` |
| `lib/tenant/scope.ts` | `954a1951457b2140a4cd4b8e0531fd2f626fa6bd0ed2e2b6af384e6ccdf6aa96` |
| `lib/admin/apiGuards.ts` | `e504dc9e3c243c3f66beba46881521bbb11d0aad874b99d0de15b763b59d952b` |
| `lib/integrations/billing/capway/auth.ts` | `c8ad9c4d34d97e59555ee9e5c2171f08dd7f07f3899f26ad1f2342880c26b522` |
| `lib/integrations/billing/capway/client.ts` | `38058b735eb2e796420171c88c955aea14027760fe2ffe9472a20b586a69ecec` |
| `lib/integrations/billing/capway/statusMapper.ts` | `b7b5f66f1a24c2529fc3e2ff92866158122c8e265ef9c9085fd838b931d31941` |
| `lib/integrations/billing/invoiceExportCore.ts` | `f67d108276fd9c3b630867f2e6f8f678336a0583531943d9a22462f50e2db298` |
| `app/api/internal/invoice-exports/[id]/route.ts` | `5bc03ade78b5eaa55114fa13fc9e199167bd8ee60a2e98e4b54977e60c45887a` |
| `app/api/internal/invoices/[id]/provider-status/route.ts` | `790722be9cfb7371bd4bf275b3050b9a75fb61501ed1aa6ae8a09d0923981b1b` |
| `lib/supabase/service.ts` | `0dcb62b49c731a2bb51cf088a922e8d731b6a21137222993da544faa3ee3cf1c` |
| `supabase/migrations/20260810193450_canonical_access_provisioning_runtime_v1.sql` | `390b0223a8fbafb633795f1ad0116d6cf8ebbddea056226be84711e7d878a4b8` |
| `supabase/migrations/20260810224500_canonical_review_remediation_v1.sql` | `12fb80b8c13f7e105e4c5b63a6145e863872874fd4a2caaea9f669df5a80010d` |
| `supabase/migrations/20260902091000_company_scoped_permission_engine.sql` | `dc72cc26cbb53ab814fcf214dc9324f27bfac9f4bf77940b9e9a0527428f359a` |
| `supabase/migrations/20260609100000_batch_1_2_5_3_capway_invoice_foundation.sql` | `93a8c9038795d2a2b683001f28e6e96b7d533e7e5d2d8ba946010207df2d26ce` |
| `supabase/migrations/20260702150000_gridex_sent_invoice_protection.sql` | `eefacfdb720756182304e85a98b9f22212cb86ea488b1b2b2453a6b01e04202d` |
| `supabase/migrations/20260820113132_invoice_export_locked_pricing_guard.sql` | `db0235f01516a707ff055dacf42b3709ff7e083f25112a23f01bbbbf74e741c9` |
| `supabase/migrations/20260727010000_contract_flow_integrity_completion.sql` | `392d9e90c4fcec6752644fb75721ed7a113c3dcd2cb68d3185e3bfd44a065c4f` |
| `supabase/migrations/20260826213000_invoice_review_projection_sync.sql` | `29a55288a96865d5349d7a82de47d5a898f05dd1ab8851a2a7fcd5de6ad88e0d` |
