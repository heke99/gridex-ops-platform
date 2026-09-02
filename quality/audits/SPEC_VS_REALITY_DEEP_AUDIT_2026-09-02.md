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

## 5. What was not covered

- Per-message EDIEL business semantics.
- Whether the development database reflects production. No production project
  is visible to this session.
- The 88 repository migrations applied under a different version were compared
  by name and by resulting schema objects, not statement by statement.
