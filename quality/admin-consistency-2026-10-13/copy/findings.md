# Admin copy and queue audit — 2026-10-13

Read-only source audit at `51f5fa5e80c42350d697bfed42520672749d4467`. No production source changes or database mutations. All function inputs in `function-proofs.json` are synthetic. The coordinating audit reports that the live queue tables are empty: the filtering findings below are reproducible code defects for future records, not existing production residue.

## Skill routing and limits

- Applied local `code-review` / `find-bugs` to rendered text and the actual producer → loader → label → JSX path; `variant-analysis` to raw or merely underscore-expanded backend values; `fp-check` principles to reject candidates after producer/guard checks; `web-design-guidelines` to the operator-facing terminology distinction. Local skill instructions and `.agent-memory/customer-ui-checkpoint.md` were read. Fresh remote Web Interface Guidelines were not independently fetched by this delegate; no general accessibility conformance is claimed.
- Parallel read-only delegation comes from the parent's bounded assignment and the repository's `dispatching-parallel-agents` workflow. No further agents were spawned.
- Skipped code changes, TDD/remediation, PR delivery, dependency/security scanners, performance campaigns, database changes, and Ediel masterplan approvals: objectively absent from this bounded copy audit. Parent owns live SQL verification and the portfolio audit.
- This is not a complete security review. Page gates and read scopes were inspected to distinguish tenant-facing content from intentionally technical platform pages; no tenant certification is claimed.

## Confirmed findings

### COPY-01 — Required review events/jobs disappear from the work queue

Priority P2 / medium operational impact; high confidence; code-only reproduction.

`app/admin/work-queue/page.tsx:51` and `:58` define the action-status allowlist without `needs_review`. `:151` deliberately loads jobs in `needs_review` or `failed`; `:123` loads events with `action_required=true`. Event rows retain their status at `:354`, and job rows retain it at `:375`. `:183` then filters every item through `requiresAction` at `:99`. A sole `needs_review` item therefore disappears, while the otherwise identical `failed` item remains.

This is normal producer behavior: `lib/customer-operations/supplierSwitchOrchestration.ts:739` / `:741` and `:765` / `:767` emit `needs_review` plus `actionRequired=true` for blocked switches. `lib/customers/customerOperationEvents.ts:89` / `:90` preserve that status and action flag, then insert them at `:131` / `:133`. Neither the database view nor the loader converts the event/job status into a permitted action status. A stalled switch can be shown under Händelser as requiring action but be absent from Arbetskö, whose subtitle promises exactly those actions.

Variant: `blocked_missing_poa`, `blocked_missing_grid_owner_contact`, and `blocked_missing_manual_mailbox` are explicitly queried at `app/admin/work-queue/page.tsx:425`, but absent from the same allowlist. Where the row has no dispatch correlation that changes it to `failed`/`waiting_response`, these statuses remain at `:542` and are also filtered out. They are genuine persisted blockers from `lib/customer-operations/requestMissingFacilityInformationCore.ts:701`, `:715`, and `:738`.

Proof: `function-proofs.json` records `visibleAfterConsolidation=0` for all four missing states, versus `1` for `failed`, by executing the actual current `requiresAction` and `consolidateActionItems` functions.

Targeted fix: honor an event's explicit action-required flag or include the supported review/blocker states in one domain-aware action classifier. Keep legitimate in-progress/waiting states excluded. Verification should render the real page with a sole needs-review event, a sole needs-review job, and each persisted manual blocker; assert the row and its correct customer link appear. Also assert a waiting-only item stays in Händelser.

### COPY-02 — Website application summaries expose source tables and implementation language

Priority P3 / low UX impact; high confidence; deterministic render path.

`app/admin/website-applications/page.tsx:1081` renders `item.integration_api_clients?.name ?? item.source_table` beside the already translated source badge. `lib/admin/websiteIntegrationOps.ts:191` always sets canonical rows' source table to `website_customer_applications`; `:277` sets fallback rows to `external_contract_intakes`, and `:357` sets their integration client to null. Every fallback row therefore renders the literal table name in the ordinary summary. Canonical rows without a client name do too. This line is not platform-admin gated.

The expanded tenant view repeats implementation language: `:391` / `:392` explain `external_contract_intakes`, “teknisk fallback”, and server “actions”; `:521` / `:529` show “Resolver-status” with a `grid_area_master_validated` placeholder; `:782` says “speglad external-intake finns”; `:928` prints raw JSON under “Ansökningsdetaljer”. Source and mirror wording at `:213` and `:1099` uses “Extern intake” / “External”. These are additional manifestations of the same absent separation between operator explanation and implementation diagnostics.

Targeted fix: use human source descriptions consistently, suppress absent integration-client metadata, and use ordinary language for the read-only fallback. Put raw table names, mirror IDs, editable internal status codes, and raw JSON in explicit technical details gated to the platform role. Preserve the read-only guard for external rows and the query/source identifier used by actions.

Verification: render canonical/no-client and external/null-client fixtures for a tenant operator; assert visible text contains neither table name nor raw resolver placeholder while source labels and detail links remain correct. Separately assert the platform technical disclosure still exposes diagnostic identifiers when requested.

### COPY-03 — Real website status and resolver values have no Swedish labels

Priority P3 / low UX impact; high confidence; actual-function reproduction.

`lib/customers/statusLabels.ts:81` falls back to `humanizeTechnicalValue`, which only removes underscores and capitalizes. Four supported controlled statuses lack cases: `facility_data_invalid`, `customer_information_mismatch`, `needs_customer_correction`, and `needs_grid_owner_followup`. They are real domain values in `lib/website/applicationReview.ts:23` through `:30`, included in this page's controlled-status set, and render through the badge at `app/admin/website-applications/page.tsx:1085`. Actual outputs include “Facility data invalid” and “Needs customer correction”, despite the same page already carrying Swedish corrective instructions.

The “Matchning” panel at `app/admin/website-applications/page.tsx:832` passes `resolutionStatus` into `gridOwnerVerificationLabel`. That helper maps a different domain (`verified`, `suggested`, `conflict`, etc.) and lacks canonical resolver values (`postal_suggested`, `grid_area_master_validated`, `facility_verified`, `needs_review`); its fallback at `lib/customers/statusLabels.ts:123` prints “Postal suggested”, “Grid area master validated”, “Facility verified”, “Needs review”. The resolver persists these statuses, e.g. `lib/energy/resolver.ts:325` and `:1108`. The detail page repeats this mismatch at `app/admin/website-applications/[id]/page.tsx:508`.

Proof: `function-proofs.json` executes both current helpers with all eight real supported values and retains the English results.

Targeted fix: add the missing controlled-status labels; provide a dedicated typed resolution-status label function and use it in list/detail views. Do not call a grid-owner verification mapper for an energy-resolution status. Verification should enumerate each domain's supported union and assert meaningful Swedish display text rather than generic humanization.

### COPY-04 — Work queue's local mapper prints supported action statuses verbatim

Priority P3 / low UX impact; high confidence; actual-function reproduction.

`app/admin/work-queue/page.tsx:219` returns the raw code for any key outside its short local map. Six statuses explicitly admitted as actionable at `:58` through `:63` are absent from that map: `negative_aperak`, `missing_binding_info`, `missing_termination_info`, `ready_for_switch`, `process_decision_missing`, `process_response_received`. The raw result renders at `:671`. These are not hypothetical unknown codes; the page explicitly queries them or produces them through `infoRequestProcessQueueState` at `:491` / `:500`.

Proof: `function-proofs.json` executes the current label helper and classifier: all six have `actionRequired=true` and `label===status`. The shared `lib/ui/format.ts` already maps them to Swedish, while this page only uses that helper for priority.

Targeted fix: remove the divergent local status map or make the queue display map exhaustive for supported queue states. For operator text prefer a business description (“Nätägaren avvisade uppgifterna”, “Bindningstid saknas”) over protocol names. Verification should render one row of each supported action status and assert its Swedish label.

### COPY-05 — Same raw-enum display appears in Driftöversikt and billing underlays

Priority P3 / low UX impact; high confidence; source-verified render path, not claimed current live records.

`app/admin/controltower/page.tsx:150` and `:153` print the stored `priority` and `status` directly with defaults `normal` and `open`. The page itself queries `in_progress`, `pending_review`, `action_required`, `awaiting_external_response`, `billing_blocked`, and `manual_follow_up` at `:97` / `:98`. Thus a normal supported case/task prints backend English codes in its status badge. It also prints `reason_category` directly at `:150`. The page is available through `operations.control_tower`, not a platform-only technical gate.

`app/admin/billing/underlays/page.tsx:47` prints `fmt(row.status) / fmt(row.readiness_status)`. `lib/pricing/adminData.ts:30` defines `fmt` as `String(value)` for strings: color classes do not translate the label. The same behavior repeats for the underlay, item and pricing-run badges at `app/admin/billing/underlays/[id]/page.tsx:59`, `:69`, and `:78`. Normal underlays can display `validated / ready`, `draft / blocked`, or similar internal values.

Targeted fix: use domain-aware Swedish display labels for case status/reason, priority, underlay readiness and pricing-run status. Shared formatting can cover common statuses, but missing domain states need explicit labels rather than a prettified English fallback. Keep backend values unchanged. Verification should render a supported case/task and underlay/pricing-run fixture and check the visible status text.

## Rejected candidates / informative observations

| Candidate | Verdict and evidence |
| --- | --- |
| Intake preview joins missing/uncertain fields directly | False positive: producer `app/admin/customers/actions.part-4.ts:369` through `:425` already returns Swedish labels such as `förnamn`, `personnummer`, `nätägare`, and `förväntat startdatum`. No raw field-name display was established. |
| Intake preview's status fallback | False positive for current valid inputs: `components/admin/customers/CustomerBulkImportPanel.tsx:51` maps all current preview statuses. |
| Events status fallback merely removes underscores | False positive for the current domain: all ten `CustomerOperationTimelineStatus` values have explicit Swedish labels in `app/admin/events/page.tsx:48`. All ten were executed in `function-proofs.json`. |
| Events shows source/event/job codes and raw payload | Intentional technical disclosure: `app/admin/events/page.tsx:190` gates it with `isPlatformAdmin`. Not ordinary tenant copy. |
| Facility request status and priority badges | Current selected statuses are mapped in Swedish at `app/admin/facility-requests/page.tsx:59`; domain queue statuses and missing fields are mapped in `lib/facility/workQueue.ts:177` / `:189`. Priority uses the shared Swedish helper at page `:259`. |
| Network-owner registry raw statuses | Informative, not tenant leak: `app/admin/network-owners/page.tsx:112` requires platform-admin access and the page explicitly describes itself as central technical administration. |
| API/Ediel/PRODAT, SE1–SE4, anläggnings-ID | Domain terms can be appropriate; their presence alone is not proof of a defective display label. |

Intake still has limited ordinary terminology roughness (“preflight” in `CustomerIntakeForm.tsx:827`, `ore_per_kwh` in the fee-entry placeholder at `:1140`, “Fallback-avtal” in the bulk panel), and facility copy says “Resolver-förslag” / “Facility-arbetskö” at page `:357` / `:378`. These are static copy improvements, lower priority than the verified value-mapping defects and not counted as additional findings.

## Read inventory and ownership scope

No database query was executed by this delegate. This is the inventory of read paths in the reviewed code, for the parent's live audit.

| Page | Data read by code | Gate and company scope |
| --- | --- | --- |
| Customers/intake | `gridex_verified_grid_owners_v` (`grid_owners` fallback); `electricity_suppliers`; `price_areas`; `canonical_internal_contract_offers_v`; go-live summary loader | `customers.write` or `masterdata.read`; operational company; suppliers scoped to shared/current company and offers scoped to current company; underlying go-live inventory belongs to parent. |
| Website applications | `website_customer_applications`, `external_contract_intakes`, joined `companies`, `customers`, `integration_api_clients` | Admin page permission gate plus `resolveAdminTenantReadScope`; service-role reads explicitly filter tenant company, platform sees all. |
| Work queue | RPC `gridex_get_work_queue` / view `gridex_work_queue_v`; `customers`, `customer_operation_events`, `customer_operation_jobs`, `customer_blockers`, `customer_info_requests`, `grid_owner_data_requests`, `grid_owner_information_requests`, `customer_operation_tasks`, `supplier_switch_requests`; Ediel process-decision loader | `operations.tasks`; session client/RLS; company filter for tenant; referenced active-customer IDs constrain related queue reads. |
| Events | RPC `gridex_list_customer_operation_events`; underlying `customer_operation_events` joins `customers`, `customer_sites`, `metering_points`, `grid_owners`, `customer_operation_jobs` | `operations.tasks`; requires operational company; RPC takes that company; technical panel platform-only. |
| Facility requests | RPC/view `gridex_get_facility_work_queue` / `gridex_facility_work_queue_v`; `grid_owner_information_requests`, joined `customers` and `customer_sites`, bulk `grid_owners`; fallback queue reads `customer_sites`, `customers`, `metering_points`, `customer_info_requests`, `grid_owner_data_requests`, `powers_of_attorney`, `customer_documents`, `grid_owners` | `operations.tasks`; session client/RLS plus tenant company filter; related IDs constrain fallback reads. |
| Driftöversikt | `customer_operation_tasks`, `customer_cases`, `supplier_switch_requests`, `outbound_requests`, `gridex_batch_2c_drift_queue_v`, `billing_underlays` | `operations.control_tower`; resolved tenant scope; service queries explicitly filter tenant company. |
| Billing underlays/detail | `billing_underlays`, `billing_underlay_items`, `pricing_runs`, `pricing_preview_lines` | `billing.workspace`; company scope passed to service-role `safeListRows`. This audit did not certify all absent-company authorization behavior. |

## Verification record / repair packets

- Full text was read for the five assigned page files, intake form/bulk panel, customer status helpers, events timeline loader, facility queue loader, shared UI formatter, Driftöversikt page, billing underlay list/detail, and pricing formatter. Referenced larger producer modules were read at the exact relevant functions/paths rather than claimed fully audited. The broad `rg` sweep supplied candidates; candidates were not counted as defects solely from search output.
- `git status --short` / `git diff --stat`: baseline production source tree clean; this delegate only created files under this `copy/` evidence directory. Parent audit files share the untracked top-level audit directory.
- First attempted Node proof using `require('typescript')`: exit 1, module unavailable; no output file or mutation. Repeated with Node v24's `node:module.stripTypeScriptTypes`: exit 0; actual current functions executed with synthetic fixtures and results saved in `function-proofs.json`. This is function behavior proof, not an authenticated browser journey.
- No build/typecheck or release claims; no app source changed. No live counts were collected here; parent owns the empty-live-queue observation and aggregate database evidence.
- Small repair packets: (1) queue action classification plus real-page row regression; (2) typed domain labels and list/detail use; (3) application operator/technical copy separation; (4) Driftöversikt and billing display mapping. Preserve database values, permissions, query scope and action identifiers.
