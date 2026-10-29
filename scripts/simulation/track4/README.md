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
| FX03 customer, site, metering point, contract (fixed 84.75 öre/kWh + 49.50 SEK/month, 25 %), price snapshot, supply period | **SQL** | Product creates them through website application / signing / Ediel switch / contract flows. Triggers (quote binding, canonical publication binding, contract state machine, customer chain) fire on these inserts; the snapshot hash is filled by the product trigger. Verifies nothing about onboarding or contract creation. |
| FX04 meter values -> READY underlay | **SQL (default)** | Underlays inserted as `validated`/`ready` with `total_kwh` (3 months: main 2026-09 = 437.215 kWh, 2026-08 = 120.5, 2026-07 = 310). Bypasses meter-value intake and `generateBillingUnderlaysForMonth`, so it verifies neither. `T4_UNDERLAY_MODE=engine` calls the real `POST /api/internal/billing/generate-underlay`, but only works once qualified meter values exist (see Open). |
| FX05 expected amounts | compute | `fixtures/expected.mjs`. |
| FX06 sessions | **API** | Password sign-in through `@supabase/ssr` (same cookie format as the app), active-company cookie `gridex_admin_selected_company_id`; checks `canonical_authenticated_tenant_context` and `GET /admin/billing` = 200. |

Scenario steps use only product entrypoints for the action under test:
`POST /api/internal/invoice-exports/create` (prepare), server actions `approveAndSendReadyInvoicesAction` and
`createInvoiceFileAction` (posted as a no-JS multipart form with the `$ACTION_ID_<id>` field; the id is read from the
rendered `/admin/billing` form, override `T4_ACTION_ID_APPROVE` / `T4_ACTION_ID_CREATE_FILE`),
`GET /admin/billing/invoice-files/<id>`, `POST /api/internal/billing/generate-underlay`. SQL is used for reads
(counts, rows) and for the negative UPDATE probes (BILLNEG01.03/.04a). No step uses a browser/Playwright.

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
`--only ID[,ID]` runs the fixture steps plus the step and its `needs`.

## Origins
- `stableJson`/`rowsSha256` in `fixtures/flows.mjs`: logic copied from `lib/billing/invoiceFileExport.ts` at the base
  commit (same repository), to recompute `rows_sha256`.
- User creation via GoTrue admin API + `user_profiles` upsert in `up.sh`: pattern from
  `claude/gifted-hamilton-vss1hj` @ `2711f86287fd77da12e48aa5fd26a695f4a51426`, `scripts/reality/up.sh` (step 4).
- Role/permission model: read from `supabase/migrations/20261014004020_admin_api_current_context_projection.sql`.
- Patch set for config/replay script: taken from the runner's `config.diff` / `replay-script.diff`.

## Open / unverified (authoring session had no stack access; all SQL fixture inserts are untested)
- Constraint/trigger errors in FX01-FX04 are expected on the first run: fix as HARNESS defects.
- Real meter values need a genuine inbound UTILTS E66 (`gridex_read_billing_source_values_v1` verifies the Ediel
  message, stored consumer contract and rule-pack basis): TODO T4-FX04b, blocks `T4_UNDERLAY_MODE=engine` and BILLNEG01.04b.
- `file_export` is not `selectable` in `invoice_provider_catalog`; if a trigger/guard refuses it use `T4_INVOICE_PROVIDER=nordfin`
  (needs a `billing_provider_connections` row with `settings.client_id`, not seeded yet).
- Server-action post via `$ACTION_ID_` and Origin handling in Next 16.4.2 is unverified; the approve form exists only while
  something is approvable.
- Assertions encode my reading of each scenario ID, not the register oracle.
