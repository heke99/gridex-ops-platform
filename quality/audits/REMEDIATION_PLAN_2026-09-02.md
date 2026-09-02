# How to fix this correctly and production-grade

Date: 2026-09-02
Input: `SPEC_VS_REALITY_DEEP_AUDIT_2026-09-02.md` (N-1 … N-9),
`TENANT_ISOLATION_CONSISTENCY_AUDIT_2026-09-02.md` (F-1 … F-18),
`TENANT_REMEDIATION_PRODUCTION_RUNBOOK_2026-09-02.md`.

---

## 1. There is one root cause, and it is not any of the findings

Three artifacts describe the schema:

| Artifact | What it is | What checks it |
|---|---|---|
| `supabase/migrations/` — 564 files | what the repository says the schema should be | `db:migrations:integrity` — compares the files to `scripts/migration-history-manifest.json`, i.e. to a record of themselves |
| `supabase/database.types.ts` — 3.2 MB, 545 relations | what TypeScript believes the schema is | `db:types:check` — compares a **SHA-256 of the file** to `scripts/supabase-types-manifest.json`, plus the newest migration *filename* |
| `gridex-ops-dev` — 661 relations, 258 recorded migrations | what actually exists | nothing |

Every gate compares an artifact to itself. Nothing compares any two of them. That
is why N-1 (a table the code writes to and the database does not have) shipped
green, and why N-2 (564 files against 258 recorded migrations) went unnoticed.

Two facts sharpen this:

- `db:types:check` **is failing right now**, and was already failing before this
  branch: the manifest records `20260901084000_harden_gridex_point_to_grid_area_search_path.sql`
  as the tail, while the repository tail was already `20260902094600_fix_canonical_transition_request_hash_rewrite.sql`
  before any migration on this branch. So `db:migrations:check`, and the CI job
  that calls it, is red on main today.
- The manifest's `generated_with` field reads `supabase-cli-2.101.0-clean-replay`.
  **The right thing was already done once.** Someone replayed the repository into
  a clean database and generated types from it. That replay's output was used to
  produce types — and then thrown away, instead of being diffed against the
  database it was supposed to describe.

So the fix is not nine fixes. It is to make that clean replay a permanent,
automated artifact, and to diff everything against it. Then the nine findings are
either caught by it or are small, ordinary changes.

**Fix the class first (PR 1–3). Then the instances (PR 4–7).**

---

## 2. PR 1 — Make a clean replay the source of truth

**Goal:** a schema that is, by construction, exactly what the repository produces.

Run it in CI on the `supabase/postgres` image, not a bare PostgreSQL. This is not
a preference: the replay needs **PostGIS**, and one migration requires it. A bare
Debian PostgreSQL 16 has `pgcrypto`, `pg_trgm`, `btree_gist` and 44 others, but no
`postgis` — verified in this session, which is why the replay could not be run
here. It also needs the Supabase roles (`anon`, `authenticated`, `service_role`,
`authenticator`) and the `auth` and `storage` schemas, all of which the Supabase
image provides.

Steps:

1. A `shadow` job that starts the image, replays `supabase/migrations/` in
   filename order with `ON_ERROR_STOP=1`, and fails on the first error.
   **Expect this to fail the first time.** Nobody has run the committed files in
   the committed form — the runbook's §0 already says so, and 241 of them have
   never been applied under any version. Getting a clean replay is the work of
   this PR; every fix it forces is a real defect in the repository.
2. `pg_dump --schema-only --no-owner --no-privileges` from the shadow, normalised
   and committed as `supabase/schema.sql`. This becomes the reviewable artifact:
   a schema change shows up as a schema diff in the pull request, not only as a
   new file whose effect a reviewer has to simulate mentally.
3. `db:types:gen` regenerates from the shadow database instead of `--linked`,
   with the CLI version **pinned**. The manifest says 2.101.0; `npx supabase`
   resolves to 2.116.0 today, and generated output is version-sensitive.
4. Replace the hash check in `scripts/check-supabase-generated-types.cjs`: keep
   the hash as a tamper check, but make the real assertion "regenerating from the
   shadow produces this file byte for byte". A stale manifest then cannot pass by
   updating the manifest.

**Risk:** none to production — nothing here touches a live database.
**Done when:** the replay is green, `supabase/schema.sql` is committed, and
`db:migrations:check` passes on main again.

## 3. PR 2 — Diff the shadow against a real database

**Goal:** `npm run db:parity -- "$DATABASE_URL"` answers "does this database
match the repository?" and names every difference.

Compare, in both directions: relations; columns with type and nullability;
unique indexes; foreign keys; functions with argument names; triggers; policies;
grants. These are exactly the sweeps run by hand in §5 of the audit — the point
of this PR is that a machine runs them on a schedule instead.

Ship it **report-only** first. Run it against dev, and expect a long list: 122
applied versions with no repository file, 241 repository names never applied.
Work that list down; only then make it blocking, alongside
`tenant-isolation-invariants.yml` on the weekly schedule (which still needs
`GRIDEX_OPS_DATABASE_URL` set for the `production-e2e` environment).

This is the check that would have caught N-1 on the day the migration was written
and not applied — and it is what makes "it worked in dev" mean something.

**Risk:** read-only.
**Done when:** parity against dev is empty or every remaining difference is
recorded with a reason.

## 4. PR 3 — Type the Supabase clients (N-7)

Once the types are trustworthy, and not before, change

```ts
createClient(url, serviceRoleKey, …)      →  createClient<Database>(url, serviceRoleKey, …)
```

in `lib/supabase/service.ts` (both constructions), `lib/supabase/server.ts` and
`lib/supabase/client.ts`.

Doing this earlier would be worse than useless: typing the client against a
3.2 MB types file that describes neither the repository nor the database would
produce hundreds of false errors and teach the team to suppress them.

Expect real errors when it lands. Fix them; where a fix is genuinely out of
scope, `@ts-expect-error` with the reason and a follow-up, never `as any` on the
client itself. After this, N-1's entire class — wrong table, wrong column, wrong
RPC argument — is a compile error.

**Risk:** medium, contained: type-level only, no runtime behaviour changes.
**Done when:** `npm run typecheck` passes with the generic in place.

## 5. PR 4 — Close N-1

Apply `supabase/migrations/20260824190000_gridex_inbound_operations_foundation.sql`
to dev, then production in the runbook's order. It is `create table if not
exists` plus indexes and policies — no data statements, no risk.

Then add the test that was missing: exercise `ingestManualInboundEmail` end to
end against the schema, asserting that an `inbound_operation_events` row is
written with the resolved `company_id`. Without it, PR 3 protects the table name
but nothing protects the behaviour.

Reprocess the two quarantined `manual_inbound_messages` rows once the table
exists, so the backlog is not silently lost.

**Risk:** low. **Done when:** a manual inbound message produces an operation
event, and the test fails if the table is missing.

## 6. PR 5 — The two missing constraints (N-8, N-3)

Forward migrations, each preceded by its own duplicate check:

- `invoice_export_items (company_id, provider, provider_invoice_guid)` unique
  where the guid is not null. The billing webhook already assumes this key
  identifies exactly one row; today nothing enforces it. Check for duplicates
  first — the table is empty in dev, production is unknown.
- `ux_billing_export_items_source_period` on `billing_export_run_items`, created
  directly. It was declared through `gridex_db1_try_exec`, which records failures
  instead of raising, so it never appeared and the migration reported success.

And close the mechanism, not just the two instances: `gridex_db1_try_exec` and
anything like it must not be used to create constraints or indexes. A constraint
that may silently not exist is not a constraint. Add this to the invariant gate —
it already knows how to enumerate expected unique keys.

**Risk:** low, but both are new uniqueness constraints, so they fail on existing
duplicates. Run the check queries against production before applying.

## 7. PR 6 — Two small correctness fixes (N-4, N-6)

- `lib/billing/underlayEngine.ts:439` — invert the v6 completeness check so it
  applies **unless** the snapshot proves it belongs to an older, explicitly
  listed schema. Today a snapshot with a null version skips every check, which is
  the opposite of failing closed. Add a case for a null version to the tests.
- `app/api/v1/customer/notifications/read/route.ts` — parse with a strict
  contract like every other external write surface, rejecting unknown fields.

**Risk:** the v6 change may reject snapshots that pass today. That is the point,
but count the affected rows in production first and repair them rather than
discovering it during a billing run.

## 8. PR 7 — Make tenant scoping structural (N-9, then F-15)

Two steps, in order:

1. Route the 66 unscoped `update`/`delete` call sites through
   `lib/supabase/tenantDb.ts`, which stamps and filters `company_id`, with
   `unscoped()` as the explicit, greppable exception. Add a ratchet in the shape
   of `scripts/check-service-role-tenant-ratchet.cjs`: freeze the count, let it
   fall, never rise. Each site is safe today by derivation; the change makes it
   safe by construction.
2. Then F-15 proper: move request traffic off `service_role`. While every request
   runs as a role holding `BYPASSRLS`, the 266 tenant tables' policies are
   verified but inert for application traffic. This is the largest remaining
   item and belongs in its own plan, after parity and typing are in place —
   those are what make a change of this size reviewable.

**Risk:** step 1 low and mechanical. Step 2 high; do not start it before PR 1–3.

## 9. Order, and why

```
PR 1 clean replay ──► PR 2 parity diff ──► PR 3 typed clients
      │                     │                     │
      │                     └──► reveals whatever else N-1 was hiding
      │
      └──► PR 4 close N-1 (can land as soon as the replay proves the migration is sound)

PR 5, PR 6 independent, land any time
PR 7 last
```

PR 1 to 3 are the ones that stop this recurring. PR 4 to 6 are ordinary changes
that happen to be currently outstanding. If only one thing gets done, do PR 1:
without a schema that is known to match the repository, every other verification
in this project is an assertion about an artifact nobody has checked.

## 10. What none of this covers

- **Production.** No production Supabase project is visible to this session.
  Everything above is verified against `gridex-ops-dev`. PR 2 is what makes
  production answerable at all — until it runs there, whether dev reflects
  production is unknown.
- **N-5**, the portal writing `public.customers` directly, is a product decision
  about whether contact data has one writer or two. It is correctly tenant-scoped
  either way. Decide it; do not let it drift.
- **Per-message EDIEL business semantics**, never in scope for this work.
