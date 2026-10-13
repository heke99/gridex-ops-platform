# Portfolio remediation — 2026-10-13

User authorized remediation after the read-only audit. This agent changed only
its assigned portfolio source, a CLI-created forward migration, tests and this
evidence directory. Old migrations, schema snapshots, generated types, Ediel
implementation and shared memory were preserved. Live apply/cleanup and broader
verification belong to the parent agent; no live database mutations were made
by this agent.

Migration: `supabase/migrations/20261013094448_customer_portfolio_consistency_repair.sql`,
created/reserved by root through Supabase CLI v2.75.0 before content was written.

All six findings have source fixes:

| Finding | Change | Behavioral proof |
|---|---|---|
| Expiry TIMESTAMPTZ crash | Normalize expiry to UTC DATE for returned value, day arithmetic and date window; set UTC timezone for DATE/TIMESTAMPTZ compatibility | Real migration executes over live-shaped TIMESTAMPTZ schema; empty and nonempty expiry; non-UTC session; null/outside-window expiry |
| Selected company ignored | Page and CSV use authorized canonical `guard.companyId` | Render/CSV choose B despite owner membership A; null canonical scope does not substitute A |
| Cohort count ×4 | Count distinct customer membership; legacy RPC wraps the dated implementation | One customer with multiple supply periods reports one, with retained percentage intact |
| Different forecast calendars | Shared explicit anchor: UTC today for current month, first day for historical/future month; same anchor for overview/detail/export/zones/cohorts; UI says selected month and shows as-of date | September outcome/forecast/CSV agree; October anchor October 13; dated cohort rates use requested historical date |
| Unrelated request scopes | Apply meter-values/billing-underlay predicate to total and failures, matching historical/ongoing partition | Mixed tenant/scopes: total=2, historical=1, ongoing=1, failed=1 |
| Mid-month starts omitted | Preserve eligibility date through forecast layers and use exclusive supply ends; recompute current forecasts while preserving historical cache | October 5 start included October 13, excluded October 4; October 13 end excluded; November 1 end excludes November; current snapshot remains unchanged; historical forecast777 preserved; overview matches current forecast100 |

Only additive public RPC:
`gridex_customer_portfolio_cohorts_at(p_company_id uuid, p_as_of date, p_months integer default 12)`.
Returns the existing cohort columns. Root must include it in the generated types
and schema snapshot. Legacy two-argument cohorts RPC and all other signatures
remain available. Per-RPC tenant assertions and existing authenticated/service
read grants remain; PUBLIC/anon have no access to the new RPC, and internal
computation stays inaccessible to authenticated clients.

TDD RED before production edits: 14 failures/1 pass across the three new files,
including native SQLSTATE42846, count4 vs1, request count3 vs2, forecast points0 vs1,
stale current cache, wrong calendar and wrong selected-company behavior.

Verification:

- Four targeted files (`customer-portfolio-{calendar,page-scope,consistency-sql}.test.ts`
  and existing `customer-portfolio.test.ts`): 36/36 passed, exit0.
- Updated production-shaped SQL file after extra calendar/supply boundaries:
  9/9 passed, exit0. Real old migrations plus forward SQL run in PGlite.
- Assigned source/test ESLint: exit0, no warnings/errors.
- `git diff --check`: exit0.
- Read installed Next16 page/route documentation and local systematic-debugging,
  TDD, Supabase/Postgres, React review and verification skills.

Logs: `remediation-tests.log`, `remediation-sql-tests.log`, `remediation-eslint.log`.
Broad application/test typechecks, migration inventory/checksums, generated-type
capture, authenticated browser checks and live verification are parent-owned.
