# Production rollout runbook — tenant isolation remediation

Date: 2026-09-02
Scope: promoting the 2026-09-02 tenant isolation work from `gridex-ops-dev` to production.
Status of the work itself: verified against dev only. No production Supabase project
is visible to this session, so nothing here has been executed against production.

---

## 0. The blocker: dev is not a faithful rehearsal

Before anything is promoted, this has to be resolved. The development database and
the repository have diverged, so "it worked in dev" does not yet mean "the repository
will produce that result".

| Problem | Detail |
|---|---|
| Version numbers differ | The repository files (`20260902090000`, `091000`, …) are **consolidations** written after the fact. Dev actually ran seventeen finer-grained migrations (`082256`, `082844`, `082932`, `083118`, …). No environment has ever executed the repository files in the form they are committed in. |
| One migration was applied to dev and never committed | `20260902092313_attribute_quarantined_inbound_by_receiver_ediel_id` — recovered verbatim from `supabase_migrations.schema_migrations` and committed as `20260902096000`, renumbered so it sorts after the migration that creates `platform_inbound_quarantine`. Verified idempotent: re-running it now affects zero rows. |
| A second migration is applied to dev and is in nobody's repository | `20260902100045_fix_website_poa_scope_and_grid_owner_aliases` adds `powers_of_attorney.expires_at` and a `gridex_sync_poa_expires_at` trigger. **It is not mine.** Whoever applied it needs to commit it, or dev keeps a column production will not get. |

**Do this first.** Replay the repository from scratch onto a shadow database
(`supabase db reset` against a branch, or a fresh project), then diff that schema
against dev. Any difference is either a missing migration or a consolidation that
does not reproduce what actually ran. Promote nothing until the diff is empty or
every difference is explained.

---

## 1. Classify the migrations by production risk

They are not equally safe. Three contain data-dependent statements that were derived
from dev's data and must not be replayed blindly.

| Migration | Contains | Production risk |
|---|---|---|
| `090000_tenant_scoped_unique_business_keys` | DDL only | **Low.** Each new key is strictly weaker than the one it replaces — adding `company_id` to a unique index can only permit more rows — so no existing row can violate it. Confirm the old index names exist first; the `drop … if exists` is silent otherwise. |
| `091000_company_scoped_permission_engine` | DDL **and DML on `user_roles`** | **High.** It deletes redundant global company roles and backfills others. In dev the delete was safe because `owner` and `company_admin` resolved to identical permission sets — that was verified, not assumed. In production it must be re-derived: run the dry run in §3 and review the actual rows before deleting anything. |
| `092000_view_security_invoker_and_dead_policy_cleanup` | DDL and a grant-driven policy sweep | **Medium.** The sweep drops policies whose roles hold no privilege on the table. Grants differ per environment, so the set it drops in production will differ. Dry-run it (§3) and read the list before applying. |
| `093000_explicit_tenant_scope_and_inbound_quarantine` | DDL, backfill, `NOT NULL`, `CHECK` | **High.** `canonical_energy_flow_events_scope_check` fails if production holds untenanted rows that are not `market_price.*` or `energy_geodata.*`. Count them first. |
| `094000_platform_table_classification_and_invariant_gate` | DDL and a seed that reads live grants | **Medium.** Self-adjusting, but the resulting classification is a set of decisions and should be reviewed, not accepted silently. |
| `095000_lock_customer_chain_with_composite_keys` | DDL, strictly stronger | **High.** Composite foreign keys fail on any existing drift. Dev preflight found zero violations across 51 tables; production is unknown. This one goes last. |
| `096000_attribute_quarantined_inbound_by_receiver_ediel_id` | DML only | **Low.** Generic and idempotent: it only assigns a company that owns the receiver EDIEL id, and only where exactly one company does. |
| `100000_rpc_surface_and_permission_scope_corrections` | DDL — functions and grants | **Medium.** No data risk, but it changes who can do what. Needs the permission matrix in §5. |
| `100500_close_remaining_advisor_hygiene` | DDL | **Low.** |

---

## 2. Deploy order: application first, then migrations

Verified, not assumed:

- The application references **none** of the new database objects. `grep` over `app/`
  and `lib/` for `gridex_get_user_permissions_in_company`,
  `gridex_has_permission_in_company`, `gridex_actor_has_company_permission`,
  `platform_table_classification`, `platform_inbound_quarantine` and `event_scope`
  returns nothing.
- The only contract change is that `lib/admin/guards.ts` and `lib/admin/apiGuards.ts`
  now pass `p_selected_company_id` instead of `null`. The **old** wrapper already
  honours a non-null argument — it returns the scoped context unchanged and only
  applies its cross-company union when the argument is null.

So new application code against the old database is correct, and it is *more* correct
than the old code. The reverse order is weaker: new database with old application
passing `null` still resolves scoped permissions, but for a company derived from
membership rather than the one selected in the UI, so a user who has switched company
could see a permission set for the wrong one.

There is also a hard reason not to migrate first: `100000` adds
`electricity_suppliers_own_requires_company`. The **old** `setOwnElectricitySupplier`
clears `is_own_supplier` globally and can set it on a row with no company, which that
constraint rejects. Old application plus new database breaks marking an own supplier.

**Deploy the application, verify, then run the migrations.**

---

## 3. Preflight — read-only, run against production before anything

None of these writes. Run them all and keep the output as the baseline.

```sql
-- a. the invariant gate, which is entirely read-only, gives the current posture
--    and predicts exactly which later steps will fail
\i scripts/sql/tenant-isolation-invariants.sql

-- b. will 093000's check constraint hold?
select event_type, count(*)
from canonical_energy_flow_events
where company_id is null
  and event_type not like 'market_price.%'
  and event_type not like 'energy_geodata.%'
group by 1;                                   -- must be empty

-- c. will 095000's composite keys hold? (run the same dynamic scan used in dev)
--    any non-zero row here must be repaired before the migration
select conrelid::regclass::text as child, conname
from pg_constraint where contype = 'f' and not convalidated;

-- d. what would 091000 delete?
select ur.id, ur.user_id, r.key as role_key, ur.company_id
from user_roles ur join roles r on r.id = ur.role_id
where ur.company_id is null
  and gridex_normalize_platform_role(coalesce(r.key, r.name))
      not in ('super_admin','platform_admin');

-- e. what would 092000's sweep drop?
select c.relname, pol.polname
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where pol.polroles <> '{0}'::oid[]
  and not exists (
    select 1 from unnest(pol.polroles) as role_oid
    join pg_roles r on r.oid = role_oid
    where has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
  );
```

Step (d) is the one to read carefully. In dev the deletion was safe because the
affected users each held an equivalent company-scoped role; that has to be true in
production too, and it is a fact about production's data, not a property of the
migration.

---

## 4. Apply in risk order, verifying between steps

Each step ends with the invariant gate. Stop on the first failure.

1. `090000` — key re-scoping. Cannot fail on data.
2. `100500`, then `100000` — function definitions and grants. Run §5 immediately after.
3. `096000` — inbound attribution. Idempotent.
4. `092000` — after reading the dry-run list from §3(e).
5. `094000` — then review the classification table before continuing.
6. `093000` — after §3(b) returns empty.
7. `091000` — after §3(d) has been reviewed and the deletion approved.
8. `095000` — last, after §3(c) is clean.

---

## 5. Permission verification matrix — the step that catches an outage

This exists because the remediation itself broke access twice, and both breaks were
silent: F-17 gave one tenant access to another's documents, and F-18 denied every
ordinary tenant user their shared masterdata. Neither showed up in a test suite.

For **each** company, pick one real user per distinct role and record before and
after:

```sql
select
  public.gridex_has_permission(:user, 'masterdata.read')                        as shared_masterdata_read,
  public.gridex_get_user_permissions_in_company(:user, :own_company)            as perms_own_company,
  public.gridex_get_user_permissions_in_company(:user, :other_company)          as perms_foreign_company,
  public.gridex_actor_has_company_permission(:user, :own_company, 'masterdata.read')   as own_documents,
  public.gridex_actor_has_company_permission(:user, :other_company, 'masterdata.read') as foreign_documents;
```

Expected after the change:

| Column | Ordinary tenant user | Platform admin |
|---|---|---|
| `shared_masterdata_read` | true | true |
| `perms_own_company` | non-empty | non-empty |
| `perms_foreign_company` | **empty** | non-empty |
| `own_documents` | true | true |
| `foreign_documents` | **false** | true |

An empty `perms_own_company` or a false `own_documents` for a real user is an outage,
not a hardening. A non-empty `perms_foreign_company` is the original defect.

Then exercise the flows the predicates actually gate: open a customer, open a
document, list grid owners and price areas in the intake form, mark an own supplier,
run a supplier switch.

---

## 6. Rollback

Every migration is forward-only, so capture what you are replacing **before** each
step, not after:

```sql
-- function bodies, before 100000 and 091000
select p.oid::regprocedure::text, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where p.proname in (
  'gridex_get_user_permissions','gridex_has_permission',
  'gridex_actor_has_company_permission','canonical_authenticated_tenant_context'
);

-- index definitions, before 090000
select indexrelid::regclass::text, pg_get_indexdef(indexrelid)
from pg_index x join pg_class c on c.oid = x.indrelid
where c.relname in ('metering_points','customers','electricity_suppliers','legal_bundle_versions')
  and x.indisunique;

-- policy definitions, before 092000
select c.relname, pol.polname, pg_get_expr(pol.polqual, pol.polrelid),
       pg_get_expr(pol.polwithcheck, pol.polrelid)
from pg_policy pol join pg_class c on c.oid = pol.polrelid;
```

Function and grant changes roll back cleanly by replaying the captured definition.
Index swaps roll back by recreating the captured definition. **The two data steps do
not roll back** — `091000`'s delete and `093000`'s backfill are irreversible, which is
why both are gated on an approved dry run and why a snapshot should be taken
immediately before them.

---

## 7. After the rollout

- Set `GRIDEX_OPS_DATABASE_URL` for the `production-e2e` environment so
  `tenant-isolation-invariants.yml` can run. Without it the weekly drift check fails
  on its first step rather than silently skipping — but it still is not checking
  anything.
- Run the invariant gate against production once as a post-deploy assertion, then let
  the weekly schedule take over.
- The service-role ratchet already runs on every pull request and needs nothing.

---

## 8. What this does not cover

- **F-15 proper.** Request traffic still runs as `service_role`, which holds
  `BYPASSRLS`, so the policies verified here do not apply to it. The ratchet freezes
  the count at 2 402 call sites; moving to a role without `BYPASSRLS` is separate work.
- **Production parity of the schema itself.** Section 0 establishes whether the
  repository reproduces dev. Whether dev reproduces production is a further question
  that needs the production project.
- **Per-message EDIEL business semantics.** Never in scope for this work.
