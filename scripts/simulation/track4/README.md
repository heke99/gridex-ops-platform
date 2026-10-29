# Track 4 simulation harness (T4)

Own local stack, separate from every other track. Base: `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`.
Nothing here requires app changes; all state lives under `SIM_HOME`.

```
up.sh                      start stack (replay) + app + sink; idempotent
down.sh                    stop everything, verify no T4 container/volume/listener/process remains
run.sh <scenario.mjs>      one run at a time (SIM_HOME/run.lock, noclobber) -> SIM_HOME/runs/<run-id>/
lib/common.sh              ports, paths, guards
runner/run-scenarios.mjs   Node scenario runner (@supabase/ssr, @supabase/supabase-js, fetch, psql)
fixtures/seed.mjs          synthetic tenant fixture (steps FX01-FX06)
fixtures/expected.mjs      independent expected-invoice computation (oracle candidate)
fixtures/flows.mjs         product-entrypoint helpers (prepare, server actions, file GET), row readers
scenarios/billing-invoice-files.mjs   MAIN04.02/.05, BILLNEG01.01-.04, MAIN05.01-.06
counterparties/sink.mjs    loopback sink for every external base URL (nothing is expected to hit it)
```

Contract: `.claude/agents/sim-builder.md` ("Spårets harness: kontrakt", main c0a7060b1).
Ports: Supabase 54321/54322 (and project_id) are fixed by `supabase/config.toml`, which is never modified (one stack per container);
variables only for the app (`T4_APP_PORT`, 3104), the sink (3194) and GreenMail (`T4_SMTPS_PORT` 55425, `T4_IMAPS_PORT` 55426,
`T4_MAIL_API_PORT` 55428). `SIM_HOME` defaults to `$HOME/sim-home/track4`.

## up.sh
1. **New replay** (no `SKIP_REPLAY`): aborts with `BLOCKED: stacken upptagen` if any `supabase_db_` container runs; otherwise, from the
   run directory root, `source scripts/gridex-aud-003-clean-replay.sh; LOCAL_STACK_START_ATTEMPTED=0; cleanup; trap - EXIT;
   set -euo pipefail` (the stack stays up; no own EXIT trap before `source`; no use of the script's variable names; no separate
   `supabase start`; neither config.toml nor the script is copied or patched). Needs Supabase CLI exactly 2.101.0
   (`SIM_HOME/cli/node_modules/.bin`) and `SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io` (defaulted). Only after this replay it writes
   `SIM_HOME/fingerprint` (the script's own `EXPECTED_FINGERPRINT`, already verified by it), `replay-commit`, `replay-at` and an empty
   `applied-migrations.tsv`. `SKIP_REPLAY=1` reuses the running stack and leaves those files untouched (it refuses if `replay-commit` is missing).
   `db-url` (one line, local defaults) is written whenever the stack is up; `built-commit` after a successful build.
2. Writes `SIM_HOME/env` (mode 600; keys from `supabase status -o env`, random secrets, external URLs -> sink, mail/Ediel keys).
3. GreenMail + local CA, automation user, `npm run build` (`SKIP_BUILD=1` reuses a build of the same app commit: HEAD may differ from
   `built-commit` only under `scripts/simulation/track4/`), next start on 3104, sink on 3194; the app restarts when `SIM_HOME/env` changes.

`down.sh` stops app, sink, GreenMail, the grid-owner process and the Supabase stack (`supabase stop --no-backup` from the run directory,
which also removes the volumes) and fails if a container, volume, port or process remains. `T4_KEEP_DB=1` keeps the Supabase stack.

`run.sh <scenario>` needs `SIM_REPORT=<path>` (refuses otherwise) and writes the merged JSON report there: scenario ID per step
(`scenarioId`; fixture steps are `FIXTURE`), status per step, vitest-style counts, `skipped` list. It creates `SIM_HOME/run.lock`
atomically (noclobber; PID, start time, command), removes it on exit and refuses if it exists; `chain.sh` obeys the same lock.

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

## Source chain (FX00, `chain.sh`, `chain/`)
Builds the genuine billing source with a local grid owner and GreenMail, as a vitest run (`chain/t4-source-chain.chain.test.ts`,
config `chain/vitest.chain.config.ts`, output `SIM_HOME/chain.json`, vitest JSON in the run dir). `bash chain.sh` runs it alone
(takes the run lock); `run.sh` runs it as step FX00 unless `chain.json` holds a finished, unused chain (consumed once per run;
`T4_CHAIN_REUSE=1` overrides). A chain takes tens of minutes. The scenario then runs on that tenant (company A = the chain tenant).

| Step | What happens | Entrypoint or substitution |
|---|---|---|
| C0 | shared test Ediel mailbox row points at GreenMail (poll every minute) | SQL (platform configuration) |
| C1 | supplier go-live in the **test lane**: `configureTenant` (company, operator and admin users, legal profile, Ediel identity/roles, grid owner, ACK route) + `publishFixedPriceOffer` (85 öre/kWh, 49 SEK/month, 25 %) + test BRP and PRODAT/UTILTS test routes + invoice provider | product RPCs for offer/legal bundle/publication; the rest **SQL substitution** (no tenant-admin UI driven, no operator console, no production go-live, no certificate directory) |
| C2 | grid owner = vendored simulator as its own process (jiti), talks to the platform only by SMTPS/IMAPS | counterparty |
| C3 | customer, site, metering point, contract draft by SQL; signature through the product's `gridex_prepare/finalize_customer_contract_signature_v1` with the clock at 2026-06-12; power of attorney through the admin writer; signed-agreement confirmation through `processPendingContractConfirmations` | **SQL substitution for the customer** (admin intake is broken on base, claude-track2/004); signing is the real RPC with a dated clock |
| C3b | **dated customer sources for the Z03.** Finding: at a past requested start base qualifies the customer's identity and address only from a signed-contract masterdata declaration (`customer_masterdata_source_held:source_qualified_customer_identity_registered_address_at_requested_time`); `customer_addresses` counts only for the current day. The masterdata and requested-method declarations are archived by one actor and reviewed by a second through the product's `ediel_archive/review_contract_original_source_v1` RPCs (JWT sessions), with receipts signed by a **local synthetic issuer** key registered by SQL (`chain/contractSources.ts`, pattern from `scripts/helpers/ediel-z09fg-composition-inputs-native-producer.ts`). Not verified: real issuer competence and legal review. Other Z03 inputs the base may demand next (signed BRP declaration with registry ground, network registry source) are not built | product RPCs + synthetic issuer |
| C4 | switch request row as the product writes it (`gridex_create_supplier_switch_v1`) evaluated on 2026-06-12, then `prepareAndQueueEdielZ03(environment: test)` | **in-process backend call** (no HTTP entrypoint for a dated switch; today is after the supply start so "now" cannot be real) |
| C5 | cron cadence (fails fast: no outbound Z03 after 3 min, Z03 not sent after 5 min or terminal, grid owner silent 6 min after send, simulator failures, three inbound 5xx; overall 20 min) (inbound mail test lane, Ediel outbox, customer operations) until the grid owner's Z04 activates supply from 2026-07-01; asserts `billing_supply_basis_v1` is non-null | HTTP cron routes + counterparty |
| C6 | grid owner sends 92 daily UTILTS E66 (1 Jul - 30 Sep, 96 quarter-hours, dayProfile) | counterparty |
| C7 | inbound cron receives them | HTTP cron route |
| C8 | issuer history ground per source (`seedUtiltsIssuerHistoryGround`, SYNTHETIC stand-in for EXT-ISSUER-01/EXT-ARCHIVE-02, SQL) and the UTILTS engine run per message through the real admin server action `processEdielOperationalMessageAction` (form post as platform operator, no browser) | SQL for the ground; server action is the real entrypoint |
| C9 | asserts every month has exactly its 96 values per Ediel day and all are billing-eligible with a supply period (no vacuous pass); writes the chain result (company, ids, per-month kWh from the SENT files, terms) | read |

Three billing months from one customer (July, August, September) give each of MAIN04/BILLNEG01.01/BILLNEG01.02 its own underlay, since
prepare/approve act on a whole month. The oracle takes kWh from the files the simulator sent and the terms from the published offer;
FX03 (engine mode) checks that the product's contract carries those terms.

Findings about the base while building this (not worked around, no app change): `lib/operations/switchRequestedMethodPreparation.ts`
and `lib/customers/registeredAddress.ts` do not exist at 1c0c088c (the reference chain calls them: the requested-method derivation
before the Z03 is omitted, the registered-address writer call is removed by the vendor patch), and the inbound-mail cron has no
held-UTILTS resume (so C8 triggers the engine per message). Any of these may make the Z03 builder or the UTILTS engine refuse; the
step then fails with the product's error and `chain.json -> blockers` records it.

Vendored reference code: `chain/vendor/` is generated by `chain/vendor-sync.py` from claude/gifted-hamilton-vss1hj @
2711f86287fd77da12e48aa5fd26a695f4a51426 (live-chain-fixture.ts, live-chain-wire.ts, helpers/reality/inboundProdatWire.ts and
rejectsWire.ts, simulators gridOwner.ts, gridOwnerWire.ts, gridOwnerProfile.ts, smimeUnwrap.ts, edifactMailParts.ts, platformMailbox.ts).
Edits: the PATCHES table in the script (ports/DB URL/`T4_*`, mailbox poll interval, registered-address call removed); imports of
files that exist at base are rewritten to `@/`; `// @ts-nocheck` header. `chain/world.ts` and `chain/t4-source-chain.chain.test.ts`
are adapted from `scripts/helpers/reality/world.ts` and `scripts/reality/chain-f-invoice.test.ts` (createAugustSwitch ported).

GreenMail: container `gx-t4-mail` (`mirror.gcr.io/greenmail/standalone:2.1.3`, digest recorded in `SIM_HOME/mail-image.txt`, override `T4_GREENMAIL_IMAGE`), host ports 55425 SMTPS / 55426 IMAPS /
55428 API on 127.0.0.1, local CA under `SIM_HOME/tls`, both shared Ediel mailboxes claimed with the app's credentials at `up.sh`;
the app environment gained the mail/Ediel keys and `NODE_EXTRA_CA_CERTS`, and `up.sh` restarts the app when `SIM_HOME/env` changes.

## Billing source chain (what prepare really requires)
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

In engine mode (default) the terms are the published offer's (85 öre/kWh, 49.00 SEK/month, 25 %) and the kWh per month are the sums of the E66 files the grid owner sent (`chain.json`), not the 84.75/437.215 example above, which belongs to direct mode.

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

## Open / unverified (authoring session had no stack access; nothing here, including the whole chain, has been run)
- Constraint/trigger errors in FX01-FX04 are possible on a run: fix as HARNESS defects.
- Real meter values need a genuine inbound UTILTS E66 (`gridex_read_billing_source_values_v1` verifies the Ediel
  message, stored consumer contract and rule-pack basis): TODO T4-FX04b, blocks `T4_UNDERLAY_MODE=engine` and BILLNEG01.04b.
- `file_export` is not `selectable` in `invoice_provider_catalog`; if a trigger/guard refuses it use `T4_INVOICE_PROVIDER=nordfin`
  (needs a `billing_provider_connections` row with `settings.client_id`, not seeded yet).
- Server-action post via `$ACTION_ID_` and Origin handling in Next 16.4.2 is unverified; the approve form exists only while
  something is approvable.
- Assertions encode my reading of each scenario ID, not the register oracle.
