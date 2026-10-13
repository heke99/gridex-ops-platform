# Canonical application loader review and handed-off fixes

Root requested an independent read-only review after portfolio implementation.
The review found two detail-path manifestations not covered by list transport
tests: ambiguous shared keys attached unrelated mirror links, and mirrors older
than the newest20 intakes disappeared from details. Both were reproduced against
real loader code with temporary tests. Root then explicitly handed off
`lib/admin/websiteIntegrationOps.ts` for remediation; this agent is a coauthor
of the final loader and does not claim an independent final review of it.

Detail now hydrates the same shared work-item identity as the list, including its
explicit mirror ID and authoritative status/work-state/pending metadata. No
shared-view metadata columns or SQL migration were required. Missing/foreign
mirror identity fails visibly without fabricating a merge. Legacy direct mirror
URLs retain their readable source row and show a warning when no canonical owner
can be established.

Actual writer traces established polymorphic legacy columns:

| Legacy column | Actual targets and writer proof |
|---|---|
| created_info_request_id | Website mirror: grid_owner_information_requests (`customerApplicationPersistence.ts:188`); hosted form: customer_info_requests (`external-contracts/intake.ts:534`, onboarding SQL:843-854) |
| created_case_id | Successful hosted onboarding: customer_operation_tasks (`intake.ts:533`, onboarding SQL:857-873); ambiguous match: customer_match_review_cases (`intake.ts:490-503`) |

The central DTO resolves a unique company-owned target in batched reads and
exposes `customer_info_request_id`, `customer_match_review_case_id`,
`customer_operation_task_id`, or the existing `grid_owner_information_request_id`.
Absent, foreign or table-ambiguous references stay null with
`reference_resolution_issues`. Root's explicit policy preserves centralized
completed/closed states for optional historical-link warnings; pending rows
receive manual-review guidance. Agent1 owns the matching detail-page cards and
its company-filtered target reads.

Only four true aliases qualify for tenant composite FKs: created_customer_id to
customers, created_site_id to customer_sites, created_metering_point_id to
metering_points, created_contract_id to customer_contracts. All four
`*_company_id_id_uidx` unique indexes exist in the schema snapshot and root
confirmed them live. Root owns the forward FK migration and targeted-column
SET NULL behavior; no blind single-table FK was proposed for info/case aliases.

Verification: new detail test RED5 failures/1 pass before loader edits, then
GREEN; final detail/list/SQL/page suite32/32 passed across four files. Loader and
new tests ESLint exit0; diff check exit0. Logs retained in `/tmp/gridex-detail-*`.
The approved portfolio migration hash remains
`a51b29452212140d191064bd970572c1503ca0ef5a1e67ab7f40e831dc72b0e4`.
No live database mutation, shared memory edit or approved portfolio source
rework occurred during this handoff.
