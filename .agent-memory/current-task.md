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

## Exact next action

Steg 3, and it needs authorisation because it writes to a live database:

1. Apply the missing `inbound_operation_events` foundation to production, and
   `20260904120000` with it, in ledger order. This is a forward migration
   against real production data — do NOT do it without the user saying so.
2. Then classify the 74/546/57 production-only objects.
3. Only after reconciliation, make `db:parity production` blocking (Steg 4).

Do NOT mark parity blocking before the drift is classified: it would turn every
build red on drift nobody has triaged.
