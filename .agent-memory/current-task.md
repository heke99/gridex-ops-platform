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

## Exact next action

Steg 4 is BLOCKED until F-PARITY-1 is remediated. Do not make `db:parity
production` blocking yet. Work the register's remediation plan in this order:

1. Make the replay fail closed on unclassified inputs: any `.sql` under
   `supabase/migrations/` that is neither executed nor explicitly classified
   must abort the replay. Land this FIRST so the count can only go down.
2. Classify each of the 84 never-executed migrations: into the canonical chain,
   or into `gridex-aud-003-noncanonical-artifacts.json` with evidence.
3. Reconcile the 26 derived-bootstrap substitutions — for each, what the source
   created that the reconstruction does not.
4. Adopt the 19 orphan relations into the chain by forward migration, starting
   with the 6 the application queries (`sites`, `onboarding_sessions`,
   `onboarding_steps`, `onboarding_choices`, `customer_external_auth_links`,
   `platform_grid_owner_readiness_v`).
5. Re-run full parity, expect zero, then Steg 4 (blocking).
6. Separately decide `masterdata_audit_log` tenant scoping and whether
   `gridex_wrong_project_cleanup_backup` (40 rows) can be dropped.
