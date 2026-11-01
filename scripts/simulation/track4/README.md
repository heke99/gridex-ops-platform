# Track 4 simulation harness (T4)

Current source boundary: the runner's report custody and canonical selection have bounded component controls.
The inherited lifecycle below is **not admitted for execution**: fixed/shared defaults, broad teardown, source/build/schema and
producer identity still require separate correction and coordinator resource admission. XML/JSON semantic assertions, actual
invoice/snapshot lineage, BILLNEG01.04b and the absent BILLNEG01.05 remain unmet. Source adoption and these controls add no scenario PASS.

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
   `applied-migrations.tsv`. `SKIP_REPLAY=1` is refused because those legacy markers do not establish actual backend ownership.
   `db-url` (one line, local defaults) is written whenever the stack is up; `built-commit` after a successful build.
2. Writes `SIM_HOME/env` (mode 600; keys from `supabase status -o env`, random secrets, external URLs -> sink, mail/Ediel keys).
3. GreenMail + local CA, automation user, `npm run build` (`SKIP_BUILD=1` requires exact private source/environment/output build evidence;
   legacy `built-commit` alone is insufficient), next start on 3104, sink on 3194. The retained app/mail process lifecycle remains unqualified;
   an env hash or a successful build does not bind an existing process to its launched build.

`down.sh` stops app, sink, GreenMail, the grid-owner process and the Supabase stack (`supabase stop --no-backup` from the run directory,
which also removes the volumes) and fails if a container, volume, port or process remains. `T4_KEEP_DB=1` keeps the Supabase stack.

`run.sh <scenario>` needs `SIM_REPORT=<path>` (refuses otherwise) and writes the merged JSON report there: scenario ID per step
(`scenarioId`; fixture steps are `FIXTURE`), status per step, vitest-style counts, `skipped` list. It creates `SIM_HOME/run.lock`
atomically (noclobber; PID, start time, command), removes it on exit and refuses if it exists; `chain.sh` obeys the same lock.

## Fixture: what is a real entrypoint and what is SQL

The continuation uses two distinct same-tenant Auth actors (`A` and `A2`) for
both concurrency bursts; `B` remains the separate-tenant negative actor. FX06
checks their actual signed-in identities and canonical tenant permissions before
the scenarios. Successful approval contenders must all return the exact billing
action redirect with `failed=0`, `sent=0`, `mode=file` and canonical `approved=0|1`.
An authentication/permission failure or an unrelated redirect cannot count as a
successful loser. Concurrency is bounded to 2–100 requests and alternates actors.
Every prepare response must also be HTTP200 with the actual prepare-only envelope,
the requested month, no failed items/errors, and one prepared or reused underlay.
The stored approval must name a qualified actor and carry an actual timestamp and
review hash; the single approval event is bound to that actor and hash.

MAIN05.02 and BILLNEG01.03 compare the complete frozen file projection and two
protected `nordfin_xml` downloads across replay, including exact raw bytes and a
separate body SHA256. BILLNEG01.03 checks again after its mutation probes. These
checks strengthen harness rejection; they provide no new runtime acceptance,
independent money/cohort qualification or permission to start lifecycle scripts.
The original MAIN February2027/2688-interval/1809.51 oracle remains separate from
this inherited July–September synthetic fixture. BILLNEG01.04b is still TODO and
BILLNEG01.05 remains missing/HOLD.

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
The wrapper exclusively creates a new private0700 run directory, refusing a stale directory or symlinked parent before writing its log.
`run.log` and `run.json` (exit code, start/finish, commits, sink request count) stay at the run-directory root.
The runner receives the separate fresh `reports/` subdirectory for `report-<scenario>.json` (per step:
status passed|failed|skipped + reason, HTTP status/bytes/sha256/location of every request, DB row counts before/after/delta
for tenant A, values, findings, file sha256s; top-level `skipped` list and vitest-style `vitest` counters),
`summary.json`. Fixture-local `chain.log`/`chain-vitest.json`, when used, also reside under `reports/`.
The merged report remains at the admitted `SIM_REPORT` path. Exit: 0 executed steps passed, 1 a step/admission/publication failed,
2 usage, 3 stack not ready, 4 another run active; the wrapper preserves the runner's pipeline exit status.
MAIN05.06 depends only on FX06. The unknown/malformed MAIN05.05 step has that narrow dependency, but selecting its canonical ID also
includes MAIN05.05b and its real-file prerequisites. `run.sh` accepts a path relative to track4/ (`scenarios/x.mjs`). The inherited replay/build reuse policy above is not current runtime qualification.
`--only ID[,ID]` accepts exact declared canonical T4 IDs, includes all their approved substeps and recursive dependencies, and retains
the fixture sequence. Duplicate/empty/unknown IDs, requested IDs with no implementation, unknown substeps, duplicate steps and invalid
dependency graphs fail before fixture execution. Dependencies must precede the step in the same scenario file; no prefix matching is used.
BILLNEG01.04 selects both .04a and TODO .04b; the TODO remains skipped/unmet. Requesting absent BILLNEG01.05 fails before workload.
An unfiltered report covers only declared steps: `missingScenarioIds` explicitly lists absent canonical IDs and `scope` is
`DECLARED_STEPS_ONLY_NOT_CAMPAIGN_ACCEPTANCE`. Exit0 still permits explicit skipped/TODO steps and cannot qualify their parent scenario.

The actual Node runner requires canonical absolute `T4_SIM_HOME`, `--out` and `--report` paths. The home must be owned/private0700;
all output paths must be below it, with existing owned directory parents and no symlink components. The runner's `--out` directory
may already exist only when empty; the wrapper's log and metadata are outside it. Any existing merged/per-scenario/summary destination, legacy `.tmp` or `.t4-reserved` marker is
refused before fixtures. Reservations for every output are exclusive; temporary files have unpredictable same-directory names and
mode0600. Writes use held file descriptors, and atomic hard-link publication refuses competing destinations instead of replacing them.
Linux directory descriptors keep writes within admitted directories; directory replacement is refused. Existing originals and foreign
replacement entries are preserved. Partial new reports from a failed publication remain evidence; do not rerun business calls blindly.
These output/layout controls do not admit the lifecycle, backend, schema or a real business run. `__tests__/simulation-track4-runner-contract.test.ts`
tests both the actual runner and the whole common.sh/run.sh/tee/runner chain with synthetic noop steps, denied network and fake tools only.

## JSON/XML download oracle (source correction; runtime remains unqualified)
`MAIN05.01` requires the installed Next action's 303 redirect to the same billing page/month and one file UUID.
Its protected JSON download must have the exact attachment identity, JSON/UTF8 MIME, six-field
`gridex_invoice_file_v1` envelope and all invoice rows equal to the native stored file. The complete file row is
copied and recursively frozen for later comparisons; a gross-amount substring or generic 200 cannot qualify.

`MAIN05.03` explicitly requests `?format=nordfin_xml` twice on the existing file provider, including `file_export`.
Default CSV is an auxiliary repeat check and cannot substitute for XML. Both XML responses require the protected
attachment identity, bounded fatal UTF8 decoding, XML 1.0 declaration, no DTD/entity declarations or unbound entities,
and the exact Nordfin root/cardinalities/fields projected from every frozen invoice row. Text escaping is decoded
once; customer identifiers, dates, amounts, specification lines, facilities and optional contract/reconciliation facts
are compared. Both raw byte buffers and their hashes must also match. XML has no invented file UUID/currency fields.

The durable `__tests__/simulation-track4-file-oracle-contract.test.ts` executes these actual registered callbacks with
controlled HTTP/SQL adapters and real canonical pure formatters. These are component serialization proofs, not new
campaign PASS results, an independent money/cohort oracle, XSD certification or Nordfin receiver acceptance. Actual
auth/server-action integration, provider connection, schema/producer, assigned lifecycle and missing/TODO business
steps remain separate unmet runtime/acceptance gates. No provider relabeling or fixture money change is authorized.

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

Negative file-download callbacks also bind the denial body to the installed route contract:
`404`, plain text, exact UTF-8 bytes `Fakturafilen hittades inte.`, no download
or redirect header. Unknown IDs, malformed IDs and other-tenant access are checked
for default, XML, JSON, CSV and XLSX requests. The other-tenant probe first validates
an authenticated owner XML download against the frozen file snapshot, so a missing
file or broken owner download cannot stand in for tenant isolation. These callback
regressions are component evidence; the qualified runtime and original MAIN cohort
requirements above still apply.

Startup build evidence is separate from runtime admission. A nonzero `npm run build`
now stops startup even if the failed command left `BUILD_ID`. A successful build
captures a private `build-evidence.json` binding the committed clean checkout,
private environment-file, ignored dotenv and ambient process-environment hashes,
and every regular `.next` output file except its
cache. `SKIP_BUILD=1` requires that exact evidence and refuses legacy markers,
changed source/environment/output or symlinked outputs. This conservative output
check may require a fresh build after runtime-generated output changes.

`SKIP_REPLAY=1` is refused on the retained `up.sh` path: its old commit/fingerprint
markers never established actual backend ownership or current producer admission.
Use the separately qualified preparation/runner profile for backend reuse. These
source corrections do not qualify the remaining legacy mail/app lifecycle,
provision a backend or authorize a local stack on an under-capacity host.
