# Current task

Updated: 2026-09-04

Status: `IN_PROGRESS` — new master plan, Steg 1–2 done, Steg 3 awaiting authorisation.

## Steg 1 — production database identity (DONE, with one stated gap)

The earlier claim that "no production Supabase project is visible" was wrong,
and the new plan is right to reject it. The database `app.gridex.se` actually
uses IS the production database whatever it is named.

Established chain:

    app.gridex.se
      -> Vercel team Div3rsa (team_e3htkJPyBNSw3Ix1KQLlf180)
      -> project gridex-ops-platform (prj_xA3EDI1xztkkyx21e3LY4UhgYrWt)
      -> production deployment dpl_VDfQotLdmE7wwhfjqELbuGDKMqAG (READY, target=production)
      -> commit a1dba4146ab50d3804c1875d94533f7ff08171f9

`a1dba41` is the merge of PR #307, i.e. the current tip of `main`.
**Main SHA = deployed SHA is therefore satisfied.**

Database identity:

    project  gridex-ops-dev
    ref      piidsfebjqjmnepdpnas
    host     db.piidsfebjqjmnepdpnas.supabase.co
    region   eu-north-1
    engine   PostgreSQL 17.6

Evidence it is production, not a scratch database: 3 companies, 4 customers,
10 auth users with a real sign-in on 2026-09-03T18:31Z, Ediel traffic on
2026-09-03, 275 ledger rows. It is also the only Gridex project in the
organisation, and `scripts/supabase-types-manifest.json` already pins
`project_id: piidsfebjqjmnepdpnas`.

HONEST GAP: I could not read `SUPABASE_URL` out of the Vercel production
environment directly. The Vercel MCP exposes no environment-variable API, the
value is not inlined in the served bundles I fetched, runtime logs for the
fresh deployment are empty, and `/api/internal/system/health` correctly returns
401. The identification therefore rests on "only one candidate exists, it holds
live production data, and the repository pins it" — strong, but not the direct
env read the plan asks for. To close it: read the production env var in the
Vercel dashboard or `vercel env pull`, and confirm the ref matches.

## Steg 2 — canonical vs production parity (FIRST RUN DONE)

Canonical shadow rebuilt from `main` (a1dba41) via dockerless replay.

Aggregate comparison, public schema:

| | canonical | production | delta |
| --- | --- | --- | --- |
| relations (tables+views) | 587 | 661 | +74 |
| tables only | 459 | 483 | +24 |
| policies | 2548 | 3094 | +546 |
| functions | 573 | 630 | +57 |
| extensions | 8 | 9 | +1 |

### CONFIRMED PRODUCTION DEFECT — F-PROD-1 (critical)

All 459 canonical tables were checked for existence in production. Exactly one
is missing:

    inbound_operation_events

It is created by `supabase/migrations/20260824190000_gridex_inbound_operations_foundation.sql`
and consumed by `lib/inbound-mail/manualInboundIngestion.ts:207`, which upserts
into it and ends with `if (error) throw error`.

So in production, manual inbound ingestion **throws** at the point where it
records the operation event. This is the "reparera inbound_operation_events /
reparera inbound mail break" item the ORIGINAL master plan listed as P0-D, now
confirmed with direct evidence rather than suspicion. It is exactly the class
of defect the parity engine was built to find, and the first real parity run
found it.

### F-PROD-2 — the tenant hardening migration is not applied

Production ledger tail is `20260904090538` (`z01_sla_watchdog_candidate_convergence`).
`20260904120000_canonical_tenant_invariant_convergence.sql` is on `main` but NOT
in production, so production still lacks the RLS, view `security_invoker`,
inert-policy removal and anon revokes that PR #307 added.

### F-PROD-3 — substantial production-only surface, unclassified

74 relations, 546 policies and 57 functions exist in production but not in
canonical. NOT yet classified. Per plan §3.4 each needs: object, type,
canonical state, production state, impact, risk, remediation; and per §3.5 each
must be moved into the migration chain, removed by forward migration, or
explicitly declared a platform artifact. Note the live ledger uses different
version timestamps from the repo filenames (e.g. live `20260904083106` vs repo
`20260904090000` for `z01_parallel_sla_watchdog`), which is the known
reconciliation model — names match, versions do not.

## Steg 3 — production reconciliation, EXECUTED 2026-09-04

Authorised by the user: "vi har ingen data idag som ar viktigt sa gor det
korrekt och produktionmassigt". Every apply below was preflighted first
(dependency existence, column existence, row counts, current state), applied
via the Supabase MCP `apply_migration` against project `piidsfebjqjmnepdpnas`,
then verified by direct introspection. No secrets recorded here.

The canonical -> production gap was established as exactly THREE unapplied
migrations, evidenced as 1 missing table and 2 missing functions. The other 12
ledger name/version mismatches are the known reconciliation model (names match,
versions differ) and are already applied.

### 3.1 `gridex_inbound_operations_foundation` (repo 20260824190000) — APPLIED

Preflight: partially applied. All 14 `manual_inbound_messages` columns present,
table `inbound_operation_events` absent, 2 rows in the parent table (negligible
lock), all dependencies present (`companies`,
`gridex_user_is_platform_admin()`, `gridex_can_read_company(uuid)`).

Applied. Verified: `table_exists=true, rls_enabled=true, policies=2, indexes=5,
rows=0, columns=20`. Ledger entry `20260904221046
gridex_inbound_operations_foundation`.

**This closes F-PROD-1.** `lib/inbound-mail/manualInboundIngestion.ts:207` no
longer throws in production.

### 3.2 `z02_snapshot_market_context_guard` (repo 20260903213000) — APPLIED

Preflight: 8/8 referenced tables present, both EDIFACT helper functions
present, all 10 `customer_operation_jobs` columns present, all 9
`customer_sites` columns present, and a 68-column reference check across
`customer_info_requests`, `facility_data_quality_issues`, `ediel_messages`,
`metering_points`, `grid_owner_data_requests`, `platform_grid_areas` and
`customer_sites` returned ZERO missing columns. 8 rows in
`customer_operation_jobs`; the trigger is BEFORE INSERT/UPDATE so no backfill
effect. Migration is non-destructive (`create or replace` x3, trigger guarded
by `drop trigger if exists`).

Applied verbatim from the repo file (not a reconstruction). Verified:
`gridex_gate_inbound_z02_snapshot_freshness`,
`gridex_apply_exact_z02_core` and `gridex_gate_exact_z02_atomic_apply` all
exist; trigger `trg_customer_operation_job_z02_snapshot_freshness` present
(7 non-internal triggers total on the table). Ledger entry `20260904221936
z02_snapshot_market_context_guard`.

Observed immediately after apply, exactly as predicted: the newly created
`gridex_gate_inbound_z02_snapshot_freshness()` was anon- AND
authenticated-executable, because Supabase default privileges grant EXECUTE on
newly created functions. This is the F-6 class the next migration closes, and
it is why the two migrations had to be applied in this order.

### 3.3 `canonical_tenant_invariant_convergence` (repo 20260904120000) — APPLIED

Preflight: zero missing relations (15 checked), zero missing functions (6
checked), `platform_table_classification` has a primary key on `table_name` so
the `on conflict` clause resolves, and production was already hardened for
everything EXCEPT the new function: 8/8 tables already RLS-on, 3/3
classifications present, 0 inert policies, and 5 of 6 functions already closed
to anon/authenticated. Only `gridex_gate_inbound_z02_snapshot_freshness()` was
open — the one 3.2 had just created.

Applied. Verified: `anon_exec_remaining=0`, `authenticated_exec_remaining=0`,
`service_role_exec=6`, `classified=3`, `inert_policies_left=0`,
`views_security_invoker=3`, `rls_on=8`. Ledger entry `20260904222045
canonical_tenant_invariant_convergence`.

**This closes F-PROD-2.**

Note: the migration only revokes from `public` and `anon`, yet `authenticated`
also came back 0. In production `authenticated` held EXECUTE via PUBLIC rather
than via an explicit default-privilege grant, so the PUBLIC revoke removed it.
Verified, not assumed.

### 3.4 Remaining gap after Steg 3

    tbl inbound_operation_events                        present
    fn  gridex_gate_inbound_z02_snapshot_freshness      present
    fn  gridex_finalize_admin_imported_signed_agreement_v1   STILL MISSING
    canonical_onboard_customer_graph definition length  254 (production passthrough)

Exactly one canonical object is still absent from production, and it belongs to
the one remaining unapplied migration:

`supabase/migrations/20260831095000_admin_signed_contract_import_canonicalization.sql`

**This one is a BEHAVIOURAL change and is deliberately NOT applied yet.** It
replaces production's 254-char passthrough `canonical_onboard_customer_graph`
(`select public.gridex_onboard_customer_graph(p_command)`) with the canonical
1741-char version that adds admin-channel, signed-document and catalog-offer
guards, in a live contract path. Regression risk was already assessed as low
(it is the latest definition in the chain; only one file defines
`gridex_finalize_admin_imported_signed_agreement_v1`; dependencies verified
present with 0 missing tables/columns/helper functions and 4 rows in
`customer_authorization_documents`) — but it changes what a live contract
import accepts, so it is presented to the user separately rather than folded
into a hardening batch.

### 3.5 `admin_signed_contract_import_canonicalization` (repo 20260831095000) — APPLIED

This is the behavioural one. Applied after the three hardening migrations, with
its own preflight.

Preflight:

* zero missing relations (16 checked: `customer_contracts`, `customers`,
  `contract_price_snapshots`, the four publication/version tables,
  `legal_bundle_versions` + `legal_bundle_version_documents`, the four
  contract-evidence tables, `customer_contract_signature_requests`,
  `customer_authorization_documents`);
* zero missing functions (6 checked, including `private.gridex_normalize_fixed_area_snapshot_v1`
  and `extensions.digest`), and the two variadic helpers
  `gridex_prepare_manual_contract_binding` and
  `gridex_record_customer_contract_event_v1` matched the call signatures used;
* all three `on conflict` targets have a matching unique constraint
  (`customer_contract_documents(customer_contract_id, document_type, document_sha256)`,
  `customer_contract_acceptances(customer_contract_id, acceptance_sha256)`,
  `customer_contract_evidence(customer_contract_id, evidence_type, evidence_sha256)`);
* **blast radius zero on existing data**: the new trigger is AFTER INSERT/UPDATE,
  and of the 4 rows in `customer_authorization_documents`, ZERO match its guard
  (`document_type='complete_agreement' and status='active'`). Nothing already
  stored is re-processed. 4 rows in `customer_contracts`.

Applied verbatim from the repo file. Verified: function present, trigger
`zz_customer_authorization_documents_finalize_signed_agreement_v1` present (5
non-internal triggers on the table), 0 of the 2 touched functions reachable by
anon or authenticated, and `canonical_onboard_customer_graph` definition length
went from 254 (the passthrough) to 1741 (the guarded canonical version). Ledger
entry `20260904222450 admin_signed_contract_import_canonicalization`.

Behaviour that changed, stated plainly:

* an admin import that sends `contract.status = 'signed'/'active'` together
  with a signed document is now rewritten down to `pending_signature` (catalog
  offer) or `draft` (one-off) with `signed_at` nulled — a contract can no
  longer be INSERTed straight into a signed state;
* a one-off contract without a catalog offer can no longer enter
  `pending_signature` until its canonical publication chain is materialized;
* uploading a `complete_agreement` / `signed_agreement` document now runs the
  full finalization: permission assertion, PDF + SHA-256 evidence check, locked
  publication-chain verification, a fresh canonical pricing receipt, contract
  document + acceptance + evidence + legal acceptances, revocation of any
  pending signature link, and only then `status = 'signed'`. Imports missing
  any of that now raise a named error instead of silently producing a
  half-evidenced signed contract.

### 3.6 Canonical -> production object gap: CLOSED

The earlier exhaustive check (every canonical table and every canonical
function tested for existence in production) returned exactly three missing
objects. All three applies were additive — no drop of any table, function,
policy or index — and all three objects are now verified present:

    inbound_operation_events                             present
    gridex_gate_inbound_z02_snapshot_freshness           present
    gridex_finalize_admin_imported_signed_agreement_v1   present

So canonical is now a subset of production. The remaining drift is entirely in
the other direction (production-only surface), which is 3.4/3.5 of the plan.

Production ledger tail:

    20260904222450  admin_signed_contract_import_canonicalization
    20260904222045  canonical_tenant_invariant_convergence
    20260904221936  z02_snapshot_market_context_guard
    20260904221046  gridex_inbound_operations_foundation

## Steg 3.4 — production-only surface classified

Full register: `quality/audits/GRIDEX-PROD-PARITY-2026-09-04.md`.

Direction A (canonical -> production) is closed and proved by set difference:
`comm -23 canonical production` returns 0 rows.

Direction B is 75 production-only relations, and the cause is NOT hand-editing
of production. It is how the clean replay picks its inputs:

* `scripts/gridex-aud-003-clean-replay.sh` collects only files matching
  `^\d{14}_.+\.sql$` plus the 9 non-timestamped files named in
  `scripts/gridex-aud-003-legacy-foundation.json`. Of 585 migration files in the
  repository, **84 are executed by nothing** and are not classified as
  noncanonical either (that manifest has exactly ONE entry).
* the foundation plan declares 26 `derivedBootstrap` artifacts, and each one
  REPLACES its whole source migration (`skip_timestamp_names`). The replacement
  only recreates what the replay needed, so everything else the original
  migration created is silently lost. Worked example in the register:
  `20260531111600_system_readiness_foundation.sql` is substituted by a
  reconstruction that creates `integration_api_clients` and drops seven other
  relations on the floor.

Classification of the 75:

    B1  43  created only by one of the 84 never-executed legacy migrations   (23 used by app code)
    B2  13  created by a replayed file but lost to a bootstrap substitution   ( 8 used by app code)
    B3  19  no CREATE statement anywhere in the repository                    ( 6 used by app code)

**37 of the 75 are referenced by application code**, so a system rebuilt from
the canonical chain would not run. That is F-PARITY-1 (critical): the
`clean-migration-replay` gate is green because the statements that would have to
succeed are never executed.

Tenant posture measured, not assumed: all 44 production-only tables have RLS on,
none reachable by `anon`, row counts near zero except `masterdata_audit_log`
(37,390 rows, no `company_id`, one permission-gated read policy — F-PARITY-3).

## Steg 3.4 — functions and triggers: the gap reaches tenant isolation

Same method, same three causes, worse consequence.

    canonical function names                 569
    production function names                626
    canonical functions missing in prod        0   (direction A closed for functions too)
    production-only functions                 57   (21 referenced by app code)

**F-PARITY-4 (critical).** `20260615_multitenant_integrity_and_claim_locks.sql`
is one of the 84 files the replay never executes. It creates the six
tenant-attribution guards, and production has all six attached as live BEFORE
ROW triggers:

    customer_contracts           gridex_customer_contracts_company_guard_tg
    customer_sites               gridex_customer_sites_company_guard_tg
    metering_points              gridex_metering_points_company_guard_tg
    powers_of_attorney           gridex_powers_of_attorney_company_guard_tg
    billing_underlays            gridex_billing_underlays_company_guard_tg
    customer_legal_acceptances   gridex_customer_legal_acceptances_company_guard_tg

A system rebuilt from the canonical chain enforces NONE of them. That is the
project's declared non-negotiable invariant, and the chain does not carry it.

This also CORRECTS an earlier recorded claim in this project memory. The older,
structurally limited harness reported "relations, columns, functions, indexes
and triggers match canonical exactly". Triggers do NOT match, and the mismatch
is the tenant guards. Do not rely on that earlier statement.

Also lost to a bootstrap substitution: `canonical_next_customer_number`,
`canonical_next_contract_number`, `canonical_next_application_number` (from
`20260801143000`, substituted by `bootstrap/20260801_company_capabilities_foundation.sql`)
— a rebuilt system cannot allocate customer, contract or application numbers.
And with no CREATE anywhere in the repository: `log_masterdata_change` (4 audit
triggers) and `set_updated_at` (6 triggers).

## Exact next action

WAITING ON THE USER for the vägval, asked 2026-09-04: resurrect the 84 legacy
migrations into the chain, or classify them out and adopt the live definitions
of what matters via forward migration. My recommendation is the second — several
of the 84 are one-off data repairs for named individuals
(`20260525_debug_batch_2c_activate_afshin_nibela.sql`) and are unlikely to
replay cleanly in order.

Under BOTH answers, this work is next and is not blocked:

1. Make the replay fail closed on unclassified inputs — any `.sql` under
   `supabase/migrations/` that is neither executed nor explicitly classified must
   abort the replay. Land it in warning mode first so nothing goes red before the
   classification exists.
2. F-PARITY-4 first among the content fixes: get the six tenant guards and their
   triggers into the canonical chain. They are the highest-severity item in the
   whole register.
3. Then number allocation, then `log_masterdata_change` / `set_updated_at`.
4. Then the remaining 75 relations / 57 functions per the register.
5. Policies (546 production-only) are still UNENUMERATED — same root cause
   expected, but not yet measured. Do that before declaring 3.4 complete.
6. Steg 4 (blocking parity) stays BLOCKED until the above is done.


## 2026-09-05 — active parity remediation

Status: IN_PROGRESS. No phase closed. Branch codex/gridex-parity-remediation-20260905.
Inventory manifest divergence and unsafe replay cleanup fixed with red/green
regressions, wired into OPS hardening. Production catalog read only; no live
mutations. See quality/audits/MASTER_PRODUCTION_REMEDIATION_STATE.md for baseline,
findings, tests and exact next work. Publish reviewable fixes and verify hosted CI;
then exhaustive replay accounting and forward canonical reconstruction.
Prior claims of unavailable production project or completed schema phases are
superseded by current catalog access and unresolved two-way parity.

2026-09-05 publication update: implementation 49c9b2a4 committed locally; automatic review rejected branch push (payload authorization/destination trust). No workaround attempted. Request approval for the concrete branch push before hosted CI. Typecheck and focused domain 7 files/22 tests PASS locally. Production parity remains open.


## Active checkpoint 2026-09-05 — supersedes earlier status claims

IN_PROGRESS; no masterplan phase is complete. Publication is authorized and
PR #310 is open as draft. Head 2568c28f has passing verify/quality jobs and a
failing canonical replay completeness gate (OPS run 33971545934). This is a real
repository remediation task, not an external permission blocker.

Forward migration 20260905141608 restores seven tenant relationship triggers
while preserving the newer snapshot function. Isolated PGlite 0.3.14 tests pass
18 reference cases under authenticated/service_role, twice; live read-only
catalog assertion also passes. These tests do not establish full RLS isolation
or canonical replay provenance. Integrity and production-readiness pass for
586 files; generated-types check correctly fails the new migration tail. Do not
update the types manifest without actual authoritative generation.

Two exact reviewed read-only diagnostic inputs receive an explicit classification.
The plan still has 56 unclassified files and 32 unresolved substitutions.
Next: finish reviewed effect reconstruction and parity semantic checks, then
obtain authoritative replay/type/schema artifacts and compare both ways with
production. No production mutation has occurred in the 2026-09-05 campaign.


## Active checkpoint 2026-09-06 — supersedes previous progress

IN_PROGRESS. No phase closed. PR #310 published head 0a0f4068 has passing quality
gates and isolated reconstruction/parity SQL tests; verify fails generated-types
tail, and clean replay fails completeness (OPS 33988318141). These are required
internal remediation gates, not external permission blockers.

Next reviewed batch restores eleven invitation columns and corresponding role/FK/
unique-index effects through forward migration 20260906081839. Isolated tests
pass 18 assertions and two invalid-data rollback scenarios; the historical
regression table is frozen separately so canonical artifact refresh cannot erase
the failing baseline. Full RLS/RPC/provider E2E is not established.

Portal/API-origin source 20260609150000 is now preserved after its early bootstrap
at its original timestamp. Whole-source selection failed before the fix; actual
SQL now runs twice in an isolated fixture, preserving existing explicit origins
and valid identities, restoring match_strength=manual (read-only live default),
and verifying indexes. Other historical substitutions remain blocking.

Integrity/readiness pass for 587 files. Types still fail the new migration tail;
no manual hash or schema baseline edits. Complete historical effect review, then
run authoritative full replay, generate types/schema and verify ledger/live parity.
No production mutation performed in this batch.

## Published verification checkpoint — 2026-09-06

Code revision 8344cbb84eb6691bf7507bcc9c6580565bc6a114 is published on draft
PR #310. OPS run 34035865807 finished: quality-release-gates PASS; all isolated
reconstruction/parity SQL fixtures PASS; verify FAIL at the new generated-types
migration tail; clean replay FAIL at completeness. Later verify steps skipped
after the type gate are not certified. No phase closed and no production writes.

Next: complete the bounded Ediel environment source review, then test its complete
SQL with actual prerequisite ordering and successor hardening on PostgreSQL 17
before changing either source-suppression declaration. Full historical accounting,
authoritative schema/types generation and ledger/live comparison remain required.

Publication review completed: 28 accounting tests, 14 recovery tests, portal SQL
and invitation SQL (18 assertions plus two rollback scenarios) pass on the current
worktree. Operational DB2B classification has its missing evidence report restored
after direct source/body review. Actual accounting: 587 inputs, 497 full selected,
31 partial, 4 exclusions, 55 unknown. Full-effects exit remains 1. The planned
batch publication is now superseded by the verified code-head checkpoint
above; continue the Ediel source review. No phase is closed.

Ediel next step: isolated PostgreSQL 17 CI fixture implemented; SQL composition
and diff checks pass, execution pending. Both source suppressions remain unchanged.
Inspect ediel-source-effects job before changing selection. No phase closed.

## Ediel source restoration — 2026-09-06

PostgreSQL 17 job 101502920151 in OPS run 34039266103 passed on published
revision d6967d21c4f7985c0f2a452ddaf8ae0cef8b3c60. Complete original source and
successor ran twice, including pgcrypto; synthetic backfill/history, uniqueness,
FK/column/RLS and non-owner policy assertions passed. This is isolated source
evidence, not canonical provenance or production parity.

Both bootstrap declarations now preserve source 20260602143000 at its original
timestamp. Selection regression failed SUBSTITUTED before the fix, passed after,
and rejects either declaration reverting independently. Accounting selftest now
passes 29 tests. Inventory integrity/readiness pass (587 files). Accounting now
498 FULL_FILE_SELECTED, 30 unresolved SUBSTITUTED, 4 exclusions, 55 UNCLASSIFIED;
full-effects gate correctly remains exit 1. Original SQL/checksums are unchanged.

Next: inspect CI for the restoration revision, then review the remaining source
substitutions and unclassified SQL. Authoritative canonical replay, schema/types
regeneration and bidirectional ledger/live parity remain open. No phase closed.

## Customer-flow source batch — 2026-09-06

Ediel restoration revision 69d51ee2c80a9a6221e871cc47027af66a02d125 has passing
PostgreSQL17 source-effects job 101503578599 (OPS run 34039506238). Its global
verify/types and replay/completeness gates remain red; quality is still running.
The next customer-flow source batch restores full pre-ledger selection after
its actual table prerequisites. Complete SQL runs twice in PGlite, preserving
existing values; source selection was red before and green after. Static
provenance, integrity and 29 accounting tests pass. Hosted SQL verification is
pending publication. Accounting: 499 full selected, 29 partial, 55 unknown,
4 exclusions. No phase closed or production mutation. Continue remaining source
reviews, then authoritative canonical regeneration and live/ledger parity.

## Actor-testing source batch — 2026-09-06

Customer-flow revision a201d3f2c60f9b9ad845f47f7137e4d8b0e7f9b1 has passing
hosted complete-source SQL/selection in verify job 101504319679 (OPS 34039783462).
Ediel PG17 job 101504319838 also passes. Verify subsequently fails generated
types tail; replay fails completeness. Neither is an external permission blocker.

The previously unclassified actor-testing source is now selected after its four
table prerequisites. Actual complete SQL runs twice in PGlite, validates five
index definitions and preserves evidence/messages. Selection red UNCLASSIFIED
before, green after; 29 accounting tests, static provenance and integrity pass.
Hosted actor-source test pending publication. Counts now 500 full, 29 partial,
54 unknown, 4 exclusions. Continue remaining historical source reviews; complete
canonical generation and ledger/live parity before closing any phase.

## Verified code-head checkpoint — 2026-09-06

Published code head 29dc94974825b329b9b822c2219b077d8679bb33, draft PR #310.
OPS run 34039976860: Ediel PostgreSQL 17 job 101504839380 PASS. Verify job
101504839441 passes all isolated SQL fixtures, including complete customer-flow
and actor-testing sources, then FAILS generated-types tail 20260906081839.
Clean replay job 101504839286 FAILS; complete input accounting remains unresolved.
Quality job 101504839408 is still running and is not certified. PR body records
these exact code-head results. No phase closed, production writes or manual
canonical/type hash changes. Next: inspect quality result and continue remaining
29 partial/54 unclassified sources; full authoritative replay/ledger/live parity
is still required. These are internal remediation items, not permission blockers.

## Billing completion source — 2026-09-06

Previous code-head 29dc9497 quality-release-gates is now PASS (OPS 34039976860).
Full source 20260520_batch_3_4_final_completion.sql now selected after the real
billing_export_run_id prerequisite. Isolated complete SQL passes twice with four
exact index definitions and unchanged rows in five tables. Wrong prerequisite
order is demonstrably rejected. Selection was UNCLASSIFIED before, full after.
29 accounting tests, static provenance, integrity pass. Hosted test pending.
Counts: 501 full selected, 29 partial, 53 unknown, 4 exclusions. No phase closed.
Next: verify published CI, then review status-check broad constraint removal and
profile-normalization trigger effects; do not blindly restore these sources.
Authoritative replay/schema/types/ledger/live parity remain required.

## Request-status continuation — 2026-09-06

Published billing code head a4063e3896ccefc487a2c39825c74462c444c9a2 passes full
billing SQL/selection in job 101545606099, OPS run 34055141338; verify subsequently
fails generated-types tail. Ediel PG17 passes; complete replay remains red.

Request status source 20260521_final_customer_info_request_status_check.sql is
now selected immediately after its first table definition. That reviewed boundary
has only the intended status CHECK; no earlier selected foundation references
the table. Full source passes twice with 19 exact states, unchanged rows/PK/FKs,
and atomic rejection of invalid existing data. Selection red before, green after.
29 accounting tests and static provenance pass; hosted status test pending.
Counts: 502 full selected, 29 partial, 52 unknown, 4 exclusions. Continue profile
normalization trigger/dependency review and remaining history, then authoritative
canonical replay/schema/types and ledger/live parity. No phase or merge approval.

## Profile metadata continuation — 2026-09-06

Status source on published code head 9266c1b65130302b47a78c6d26182391d3e56be9
passes hosted complete SQL, 19-state validation and selection in job 101546218730,
OPS 34055377589. Verify subsequently fails types tail; replay remains red.

Profile normalization full source is now selected at its reviewed trigger-free
foundation boundary. Two passes with valid and legacy synthetic values verify
only tracking metadata changes; identity/status/timestamps/auth FKs are preserved.
29 accounting tests, static provenance and integrity pass; hosted test pending.
Counts: 503 full, 29 partial, 51 unknown, four exclusions. Next: verify hosted
profile SQL, then test the complete auth-callback/email-event source on PG17
before restoring it ahead of normalization. Full parity remains unverified;
no production writes, phase closure, merge or deployment in this batch.

## Published verification — 2026-09-06

Verified code head 4df526a8f73228ecb1f41c672db98cebbc7bf108: OPS 34055573705,
verify job 101546734266 passes all isolated SQL, including all three new source
fixtures, then fails generated-types tail. Ediel PG17 passes; replay fails;
quality job 101546734174 is still running. PR #310 records exact results.
Next: inspect quality and test full auth-email source on PG17 before restoring
it ahead of normalization. 29 partial/51 unknown remain; no phase is closed.

Auth-email next step: full-source PostgreSQL17 test implemented, SQL composition
passes, hosted execution pending. Replay selection remains unchanged. Verify
the auth-email-source-effects job before restoring source ahead of normalization.
