# Track 1 findings — run t1r1, worker claude-track1

Campaign 20261029-3f1a8ab1. Session `session_01UHTg8PHokrSpKDSXpT5Py`.
App: campaign base `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`, unchanged.
Harness overlay: `claude/sim-20261029-track1` (`scripts/simulation/track1/`).
Raw logs, env files and run directories stay private under `SIM_HOME`; this
file cites them by path and SHA256 only.

## Environment

| | |
|---|---|
| Container | own cloud container, 4 vCPU, 15 GiB RAM, no swap |
| Docker | 29.9.2, own dockerd |
| Supabase CLI | 2.101.0 (`supabase` shim + `supabase-go`), release tarball sha256 `285877ef…dbf9` |
| Postgres | `supabase/postgres:17.6.1.155` from Docker Hub, digest `sha256:3866d94d…710b` |
| Node | v22.22.0 |
| Stack | `t1-20261029T201808Z-6576e10a`, databaseIdentity `…/pg-sysid-7702186716638527527`, ports 54321/54322, app 3101 |
| Schema | clean replay of base, fingerprint `5168f69b67b1e45168ef327ecf92efec6dc7bcd9dc2cf66f48f4ea96527c782c` (partial identity: selected tables), 0 post-replay migrations |
| Oracle source | `quality/simulation-register/oracles/all-systems-scenarios.safe.json` @ PR930 `d6edd3a3`, sha256 `96518c18…9df3` verified |

## Findings

### 20261029-3f1a8ab1/claude-track1/001 — environment: CLI shim needs `supabase-go`
- Date 2026-10-29, by T1. IDs: all (stack start). Category: miljö.
- Observed: first `up.sh` (env `t1-20261029T200607Z-afcf91e1`) failed in clean replay: "Could not find the `supabase-go` binary". Only the shim had been installed.
- Fix: install both binaries from the verified release tarball; `up.sh` now checks for `supabase-go` and CLI version 2.101.0. State: verifierad rättning (later starts passed).

### 20261029-3f1a8ab1/claude-track1/002 — environment: public.ecr.aws "Data limit exceeded"
- IDs: all (stack start). Category: miljö.
- Observed: second `up.sh` (env `t1-20261029T200705Z-cb3a83e3`): every image pull from `public.ecr.aws` failed with "error from registry: Data limit exceeded".
- Fix: `INTERNAL_IMAGE_REGISTRY=docker.io` (same tags on Docker Hub); image digests recorded in `stack.json`. Replacement step: images come from Docker Hub, not the CLI's default registry; tag-identical, digest-recorded, not cross-checked against ECR digests.
- State: verifierad rättning (third and fourth replays passed). Reported to the coordinator for other tracks.

### 20261029-3f1a8ab1/claude-track1/003 — harness: `next build` OOM in type-check worker
- IDs: all (app build). Category: testharness.
- Observed: third `up.sh` (env `t1-20261029T200827Z-7e2c4ea1`): replay PASS in 220 s, then `next build` failed after ~230 s with "JavaScript heap out of memory" / "Failed to type check". The repo's build script raises the heap only for the main process.
- Fix: `NODE_OPTIONS=--max-old-space-size=6144` for the build. Fourth `up.sh` built in 303 s. Stack of attempt 3 removed by `down.sh` (cleanup.json clean: 0 containers, 0 volumes, 0 app processes).
- Not a product claim: the production build environment is not observed here.

### 20261029-3f1a8ab1/claude-track1/004 — harness (under diagnosis): Z04a supply period without contract
- IDs: MAIN03.01–.05 (fixture). Category: ännu obekräftad (fixture vs product).
- Command: `run.sh scenarios/main03.test.ts main03` → run `20261029T202904Z-main03`, exit 1, 22.2 s wall; `report.json` sha256 `8ea9ec12…7f22`, `run.log` sha256 `e052c9fd…b056`.
- Observed: fixture aborted before any scenario step (5/5 tests skipped): `fixture_supply_period_contract_unset:null`. After PRODAT Z04 (assigned supply, profile `PRODAT:Z04:A:26.A:r3`) and `processInboundEdielMessage`, exactly one `customer_supply_periods` row exists but `contract_id` is null; the underlay store requires the contract link.
- Fixture timings: tenant + contract + regulated ground 6 991 ms; assigned-supply activation 3 659 ms (n=1, warm app, cold fixture).
- Hypothesis (not established): Z04a assigned supply is the wrong process for a customer with a signed contract. Under diagnosis by sim-fixer.
- No scenario ID is affected in outcome yet; no business step reached the underlay.

## Attempt log

| Time (UTC) | Step | Result |
|---|---|---|
| 20:06 | up.sh #1 | FAIL, finding 001 |
| 20:07 | up.sh #2 | FAIL, finding 002 |
| 20:08–20:16 | up.sh #3 | replay PASS 220 s, build FAIL, finding 003; down.sh clean |
| 20:18–20:26 | up.sh #4 | PASS: replay 183 s, build 303 s, app ready |
| 20:29 | run main03 #1 | exit 1 in fixture, finding 004 |

### 004 update — established: fixture path, not a product defect
- sim-fixer: Z04 subtype A (assigned supply) is for metering points without a supplier contract and intentionally inserts the period without `contract_id` (`supabase/migrations/20261020230048_ediel_supply_source_runtime_prerequisites.sql:442`); the normal switch (Z03 → grid owner's PRODAT Z04 L → `normal_switch_confirm_v1`, same file :458–542) sets `contract_id` from the switch request. The base's own `scripts/ediel-at-z03h-z04h-supplier-native.test.ts:90–92` asserts that. The underlay store requires it (`20260930175405_ediel_billing_qualified_exact_source_basis.sql:256`).
- Fix: fixture uses the normal switch (`7abdf72d`). Attempt 2 confirmed: one period, `source_process='supplier_switch_confirmation'`, `contract_id` set. State: avfärdad som produktfel, verifierad fixturrättning.

### 20261029-3f1a8ab1/claude-track1/005 — harness: operator permissions granted the wrong way
- IDs: MAIN03.01–.05 (fixture). Category: testharness.
- Attempt 2 (`20261029T203750Z-main03`, report sha256 `87f72abd…a314`): `POST /api/internal/spot/lock-month` → HTTP 403 "Ej behörig".
- Cause (verified read-only in the stack DB): `canonical_authenticated_tenant_context` returned `authorized: true` but `permissions: []`. Allow permissions come only from `user_roles → role_permissions`; `user_permissions` rows are only DENY (`supabase/migrations/20261014004020_admin_api_current_context_projection.sql`, permissions projection). `requireAdminApiAccess` (`lib/admin/apiGuards.ts:163–187`) derives `isAdmin` from that list. The fixture had inserted `user_permissions` allow rows.
- Attempt 3 (`…203951Z…`, `d2f1a404…ef9d`): adding a second role violated `user_roles_company_user_single_active_uidx` (one active role per company and user).
- Fix (`c6f2497e`): the three billing permissions are added as `role_permissions` on the actor's existing seed role (SUBSTITUTE: verifies no role administration UI). Attempt 4: sign-in and spot lock-month passed. Compared with `claude/sim-20261029-track4 @ e986a964`, `scripts/simulation/track4/fixtures/seed.mjs` (FX02); no code copied.
- Not a product claim: the projection behaves as designed.

### 20261029-3f1a8ab1/claude-track1/006 — under diagnosis: UTILTS ingest refused by supply-source gate
- IDs: MAIN03.01–.05 (fixture). Category: ännu obekräftad.
- Attempt 4 (`20261029T204031Z-main03`, report sha256 `30050749…3c3c`, run.log `28fd1b8b…e07a`, 26.9 s wall): step "fixture: UTILTS day 1" fails with `billing_gate_qualified_supply_source_required` (codes in `20260930175405_ediel_billing_qualified_exact_source_basis.sql`, `20261014103601_ops_api_atomic_bb0b_source_part_07.sql`). Under diagnosis by sim-fixer.

| Time (UTC) | Step | Result |
|---|---|---|
| 20:37 | run main03 #2 | exit 1, finding 005 (403) |
| 20:39 | run main03 #3 | exit 1, finding 005 (unique role) |
| 20:40 | run main03 #4 | exit 1, finding 006 |

### 006 update — established: fixture omitted the due supply activation
- sim-fixer (read-only DB): `gridex_set_metering_billing_gate` requires `billing_supply_basis_v1(...)->'qualified'` (`20260930175405_ediel_billing_qualified_exact_source_basis.sql:172–173`), which needs a `gridex_received_sources.normal_supply_activations` row; the fixture had a confirmation but no activation. The normal writer is `activate_customer_supply_v1`, reached from the customer-operations cron step `supplyMarketDeadlines` (`app/api/internal/customer-operations/cron/route.ts:139` → `lib/ediel/flows/supplyMarketTransition.ts:104`); the base's own `scripts/ediel-z04l-z04lk-future-start-native.test.ts:1086–1111` does the same after Z04.
- Fix (`ebf2b271`, cherry-pick of fixer `f535147d`): fixture calls `advanceSupplyMarketDeadlines` for its tenant (SUBSTITUTE `supply-activation-cron`: verifies no scheduler, cron secret or other cron steps). Attempt 5 passed this step. State: avfärdad som produktfel, verifierad fixturrättning.

### 20261029-3f1a8ab1/claude-track1/007 — performance (observed, cause not established): UTILTS ingest ≈ 1.46 s per quarter value
- IDs: MAIN03.01–.05 (fixture), SITE01 (fixture). Category: prestanda.
- Workload: one metering point, sequential bound UTILTS E66 ingest of 96 quarter values per daily file through the app's `ingestBoundUtiltsMetering` (`lib/ediel/utilts/consumptionSinks.ts:27–42`), which awaits per observation `gridex_consume_utilts_metering_v1` (`lib/metering/normalizeMeteringValues.ts:234`), `gridex_set_metering_billing_gate` (`lib/billing/meterValueBillingMatcher.ts:58`) and `gridex_read_billing_source_values_v1` (`lib/billing/sourceBasis.ts:26`).
- Measurement (pg_stat_statements in the stack, server-side execution time only; warm; 4 vCPU/15 GiB; one Postgres backend at ~90 % CPU, host otherwise idle):

| sample (UTC) | fn | calls | total ms | mean ms |
|---|---|---|---|---|
| 21:07:41 | consume_utilts_metering_v1 | 830 | 449 468 | 541.5 |
| 21:07:41 | read_billing_source_values_v1 | 830 | 355 744 | 428.6 |
| 21:07:41 | set_metering_billing_gate | 829 | 363 087 | 438.0 |
| 21:16:47 | consume_utilts_metering_v1 | 1 173 | 642 970 | 548.1 |
| 21:16:47 | read_billing_source_values_v1 | 1 173 | 507 213 | 432.4 |
| 21:16:47 | set_metering_billing_gate | 1 172 | 518 394 | 442.3 |

- Interval between samples: 343 calls each; mean per call in the interval 564 / 441 / 453 ms → ≈ 1.46 s server time per quarter value, ≈ 140 s per daily file of 96 values, ≈ 65 min for one metering point-month (2 688 values). Slight growth with row count (541 → 564 ms) not yet characterised.
- Observed only; root cause (what each call evaluates) not established. Not a claim about production hardware or concurrency. Next: capture EXPLAIN/ANALYZE for one call of each in a quiet stack, compare per-call cost at different data volumes.

### 20261029-3f1a8ab1/claude-track1/008 — harness: re-running a fixture after the spot month is locked
- IDs: MAIN03 (fixture). Category: testharness.
- Attempt 5 (`20261029T204407Z-main03`, report `6a7d8152…b4b6`): `locked_market_price_immutable` — spot prices are global per area and attempt 4 had locked SE3 2027-02; the importer refuses to rewrite a locked month (product behaviour as designed for immutable settlement evidence).
- Fix: fixture reuses a locked month only after comparing all 672 stored hourly prices with its own values (SUBSTITUTE `spot-locked-month-reuse`). Attempt 6 (`c1a2a79c…0729`) failed on a JSON-parse bug in that check (fixed `f144d880`); attempt 7 started with code that also had an out-of-scope variable at the fixture's return (fixed `3ea5cd2b`) and was interrupted (exit 130 at 21:17Z, see 007 for its timing data).

| Time (UTC) | Step | Result |
|---|---|---|
| 20:44 | run main03 #5 | exit 1, finding 008 |
| 20:45 | run main03 #6 | exit 1, finding 008 (harness bug) |
| 20:46–21:17 | run main03 #7 | interrupted (exit 130), measurement 007 |
| 21:18 | run main03 #8 | running |

### 20261029-3f1a8ab1/claude-track1/009 — environment: container restarted twice
- IDs: all running work. Category: miljö.
- Restart 1: between 2026-10-29T22:17Z and 2026-10-30T11:49Z (uptime 0 at 11:49:25Z). dockerd, app and the vitest process were gone. On dockerd restart, Docker's restart policy revived the old stack `t1-20261029T201808Z-6576e10a` from its volume (same pg system_identifier 7702186716638527527). Treated as dirty; removed with `down.sh` at 11:52:05Z (clean: 0 containers, 0 volumes, 0 app processes).
- Restart 2: ~2026-10-30T12:05Z (uptime 0 at 12:09:10Z), during MAIN03 attempt 9 on stack `t1-20261030T115211Z-a961d9e5`; the run left `run.lock` with a dead PID (removed by T1 acting as sim-runner); revived stack removed by `down.sh` at 12:09:49Z (clean).
- Also observed: after each restart dockerd's first start failed with "timeout waiting for containerd to start" until the stale containerd process was killed.
- Effect: attempt 9 → `BLOCKED: miljö` (not FAIL). Mitigation: state and evidence stay under `$HOME` (`/root/sim-home/track1`); stack start and run now launched as one detached process (`setsid nohup`), which still does not survive a container restart.

### MAIN03 attempt 8 — beforeAll timeout (finding 007)
- Run `20261029T211717Z-main03` (env `t1-20261029T201808Z-6576e10a`, harness `ba065053`): exit 1 after 3 612 954 ms, "Hook timed out in 3600000ms" during UTILTS ingest; 5/5 skipped. Hook timeout raised to 3 h (`e5565a08`). Harness conformed to the PR935 contract (`904448b5`).

| Time (UTC) | Step | Result |
|---|---|---|
| 21:17–22:17 | run main03 #8 | exit 1, hook timeout (007) |
| 11:49–11:52 (10-30) | restart 1 handled | old stack down, clean |
| 11:52–11:59 | up.sh | PASS, replay 168 s, fingerprint 5168f69b…, build 227 s |
| 11:59–~12:05 | run main03 #9 | BLOCKED: miljö (restart 2) |
| 12:09–12:10 | restart 2 handled | stack down, clean; up + run #10 detached |

## Oracle source status (2026-10-30)
- Definition source verified twice, byte-identical: PR930 `d6edd3a3:quality/simulation-register/oracles/all-systems-scenarios.safe.json` and `claude/adoring-wright-8qbon8 @ 27862b90:quality/simulation-campaign/oracle-original/all-systems-scenarios.safe.json`; both 41 736 bytes, sha256 `96518c184c240dafa5890df8f6b375b0730acd90f0e97d8f39063fb68c329df3`.
- No track 1 ID was ever marked `BLOCKED: orakel saknas` in this packet; all 13 used the verified file from the start.
- What the file supplies per ID: MAIN03 receipt fields (2688 evidence IDs, 28 sources, lock/transaction check); MAIN04 flow (prepare → money/lineage oracle → locked draft → approve); SITE01 `consolidation.passRequires` (exactly one invoice identity; two invoices in one file is not consolidation).
- Amounts are NOT taken from it: 1809,51 / 1447,61 / 361,90 SEK belong to a historical fixture (b5/9f4 customer, product 24a over 017f) that is not reproduced here. Amount oracles are computed independently from this track's own synthetic inputs with the native rounding rules cited by file:line in `scripts/simulation/track1/fixtures/synthetic.ts` and `site01Synthetic.ts`.

## MAIN03 attempt 10 — first scenario outcomes
- Stack `t1-20261030T120956Z-3bad2e45` (databaseIdentity `…/pg-sysid-7702431992323727399`, fresh replay, fingerprint `5168f69b…782c`, app build `3djFBH8kyOzZ3iCx5Tx3x` from base `1c0c088c`), harness `eb16eac1`. Run `20261030T125039Z-main03`, 12:50:39–13:50:32Z, exit 1, 3 593 339 ms wall; report sha256 `4dc46f03…2b25d`, run.log `8276f234…d1b1`, results.json `a01d6834…173e`, SIM_REPORT `ec4d9b81…9284`.
- MAIN03.01 **step passed**: 2688 billable current rows, 2688 distinct quarter starts/ends, 1 customer/site/point, 28 sources, 454.945 kWh = independent oracle. Awaiting sim-reviewer.
- MAIN03.02 **step passed**: each of the 28 sources carries exactly its 96 values. Awaiting sim-reviewer.
- MAIN03.03, .04, .05 **failed** → finding 010.
- Fixture timings (n=1, warm app, fresh DB): tenant+contract+Z03 7.5 s, Z04 L + activation 3.3 s, spot import 1.8 s, spot lock 0.19 s, 28 UTILTS days ≈ 58 min.

### 20261029-3f1a8ab1/claude-track1/010 — product (high): month underlay for one 15-min metering point times out
- IDs: MAIN03.03, MAIN03.04, MAIN03.05 (and blocks MAIN04.*, SITE01.* that need a saved underlay). Category: produktfel. Severity: high — a normal monthly underlay for a single customer with quarter-hour data cannot be created through the normal entry point.
- Observed: `POST /api/internal/billing/generate-underlay` (logged-in operator with `billing_underlay.export`, billing_month 2027-02) → HTTP 500 `{"code":"billing_underlay_generate_failed"}`; app log `[billing-underlay-generate] failed { traceId: 'cc1f6991-…', code: '57014', error: 'canceling statement due to statement timeout' }`. The scenario's own read through the app's `loadQualifiedBillingValues` (`lib/billing/sourceBasis.ts:26`, `gridex_read_billing_source_values_v1` in batches of up to 1000 ids) failed with the same 57014 after 8.0 s.
- Context: PostgREST `authenticator` has `statement_timeout=8s` (`authenticated` 8 s, `anon` 3 s). Per-value server cost of `gridex_read_billing_source_values_v1` measured earlier at ≈ 0.43 s for one value (finding 007), so a 1000-id batch needs minutes.
- Established: the failure is in the app's normal path, not the harness (same 57014 in the app's own server log for the HTTP call). Hypothesis (being measured): per-value recomputation inside `gridex_billing_source.basis_v1` (repeated tokenisation of the same raw payload, company-wide jsonb scan of supply transitions, table locks) — see 007. Not yet established which inner step dominates.
- MAIN03.05 consequence: both the client-aborted call (403 ms) and the retry (14.4 s) ended in 57014; there was no underlay whose duplication could be checked, so .05 is FAIL for this run and must be re-run after a fix.
- Next: root-cause measurement (per-function stats + EXPLAIN at 1/10/100 values) by sim-fixer in rolled-back transactions; then fix proposal to the coordinator (owner decision, GEN queue if a migration is needed).

## Review: MAIN03.01 and MAIN03.02 → PASS
- Independent sim-reviewer, 2026-10-30, on run `20261030T125039Z-main03` (harness `eb16eac1`, app `1c0c088c`): both GODKÄND. Oracle from `fixtures/synthetic.ts` (no app import) asserted against DB rows; all §6 conditions met (clean run dir, build = base, fingerprint + 0 post-replay migrations, empty migration diff, 0 skipped, hashes match, ISOLATED_NATIVE). Substitutions documented; they do not remove what .01/.02 assert (month shape and source linkage), and do not verify IMAP/S-MIME, reception duplicate screening, processInboundUtiltsMessage/ACK or cron scheduling.
- Reviewer also confirmed MAIN03.03/.04/.05 = FAIL as product finding 010 (app log 57014, trace cc1f6991…).
