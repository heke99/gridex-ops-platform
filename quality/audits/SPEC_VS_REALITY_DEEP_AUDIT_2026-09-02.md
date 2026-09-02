# Deep audit — what the code is supposed to do, and where it stops doing it

Date: 2026-09-02
Database: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`), PostgreSQL 17.6
Scope: intent first, then code and database measured against it.
No production code or schema was changed by this audit.

---

## 1. Intent: eight testable invariants

Taken from `.agent-memory/domain-model.md`, `canonical-architecture.md`,
`canonical-flows.md` and `decisions.md`, reduced to statements that can be
falsified against the repository and the live schema.

| | Invariant | Source |
|---|---|---|
| A | An external client never selects its tenant. `company_id` is derived from the authenticated identity, never read from the request. | canonical-architecture; ADR-002 |
| B | A public DTO never exposes internal pricing, publication, portal-identity or provider ids. | ADR-005 |
| C | Every external write is validated by a strict contract; unknown fields are rejected, not ignored. | canonical-architecture |
| D | Only `activate_customer_supply_v1` may complete a supplier switch. | ADR-004 |
| E | The customer portal is a read projection, not a competing state machine. | canonical-architecture |
| F | Billing resolves only the locked customer snapshot. An incomplete v6 snapshot fails closed. | canonical-flows |
| G | Pricing preview, settlement and invoice are not interchangeable. | canonical-flows |
| H | A customer number is permanent per tenant. | domain-model |

## 2. Result

| | Verdict | Evidence |
|---|---|---|
| A | **Holds** | No route under `app/api/` reads a client-supplied `company_id`; every portal and partner query carries `.eq('company_id', …)` from the authenticated context. |
| B | **Holds** | `lib/customer-portal/publicDto.ts` allowlists every projection. The one pass-through response, `move-out`, returns the RPC's own `jsonb_build_object`, which emits only `*_reference` values — verified by reading `gridex_submit_customer_move_out_v1` in the live database. |
| C | **Holds, one deviation** | Strict contracts in `customerSyncContract.ts`, `customerApplicationSchemas.ts`, `customerEvents.ts`, `parseCustomerProfileUpdateRequest`. `app/api/v1/customer/notifications/read/route.ts` uses non-strict `readJsonObject` and silently ignores unknown fields (N-6). |
| D | **Holds** | Exactly one caller: `lib/ediel/flows/inboundBusinessStateMachineLegacy.ts:168`. |
| E | **Holds in substance, one deviation** | Of sixteen portal routes, twelve are read-only and three of the four writes are mediated (RPC, sync contract, notification state). `profile-update` mutates `public.customers` directly (N-5). |
| F | **Holds, one gap** | Runtime guard `lib/billing/underlayEngine.ts:439` throws on an incomplete v6 snapshot; database trigger `invoice_export_items_require_locked_pricing_run` is the backstop. The guard is conditional on the snapshot declaring its own version (N-4). |
| G | **Holds** | The discriminator is `pricing_runs.status = 'locked'`, enforced in `invoiceApprovedDispatch.ts:99`, `invoiceExportCore.ts:94`, `invoiceTestCenterDispatch.ts:144`, and at the database by the trigger above. |
| H | **Holds** | `gridex_assign_customer_number` on insert, `gridex_protect_customer_number` on update (raises `customer_number_is_permanent`), and `customers_company_customer_number_uk`. All three present in the live database. |

Where it actually falls is not in these invariants. It is in the gap between
the repository and the database.

---

## 3. Findings

### N-1 — Manual inbound email ingestion always fails. Confirmed, high.

`lib/inbound-mail/manualInboundIngestion.ts:207` upserts into
`public.inbound_operation_events` and ends with `if (error) throw error`.
**That table does not exist in the database.**

```sql
select to_regclass('public.inbound_operation_events');  -- null
```

The table is created by `supabase/migrations/20260824190000_gridex_inbound_operations_foundation.sql`,
which was never applied: the name `gridex_inbound_operations_foundation` does not
appear in `supabase_migrations.schema_migrations`.

Failure path, in order: the raw email is inserted into `manual_inbound_messages`,
correlation succeeds and is written back (line 328), then `upsertInboundOperationEvent`
at line 339 throws `PGRST205`. Both entry points are affected —
`app/api/webhooks/manual-inbound/route.ts` and `lib/inbound-mail/manualMailboxPoller.ts`.
The webhook returns an error to the sending provider, which will retry into the
same failure.

Consistent with that, `manual_inbound_messages` holds two rows, both written
within 0.4 s of each other on 2026-08-30, and nothing since.

No test covers this path, which is why 1 066 passing tests did not catch it.

**Business impact:** inbound grid-owner and counterparty email is accepted and
then dropped on the floor. Nothing downstream — no case, no operation, no
tenant-visible work item — is created from it.

**Fix:** apply the existing migration. No code change is needed; the repository
is already correct.

### N-2 — The repository and the database are two divergent lineages. Confirmed, high.

| Measure | Value |
|---|---|
| Migration files in the repository | 564 |
| Migrations recorded as applied | 258 |
| Versions present in both | 136 |
| Applied names with no repository file | 35 |
| Repository names never applied under any version | 241 |
| Repository names applied under a *different* version | 88 |

The schema has largely converged despite this, which is why the divergence has
not been noticed. Of 276 unique indexes the repository declares and never drops,
248 exist; the 28 that do not are almost entirely superseded renames
(`…_v1b_uidx`, `…_canonical_uidx`, `customers_company_id_id_uidx` versus the
`customers_id_company_uk` that replaced it). Of 281 relations and 110 RPCs the
application references, 279 and 110 respectively exist.

But convergence by coincidence is not a control. It is exactly this drift that
hides N-1: one missing table out of 281 references, and it happens to be on the
inbound path. `npm run db:migrations:integrity` checks the repository against
its own manifest and cannot see this class of divergence at all.

This extends §0 of `TENANT_REMEDIATION_PRODUCTION_RUNBOOK_2026-09-02.md`, which
recorded two individual uncommitted migrations. The scale is larger than that
document assumed.

### N-3 — A billing dedupe guard was never created, and its failure was silent. Confirmed, medium.

`ux_billing_export_items_source_period` — unique on
`(company_id, export_run_id, source_type, source_id, period_start, period_end)`
for `billing_export_run_items` — does not exist.

It is declared through `gridex_db1_try_exec('dedupe_index', …)` in
`20260522_db1_schema_repair_backfill_foundation.sql:2089`, a helper that catches
and records failures rather than raising. So the index simply never appeared and
the migration reported success.

`billing_export_run_items_company_idempotency_uidx` still guards the
idempotency-key path, so the same *keyed* export cannot duplicate. Two export
runs over the same source and period with different keys can.

### N-4 — The v6 fail-closed guard is conditional on the snapshot's own claim. Confirmed, low.

`lib/billing/underlayEngine.ts:439` applies the completeness check only when
`snapshot_schema_version === 'gridex_contract_pricing_v6_selection'`. A snapshot
whose version is null, or an older value, skips every check — missing price
option, invoice method, fixed-area identity and component arrays all pass.

The intent in `canonical-flows.md` is that billing fails closed on an incomplete
snapshot. As written it fails closed only on an incomplete snapshot that
correctly identifies itself as v6.

### N-5 — The portal mutates canonical customer rows directly. Confirmed, low.

`app/api/v1/customer/profile-update/route.ts:77` updates `public.customers`
in place. Tenant scoping is correct (`company_id` **and** `customer_id` on both
the read and the write) and the route is gated on `customer_contact.write`, so
this is not an isolation defect. It is a deviation from "read projection, not a
competing state machine": contact data now has two writers.

### N-6 — Non-strict request parsing on one portal route. Confirmed, low.

`app/api/v1/customer/notifications/read/route.ts` parses with `readJsonObject`
and ignores unknown fields instead of rejecting them, unlike every other
external write surface.

---

## 4. Corrections to earlier records

- The locked-pricing control **is** in the repository, at
  `supabase/migrations/20260820113132_invoice_export_locked_pricing_guard.sql`.
  An earlier note in this session treated it as a third parity gap; that came
  from grepping file *contents* for a string that only appears in the *filename*.
  It is applied to the database under version `20260820113227` — a renumbering,
  which is N-2, not a missing control.

---

---

## 5. Second pass — systematic drift sweeps

The first pass found `inbound_operation_events` by hand. The obvious question is
whether it is one of many. These sweeps answer that.

### What came back clean

| Sweep | Coverage | Result |
|---|---|---|
| RPC argument names | all 110 `.rpc(name, {…})` call sites in `app/` and `lib/`, matched against `pg_proc.proargnames` including overloads | **0 mismatches.** Every call's named arguments are a subset of some real overload. |
| Column references | 191 relations, every literal `.select('a,b,c')` list | **0 missing columns.** |
| Cross-tenant rows | 451 single-column foreign keys where both child and parent carry `company_id` | **0 rows** where the child's tenant differs from the parent's. |
| `NOT VALID` foreign keys | whole database | **none.** |

The third row is the direct answer to "is every customer consistent": across the
whole graph — customer, site, metering point, contract, supply period, underlay,
pricing run, invoice — no row references a parent belonging to another tenant.

The fourth row also closes a stale entry: `current-task.md` recorded 32 orphan
rows blocking the composite keys on `ediel_message_intents` and
`route_decision_logs`. Both constraints are now present and validated; the data
cleanup removed the orphans.

Caveat on coverage: the column sweep skips `select()` lists containing PostgREST
embeds or template literals, so it is a strong sample rather than a proof.

### N-7 — The Supabase client is untyped, so nothing checks any of this at build time. Medium.

`lib/supabase/service.ts:6` calls `createClient(url, serviceRoleKey, …)` with no
`Database` type parameter. Without it, `.from()`, `.select()` and `.rpc()` accept
any string. `npm run typecheck` therefore cannot fail on a table that does not
exist, a column that was renamed, or an RPC argument that was dropped.

This is the structural reason N-1 shipped: the code was correct against the
repository's migrations and wrong against the database, and no gate compared the
two. The sweeps above are that comparison run by hand; generating
`Database` types from the live schema and passing them to `createClient` would
make the compiler run it on every build.

### N-8 — The billing webhook resolves a tenant on a column with no uniqueness. Medium.

`lib/billing/providerWebhooks.ts:76` derives the tenant for an inbound provider
webhook by looking up `invoice_export_items` on `(provider, provider_invoice_guid)`.
`provider_invoice_guid` carries **no unique index** — not globally, and not per
company. The four unique indexes on that table cover `idempotency_key`,
`provider_request_id`, `provider_idempotency_key` and `provider_invoice_id`.

The code compensates: it selects with `limit(3)` and rejects anything other than
exactly one match, so it fails closed and never attributes a webhook to the wrong
tenant. That is the right behaviour and this is not an isolation defect. But
nothing prevents two rows sharing a guid — including two rows in the *same*
company — and when that happens the webhook returns 500 for every delivery, with
the provider retrying into the same failure. The tenant-resolution key should
carry the constraint the code already assumes.

### N-9 — 66 writes to tenant tables carry no tenant predicate. Low, defence in depth.

Across `app/` and `lib/`, 66 `.update()` or `.delete()` calls on tables classified
`tenant` filter by id alone. Every one examined is safe by derivation — either it
sits behind `requirePlatformAdminActionAccess` on a deliberately cross-tenant
platform surface, or it updates a row id that came from an earlier tenant-scoped
read (`app/api/admin/customer-documents/relations/route.ts` is the pattern: it
calls `loadCustomerTenantContext` first, then queries by `customer_id` alone,
which the composite foreign keys make sufficient).

So this is not an exploitable hole. It is that the guarantee rests on each call
site's history rather than on the call itself, and `service_role` holds
`BYPASSRLS`, so the database will not catch a mistake. `lib/supabase/tenantDb.ts`
exists to make the predicate structural; these are the call sites it has not
reached.

(The same sweep found 203 unscoped *reads*; only one is in a request-handling
route, and it is the guarded pattern described above.)

### N-10 — The generated-types gate compares a hash, not a schema, and is red. Confirmed, medium.

`scripts/check-supabase-generated-types.cjs` asserts three things: that
`supabase/database.types.ts` still hashes to the value in
`scripts/supabase-types-manifest.json`, that the newest migration *filename*
matches the manifest, and that two specific fields are nullable. It never
connects to a database. A types file regenerated from the wrong project passes as
long as the manifest is updated alongside it.

It is currently failing, and therefore so is `db:migrations:check` and the CI job
that calls it:

```
- migration tail changed (20260902100500_close_remaining_advisor_hygiene.sql);
  regenerate Supabase types and update the manifest
```

This is not new to this branch. The manifest records
`20260901084000_harden_gridex_point_to_grid_area_search_path.sql` as the tail,
while the repository tail was already `20260902094600_fix_canonical_transition_request_hash_rewrite.sql`
before the first migration on this branch. Main is red today.

The types file is also stale in the way that matters: it declares
`inbound_operation_events` and `customer_profiles`, and neither exists in the
database — 545 typed relations against 661 in `gridex-ops-dev`.

One detail is worth keeping: the manifest's `generated_with` reads
`supabase-cli-2.101.0-clean-replay`. The correct procedure — replay the
repository into a clean database, generate types from that — was already
performed once. Its output was used for types and then discarded instead of being
diffed against the database it describes. `MASTER_REMEDIATION_PLAN_2026-09-02.md` stage A
turns that one-off into the standing artifact.



## 6. What was not covered

- Per-message EDIEL business semantics.
- Whether the development database reflects production. No production project
  is visible to this session.
- The 88 repository migrations applied under a different version were compared
  by name and by resulting schema objects, not statement by statement.
