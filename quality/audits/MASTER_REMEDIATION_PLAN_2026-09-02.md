# Gridex OPS — complete remediation plan

Date: 2026-09-02
Covers every finding from the three audits run in this cycle, in one register and
one sequence.

| Source | Findings |
|---|---|
| `TENANT_ISOLATION_CONSISTENCY_AUDIT_2026-09-02.md` | F-1 … F-15 |
| `TENANT_TARGET_ARCHITECTURE_AND_REGISTER_2026-09-02.md` | F-16 … F-18 |
| `SPEC_VS_REALITY_DEEP_AUDIT_2026-09-02.md` | N-1 … N-10 |
| `TENANT_REMEDIATION_PRODUCTION_RUNBOOK_2026-09-02.md` | promotion procedure |

Everything is verified against `gridex-ops-dev` (`piidsfebjqjmnepdpnas`).
No production Supabase project is visible to this session.

---

## 1. Complete register

### Closed — tenant isolation (F-1 … F-14, F-16 … F-18)

| ID | Sev | Finding | Closed by |
|---|---|---|---|
| F-1 | High | Application permissions were the union across all of a user's companies | `canonical_authenticated_tenant_context` delegates to the scoped resolver; one engine for `guards.ts` and `apiGuards.ts`. Verified: 36 permissions in own company, **0** in a foreign one |
| F-2 | High | `gridex_get_user_permissions` ignored tenancy and role status | Company, `status` and membership all checked; `…_in_company` variants added for policies |
| F-3 | High→FP | "21 736 untenanted energy-flow events" | Original reading was wrong: all are `market_price.*` / `energy_geodata.*`, platform-wide by nature. `event_scope` makes it explicit, with a check constraint |
| F-4 | High | Inbound EDIEL manual review unreachable by any tenant | `platform_inbound_quarantine`; 22 stranded messages enrolled and later attributed by receiver EDIEL id |
| F-5 | Med | Further untenanted operational and audit data | `customer_operation_tasks` backfilled; the rest declared `mixed` with NULL's meaning written down and enforced |
| F-6 | Med | Isolation depended on a guard nothing enforced the presence of | `platform_table_classification` covers all 501 tables; `npm run tenant:invariants` fails the build on any breach |
| F-7 | Med | Platform-admin inferred from role names | Read from the database; trigger `gridex_user_roles_scope_consistent` forbids mixed scope |
| F-8 | High | Customer numbers could collide across tenants | `UNIQUE (company_id, customer_number)`, proven in a rolled-back transaction |
| F-9 | High | One "own supplier" platform-wide — **a real cross-tenant write** | `setOwnElectricitySupplier` cleared `is_own_supplier` on every row in the database, reachable by any tenant admin with `switching.write`. Now company-scoped, hardcoded `'Gridex'` fallback removed |
| F-10 | High | Metering point identifiers globally unique | `UNIQUE (company_id, metering_point_id)` and the same for `meter_point_id` / `ediel_reference` |
| F-11 | Med | Identical legal text blocked the second tenant | `UNIQUE (company_id, content_sha256)` |
| F-12 | Med | Customer chain enforced on 22 of 99 tables | Composite keys on **94 of 99**. Also surfaced 26 tables carrying `customer_id` with no key at all |
| F-13 | Low | Three views ran with owner privileges | All 160 views run as invoker |
| F-14 | Med | 2 761 policies targeting roles with no grants, provably inert | Removed after verifying inertness |
| F-16 | High | Permission resolvers exposed as REST RPC, one anon-executable | Revoked from client roles; `gridex_has_permission` made SECURITY DEFINER so 47 policies keep working |
| F-17 | High | Storage document access checked the permission in the wrong company | Resolved in the company being asked about |
| F-18 | High | The F-2 fix over-tightened and broke shared masterdata | One predicate was answering two questions; the any-active-membership semantic restored for shared masterdata |

F-16 and F-18 are worth remembering: **the remediation itself broke access twice,
and both breaks were silent.** That is what §5 of the runbook exists for.

### Open

| ID | Sev | Finding | Stage |
|---|---|---|---|
| N-1 | High | `public.inbound_operation_events` does not exist; `manualInboundIngestion.ts:207` writes to it and rethrows. Manual inbound email fails on every message, both webhook and IMAP | C |
| N-2 | High | Repository and database are two divergent lineages: 564 files, 258 recorded migrations, 136 versions in common, 241 repository names never applied | A, B |
| N-10 | Med | The generated-types gate compares a SHA-256, never a schema — and is failing today, so `db:migrations:check` is red on main | A |
| N-7 | Med | The Supabase client is untyped, so `typecheck` cannot fail on a wrong table, column or RPC argument | B |
| N-8 | Med | The billing webhook resolves a tenant on `provider_invoice_guid`, which carries no unique index | D |
| N-3 | Med | `ux_billing_export_items_source_period` never created — declared through `gridex_db1_try_exec`, which swallows failures | D |
| N-4 | Low | The v6 snapshot fail-closed check only fires when the snapshot declares itself v6 | D |
| N-6 | Low | `notifications/read` parses non-strictly and ignores unknown fields | D |
| N-9 | Low | 66 `update`/`delete` calls on tenant tables carry no tenant predicate | E |
| N-5 | Low | The portal writes `public.customers` directly from `profile-update` | decision, §6 |
| F-15 | High | Request traffic runs as `service_role`, which holds `rolbypassrls = true`. Contained by `tenantDb.ts` plus a ratchet frozen at 2 402 call sites across 452 files; not closed | E |

### Verified clean — worth stating, because these were the fear

| Sweep | Coverage | Result |
|---|---|---|
| Cross-tenant rows | 451 foreign keys where child and parent both carry `company_id` | **0 rows** point at another tenant |
| RPC argument names | all 110 `.rpc(name, {…})` sites vs `pg_proc.proargnames` | **0** mismatches |
| Column references | 191 relations, every literal `select()` list | **0** missing columns |
| `NOT VALID` foreign keys | whole database | **none** — the 32 orphan rows are gone, closing that item |
| Invariants A–H (intent) | code and schema | 7 hold outright; the eighth holds with N-4's caveat |

---

## 2. The one root cause

Three artifacts describe the schema, and **every gate compares an artifact to
itself**:

| Artifact | Size | What checks it |
|---|---|---|
| `supabase/migrations/` | 563 files | `db:migrations:integrity` — the files against a manifest of the files |
| `supabase/database.types.ts` | 3.2 MB, 545 relations | `db:types:check` — a SHA-256 of the file, plus the newest migration *filename* |
| `gridex-ops-dev` | 661 relations, 258 recorded migrations | nothing |

Nothing compares any two. That is why N-1 shipped green and N-2 went unnoticed
for months.

One detail decides the plan's shape: the types manifest's `generated_with` field
reads `supabase-cli-2.101.0-clean-replay`. **The correct procedure was already
performed once** — replay the repository into a clean database, generate types
from that. Its output was used for types and then discarded, instead of being
diffed against the database it was supposed to describe.

So this is not eleven fixes. It is one missing artifact, plus a handful of
ordinary changes.

---

## 3. The plan

```
Stage A  Clean replay is the source of truth      ── unblocks everything
Stage B  Diff it against real databases            ── N-2, N-7 become measurable
Stage C  Close the live break                      ── N-1
Stage D  The ordinary outstanding changes          ── N-3, N-4, N-6, N-8
Stage E  Make tenant scoping structural            ── N-9, then F-15
Stage F  Promote to production                     ── the runbook, once A–D hold
```

Stages A and B are the ones that stop this recurring. C can land in parallel as
soon as A proves the migration replays. D is independent. E is last because it is
the largest change and A–B are what make it reviewable.

### Stage A — Make the clean replay a standing artifact

**PR A1 — replay job.** A CI job on the `supabase/postgres` image that replays
`supabase/migrations/` in filename order with `ON_ERROR_STOP=1`.

The image is not a preference. The replay needs **PostGIS**, and one migration
requires it; a bare PostgreSQL 16 offers `pgcrypto`, `pg_trgm`, `btree_gist` and
44 others but not `postgis` — verified in this session, which is why the replay
could not be run here. It also needs the Supabase roles (`anon`,
`authenticated`, `service_role`, `authenticator`) and the `auth` / `storage`
schemas.

**Expect the first run to fail.** Nobody has executed the committed files in the
committed form: the runbook's §0 says the newest ones are consolidations, and 241
repository names have never been applied under any version. Every failure it
forces is a real defect in the repository, and fixing them is the substance of
this PR.

**PR A2 — commit the dumped schema.** `pg_dump --schema-only --no-owner
--no-privileges` from the shadow, normalised, committed as `supabase/schema.sql`.
A schema change then appears in a pull request as a schema diff, not only as a
new file whose effect a reviewer must simulate mentally.

**PR A3 — make the types gate real.** Regenerate types from the shadow, not
`--linked`, with the CLI version **pinned** (the manifest says 2.101.0; `npx
supabase` resolves to 2.116.0 today, and the output is version-sensitive).
Keep the hash as a tamper check, but make the assertion "regenerating from the
shadow reproduces this file byte for byte". A stale manifest can then no longer
pass by updating the manifest — which is how N-10 stayed green.

*Risk:* none to any live database. *Done when:* the replay is green,
`supabase/schema.sql` is committed, and `db:migrations:check` passes on main
again.

### Stage B — Diff the shadow against a real database

**PR B1 — `npm run db:parity -- "$DATABASE_URL"`.** Compare in both directions:
relations, columns with type and nullability, unique indexes, foreign keys,
functions with argument names, triggers, policies, grants. These are precisely
the sweeps run by hand in the deep audit; the point is that a machine runs them
on a schedule.

Ship it **report-only**. Run against dev and expect a long list — 122 applied
versions with no repository file, 241 repository names never applied. Work that
list down. Only then make it blocking, alongside
`tenant-isolation-invariants.yml` on the weekly schedule, which still needs
`GRIDEX_OPS_DATABASE_URL` set for the `production-e2e` environment.

This is the check that would have caught N-1 on the day the migration was written
and not applied. It is also what makes "it worked in dev" mean anything.

**PR B2 — type the Supabase clients (N-7).** Once the types are true, and not
before:

```ts
createClient(url, key, …)  →  createClient<Database>(url, key, …)
```

in `lib/supabase/service.ts` (both constructions), `lib/supabase/server.ts` and
`lib/supabase/client.ts`. Doing this earlier would be worse than useless: typing
against a file that describes neither the repository nor the database produces
hundreds of false errors and teaches the team to suppress them. Fix the real
errors; where a fix is out of scope use `@ts-expect-error` with a reason and a
follow-up, never `as any` on the client. After this, N-1's whole class — wrong
table, wrong column, wrong RPC argument — is a compile error.

*Risk:* B1 read-only. B2 type-level only, no runtime change.

### Stage C — Close the live break (N-1)

**PR C1.** Apply `20260824190000_gridex_inbound_operations_foundation.sql` to dev,
then production in the runbook's order. It is `create table if not exists` plus
indexes and policies — no data statements.

**PR C2.** Add the test that was missing: exercise `ingestManualInboundEmail`
against the schema and assert an `inbound_operation_events` row with the resolved
`company_id`. Without it, Stage B protects the table name but nothing protects
the behaviour.

**PR C3.** Reprocess the two quarantined `manual_inbound_messages` rows once the
table exists, so the backlog is not silently lost.

*Risk:* low. *Done when:* a manual inbound message produces an operation event,
and the test fails if the table is missing.

### Stage D — The ordinary outstanding changes

**PR D1 — the two missing constraints (N-8, N-3).** Forward migrations, each
preceded by its own duplicate check:

- `invoice_export_items (company_id, provider, provider_invoice_guid)` unique
  where the guid is not null. `lib/billing/providerWebhooks.ts:76` already
  assumes this key identifies exactly one row — it selects with `limit(3)` and
  rejects anything else, so it fails closed and never misattributes a webhook.
  But nothing prevents a duplicate, including within one company, and when one
  appears the webhook 500s for every delivery while the provider retries.
- `ux_billing_export_items_source_period` on `billing_export_run_items`, created
  **directly**.

Then close the mechanism, not the instances: `gridex_db1_try_exec` records
failures instead of raising, which is why N-3's index never appeared while the
migration reported success. Constraints and indexes must not be created through
it. Add that to the invariant gate, which already enumerates expected keys.

**PR D2 — the v6 guard (N-4).** Invert `lib/billing/underlayEngine.ts:439` so the
completeness check applies **unless** the snapshot proves it belongs to an older,
explicitly listed schema. Today a snapshot with a null version skips every check,
which is the opposite of failing closed. Add a null-version case to the tests.

**PR D3 — strict parsing (N-6).** `app/api/v1/customer/notifications/read` gets a
strict contract like every other external write surface.

*Risk:* D1 introduces two uniqueness constraints, so both fail on existing
duplicates — run the check queries against production first. D2 may reject
snapshots that pass today; that is the point, but count the affected production
rows and repair them rather than discovering it during a billing run.

### Stage E — Make tenant scoping structural

**PR E1 (N-9).** Route the 66 unscoped `update`/`delete` sites through
`lib/supabase/tenantDb.ts`, with `unscoped()` as the explicit, greppable
exception. Add a ratchet shaped like `check-service-role-tenant-ratchet.cjs`:
freeze the count, let it fall, never rise. Every site is safe today by
derivation — a platform-admin surface, or an id resolved from a tenant-scoped
read. The change makes them safe by construction, which matters because
`service_role` holds `BYPASSRLS` and the database will not catch a mistake.

**PR E2 (F-15 proper).** Move request traffic off `service_role`. While every
request runs as a role with `BYPASSRLS`, the policies on 266 tenant tables are
verified but inert for application traffic. `supabase_privileged_role` already
exists with `rolbypassrls = false`. This is 2 402 call sites across 452 files and
needs its own plan; it does not start before Stage B is done, because typed
clients and a parity check are what make a change that size reviewable.

*Risk:* E1 low and mechanical. E2 high.

### Stage F — Promotion to production

Follow `TENANT_REMEDIATION_PRODUCTION_RUNBOOK_2026-09-02.md` unchanged, with two
amendments now that Stage A exists:

- Its §0 blocker ("replay the repository onto a shadow database and diff") is no
  longer a manual step. It is Stage A plus `db:parity` from Stage B, run against
  production.
- Its §5 permission verification matrix stays mandatory and manual. F-17 and
  F-18 were both silent breaks that no test suite caught — one gave a tenant
  access to another's documents, the other denied every ordinary user their
  shared masterdata. For each company, one real user per role, before and after.

Application first, then migrations, in the runbook's risk order. The reason is
concrete: `100000` adds `electricity_suppliers_own_requires_company`, and the
**old** `setOwnElectricitySupplier` can set `is_own_supplier` on a row with no
company, which that constraint rejects.

---

## 4. Verification — what "done" means per stage

| Stage | Gate |
|---|---|
| A | replay green; `supabase/schema.sql` committed; `npm run db:migrations:check` passes |
| B | `db:parity` against dev empty, or every difference recorded with a reason; `npm run typecheck` passes with `<Database>` in place |
| C | inbound message produces an operation event; the new test fails if the table is absent |
| D | duplicate checks empty in production before applying; billing tests pass including a null-version snapshot |
| E | ratchet at or below its new baseline; `npm run tenant:invariants` passes |
| F | runbook §3 preflight captured, §5 matrix recorded per company, invariant gate green against production |

Standing checks, all currently passing except the one noted:

| Check | State |
|---|---|
| `npm run typecheck` | pass |
| `npx vitest run` | 169 files / 1 066 tests pass |
| `npm run db:migrations:integrity` | pass — 563 files, 467 version groups |
| `npm run tenant:invariants` (live) | pass |
| `npm run tenant:service-role-ratchet` | 2 402 sites / 452 files, at baseline |
| `npm run db:types:check` | **fail** — N-10, fixed by Stage A |

---

## 5. What does not roll back

Every migration is forward-only, so capture what you replace **before** each
step: function bodies before `100000` and `091000`, index definitions before
`090000`, policy definitions before `092000` — the exact queries are in runbook
§6.

Two steps are irreversible. `091000` deletes redundant global company roles and
`093000` backfills `event_scope`. Both are gated on an approved dry run, and a
snapshot should be taken immediately before each.

---

## 6. Decisions that are not mine to make

1. **N-5 — does contact data have one writer or two?** The portal's
   `profile-update` mutates `public.customers` directly. It is correctly
   tenant-scoped and scope-gated either way, so this is a product decision about
   whether the portal stays a read projection. Decide it; do not let it drift.
2. **The two inbound mailboxes that carry no company.** The quarantine makes the
   backlog visible and the receiver-EDIEL-id repair attributed what it could.
   Binding the mailboxes to tenants is a product decision.
3. **`20260902100045_fix_website_poa_scope_and_grid_owner_aliases`** is applied to
   dev and belongs to no repository. It adds `powers_of_attorney.expires_at` and
   a trigger. It is not mine to commit; whoever applied it needs to, or dev keeps
   a column production will never get. Stage B will flag it every run until then.

---

## 7. Out of scope

- **Production parity of the schema itself.** Stage A establishes whether the
  repository reproduces dev. Whether dev reproduces production needs the
  production project, which this session cannot see.
- **Per-message EDIEL business semantics.** Never in scope for this work.
- **The 88 repository migrations applied under a different version** were
  compared by name and by resulting schema objects, not statement by statement.
