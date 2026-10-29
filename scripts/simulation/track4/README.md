# Track 4 simulation harness (T4)

Own local stack, separate from every other track. Base: `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`.
Nothing here requires app changes; all state lives under `SIM_HOME` (default `/home/user/sim-t4/home`).

```
up.sh                      start stack (replay) + app + sink; idempotent
down.sh                    stop everything, verify no T4 container/volume/listener/process remains
run.sh <scenario.mjs>      one run at a time (flock SIM_HOME/run.lock) -> SIM_HOME/runs/<run-id>/
lib/common.sh              ports, paths, guards
runner/run-scenarios.mjs   Node scenario runner (@supabase/ssr, @supabase/supabase-js, fetch, psql)
fixtures/seed.mjs          synthetic tenant fixture (steps FX01-FX06)
fixtures/expected.mjs      independent expected-invoice computation (oracle candidate)
fixtures/flows.mjs         product-entrypoint helpers (prepare, server actions, file GET), row readers
scenarios/billing-invoice-files.mjs   MAIN04.02/.05, BILLNEG01.01-.04, MAIN05.01-.06
counterparties/sink.mjs    loopback sink for every external base URL (nothing is expected to hit it)
```

Ports (override by env): API 55421, DB 55422, shadow 55420, mail 55424 (configured, not started: the replay
script excludes mailpit), app 3104, sink 3194. Project id `gridex-sim-t4`.

## up.sh
1. Copies `supabase/` and `scripts/` of the checkout to `SIM_HOME/stack-src` and patches the **copy**:
   `config.toml` (project id, ports, analytics off) and `scripts/gridex-aud-003-clean-replay.sh` (DB port in two
   places; `T4_KEEP_STACK=1` skips `supabase stop` in its EXIT trap). Diffs: `SIM_HOME/logs/config.diff`,
   `replay-script.diff`. Same patch set as the runner's manual stack. Needs Supabase CLI exactly 2.101.0
   (`SIM_HOME/cli/node_modules/.bin`) and `SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io` (defaulted).
2. Runs the replay (writes `replay-commit`, `replay-at`, empty `applied-migrations.tsv`, `fingerprint.txt`).
   Skipped when the DB is already replayed from HEAD; `SKIP_REPLAY=1` adopts a running stack.
3. Writes `SIM_HOME/env` (mode 600; keys from `supabase status -o env`, random secrets, external URLs -> sink).
4. Creates the automation user (GoTrue admin API + `user_profiles`), `npm run build` (writes `built-commit`;
   `SKIP_BUILD=1` reuses a build of the same commit), `next start` on 3104, sink on 3194.

## Fixture: what is a real entrypoint and what is SQL
| Step | Mechanism | Detail |
|---|---|---|
| FX01 tenants A and B | **SQL** | `companies` rows (active, provider `file_export` env `test`, `invoice_export_enabled`). Product provisions via platform-admin tooling; not exercised. |
| FX02 staff users | **Auth admin API** + **SQL** | Users created with `auth.admin.createUser` (real). `user_profiles`, role `t4_billing_staff` with `billing_underlay.read`/`.export`, `role_permissions`, `company_memberships`, `user_roles` are SQL: `canonical_authenticated_tenant_context` reads exactly these. |
| FX03 customer, site, metering point | **SQL** | Plain INSERTs, product triggers active. |
| FX03 contract (fixed 84.75 öre/kWh + 49.50 SEK/month, 25 %), price snapshot, supply period | **SQL, superuser, triggers bypassed** | `customer_contracts` signed/active rows can only be created by the product's signature + activation commands (published offer -> `gridex_create_internal_customer_contract_v1` -> signing with catalog/legal-bundle refs and evidence -> `activate_customer_supply_v1`); there is no import command (the trigger message `customer_contract_signed_insert_requires_import_command` names none). The fixture inserts as local `supabase_admin` with `session_replication_role=replica` (triggers and FK checks off, CHECKs on). Verifies nothing about contract creation, signing, activation, quote/publication binding or snapshot guards; catalog and evidence reference columns stay NULL, signature evidence is synthetic, snapshot hash computed as the integrity trigger does. |
| FX04 READY underlays | **API** (default `engine`) | `POST /api/internal/billing/generate-underlay` for 2026-09/08/07, then verifies validated/ready underlay **with** a `gridex_billing_source.underlay_bindings` row. It does not create the source; fails with a diagnosis (underlay rows, block reason, source facts) until the chain below exists. `T4_UNDERLAY_MODE=direct` inserts underlays by SQL: prepare then ALWAYS fails (`billing_finalized_source_basis_required`) because only the engine writes the binding; kept for debugging only. |
| FX05 expected amounts | compute | `fixtures/expected.mjs`. |
| FX06 sessions | **API** | Password sign-in through `@supabase/ssr` (same cookie format as the app), active-company cookie `gridex_admin_selected_company_id`; checks `canonical_authenticated_tenant_context` and `GET /admin/billing` = 200. |

Scenario steps use only product entrypoints for the action under test:
`POST /api/internal/invoice-exports/create` (prepare), server actions `approveAndSendReadyInvoicesAction` and
`createInvoiceFileAction` (posted as a no-JS multipart form with the `$ACTION_ID_<id>` field; the id is read from the
rendered `/admin/billing` form, override `T4_ACTION_ID_APPROVE` / `T4_ACTION_ID_CREATE_FILE`),
`GET /admin/billing/invoice-files/<id>`, `POST /api/internal/billing/generate-underlay`. SQL is used for reads
(counts, rows) and for the negative UPDATE probes (BILLNEG01.03/.04a). No step uses a browser/Playwright.

## Billing source chain (what prepare really requires; traced from the error code backwards)
`prepare` -> `gridex_create_invoice_review_draft_v1` / `gridex_create_billing_export_run` ->
`gridex_billing_source.require_underlay_v1(company, underlay)` raises `billing_finalized_source_basis_required` unless:
1. `gridex_billing_source.underlay_bindings` has a row for the underlay with `exact_total_kwh = billing_underlays.total_kwh`
   and a matching `source_basis_hash` (written only by the underlay engine), and `correction_journal` is empty;
2. `ediel_require_invoice_source_copies_available_v1` passes;
3. `gridex_received_sources.billing_supply_basis_v1(company, supply_period, start, end)` equals the supply basis stored in the
   binding (else `billing_finalized_supply_basis_changed`). The FX03 supply period has none of what that needs:
   `market_start_at`/`market_state_version`/`source_message_id`, `metadata.sourceGroundId`, a row in
   `gridex_received_sources.supply_source_transitions` (payload hash + resulting_states) for an inbound Z04, accepted
   `validation_assessments`, a `regulated_supply_ground_versions` row (legal decision, registry version, source sha), and
   `gridex_ediel_inbound_context.require_v1` with `legalActorId` = ground actor and role `electricity_supplier`
   (alternatively a `normal_switch_confirmations` row);
4. each billed `normalized_metering_values` row passes `gridex_billing_source.basis_v1` (`gridex_read_billing_source_values_v1`): an
   inbound `ediel_messages` UTILTS E30/E66 (E66: application ref `23-DDQ-E66-S|T`, product `8716867000030`, quantity type 136, kWh,
   standard decimals), a `gridex_ediel_source_rules.receipts` row whose `payload_sha256` matches the message, a current
   `metering_values` row (`source_ediel_message_id`, `source_transaction_reference`, identical `raw_payload` with
   `consumptionContract` = `gridex_utilts_binding.stored_contract_v1`) and an identical normalized row.
`pricing_run_locked` in the log is the retry of `gridex_persist_pricing_run` after the first pricing run was already locked.
Minimal genuine path: platform sends Z03 for a switch request -> counterparty answers Z04 -> activation (supply graph) -> counterparty
sends UTILTS E66 per day -> inbound pipeline (`POST /api/internal/inbound-mail/cron`, IMAP mailbox needed; the replay excludes mailpit,
so a local GreenMail/IMAP+SMTP counterparty is required) -> `generate-underlay`. This is the reality-world chain
(`scripts/reality/chain-f-invoice.test.ts` on claude/gifted-hamilton-vss1hj) and the Ediel track's harness; not built here. A
trigger-bypassed contract (FX03) is not the blocker, the supply period and the messages are.

Every step records the Postgres ERROR/FATAL lines logged while it ran (`evidence.dbErrors`, via `docker logs` of the DB container),
because the product masks RPC errors (`lib/billing/invoiceReviewPrepare.ts:454`).

## Expected amounts and rounding (ORACLE CANDIDATE)
Rule found in code: energy ex VAT = `Math.round(kWh x price x 100)/100` (`lib/pricing/basePriceCalculator.ts`); VAT per
line = round(line ex VAT x 0.25) (`pricePreviewBuilder.ts`, `priceComponentCalculator.ts`); totals = sums rounded
(`pricePreviewBuilder.ts`). Month 2026-09: energy 370.54 + VAT 92.64 (exact half-öre tie, rounds up), fee 49.50 + VAT
12.38, total 420.04 + 105.02 = **525.06**. VAT on the total would give 105.01 / 525.05 - the steps assert the per-line
exact-decimal value and record the other variants as findings. Nothing in the repo states the tie/VAT rule as binding.

## Reports (`SIM_HOME/runs/<run-id>/`)
`run.log`, `run.json` (exit code, start/finish, commits, sink request count), `report-<scenario>.json` (per step:
status passed|failed|skipped + reason, HTTP status/bytes/sha256/location of every request, DB row counts before/after/delta
for tenant A, values, findings, file sha256s; top-level `skipped` list and vitest-style `vitest` counters),
`summary.json`. Exit: 0 ok, 1 a step failed, 2 usage, 3 stack not ready, 4 another run active.
MAIN05.05/.06 depend only on FX06 (no fixture data); MAIN05.05b/.04 need a real file. `run.sh` accepts a path relative to track4/ (`scenarios/x.mjs`). Replay/build reuse accepts a HEAD that differs from `replay-commit`/`built-commit` only under `scripts/simulation/track4/`; adopting a stack never overwrites `replay-commit` (records `T4_BASE_COMMIT` if absent).
`--only ID[,ID]` runs the fixture steps plus the step and its `needs`.

## Origins
- `stableJson`/`rowsSha256` in `fixtures/flows.mjs`: logic copied from `lib/billing/invoiceFileExport.ts` at the base
  commit (same repository), to recompute `rows_sha256`.
- User creation via GoTrue admin API + `user_profiles` upsert in `up.sh`: pattern from
  `claude/gifted-hamilton-vss1hj` @ `2711f86287fd77da12e48aa5fd26a695f4a51426`, `scripts/reality/up.sh` (step 4).
- Role/permission model: read from `supabase/migrations/20261014004020_admin_api_current_context_projection.sql`.
- Patch set for config/replay script: taken from the runner's `config.diff` / `replay-script.diff`.

## Open / unverified (authoring session had no stack access; all SQL fixture inserts are untested)
- Constraint/trigger errors in FX01-FX04 are possible on a run: fix as HARNESS defects.
- Real meter values need a genuine inbound UTILTS E66 (`gridex_read_billing_source_values_v1` verifies the Ediel
  message, stored consumer contract and rule-pack basis): TODO T4-FX04b, blocks `T4_UNDERLAY_MODE=engine` and BILLNEG01.04b.
- `file_export` is not `selectable` in `invoice_provider_catalog`; if a trigger/guard refuses it use `T4_INVOICE_PROVIDER=nordfin`
  (needs a `billing_provider_connections` row with `settings.client_id`, not seeded yet).
- Server-action post via `$ACTION_ID_` and Origin handling in Next 16.4.2 is unverified; the approve form exists only while
  something is approvable.
- Assertions encode my reading of each scenario ID, not the register oracle.
