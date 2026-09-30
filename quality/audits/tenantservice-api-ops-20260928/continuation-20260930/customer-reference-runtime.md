# Independent real reference-client runtime proof — 2026-09-30

Status: **PREPARED, native/HTTP NOT_EXECUTED**. The current workspace has no
Docker/psql disposable stack; no authenticated runtime PASS is inferred. This
package is ready for root to wire into the existing OPS clean replay, using its
actual local Next/Supabase stack. It does not create a workflow or deployment.

Owned files:

- `scripts/customer-reference-runtime-20260930.native.config.ts`
- `scripts/customer-reference-runtime-20260930.native.test.ts`
- `e2e/browser/customer-reference-runtime-local.spec.mjs`

The fixture uses independent A1/A2 customers in tenant A and B1 in tenant B,
real local Auth users/owner accounts, active integration clients and completed
local provisioning receipts. The synthetic RS256 issuer private key, client
tokens and assertions remain in a mode0600 RUNNER_TEMP file, excluded from
reports/artifacts. The issuer is an identifier; no external issuer or sender is
called. Native global fetch rejects every origin except local Supabase.

Native seed actually calls the guarded OPS contact command using a real local
auth.sessions row, commits one phone change on A2, expires that session, retries
the completed command and requires403 plus identical persisted snapshots. The
second native case calls the real lifecycle orchestrator with A2's site for A1
and requires no job, communication log or email outbox. In verification mode
this seed-only second case is explicitly skipped rather than silently passing.

Three HTTP cases use the exported actual `delegatedRequest` and
`runConfiguredCustomerRead` against actual Next. The reference module's
syntheticServer is never started. Fresh five-minute assertions bind exact
method/path, client, subject and customer on every request.

1. GET notifications for all three customers, POST read and exact same-key
   replay, GET after read, phone-only profile mutation/replay and GET me.
   Actual customer/primary-contact email must remain unchanged, only A1 changes,
   and notification/audit/command/outbox counts must reflect one effect.
   Responses are validated against the exact four schemas retrieved from
   actual served active OpenAPI. Unknown behavioral schema keywords fail the
   proof; this does not qualify every public endpoint/client resource.
2. A temporary127.0.0.1 forwarding proxy allows only the actual profile POST.
   It consumes the complete upstream Next response, validates200/DTO and native
   committed revision/command count, then destroys the downstream socket before
   transferring a response. A direct same-key actual Next retry must reuse the
   completion and preserve one contact/audit/outbox effect. This proves genuine
   postcommit response loss if executed, not process kill or provider failure.
3. Same-tenant other-customer and foreign-tenant headers fail; then live owner
   account inactivity, API-client expiry and revocation must deny GET plus both
   completed write replays without any persisted business changes. Expiry is
   cleared and the configured client reads successfully before terminal owner
   inactivity/client revocation. The actual irreversible portal guard must deny
   a direct reactivation attempt; native postverification requires the account
   still inactive and client still revoked. Exact credential-layer error codes
   distinguish client expiry/revocation from generic account denial.

Native postverification requires two A1 contact effects, one earlier A2 OPS
effect, one read effect, exact public idempotency claims, preserved emails and
zero email outbox. No UI interaction, actual provider delivery, production
issuer enrollment, whole T22 process-crash recovery or whole T48 parity is
claimed. Original bounded targets: T01/T02/T05/T06/T09/T10/T12/T20/T21/T22/T23/
T24/T25/T48/T50/U06; each remains pending actual exact-candidate OPS evidence.

## Existing OPS integration commands (root owns wiring)

Run after real local status keys are exported, before the HTTP run. Keep this
fixture independent of contact/support/legal fixtures:

```sh
export GRIDEX_REFERENCE_RUNTIME_LOCAL_E2E=1
export GRIDEX_REFERENCE_RUNTIME_FIXTURE_PATH="$RUNNER_TEMP/customer-reference-runtime-fixture.json"
npx vitest run --config scripts/customer-reference-runtime-20260930.native.config.ts
export GRIDEX_CUSTOMER_DELEGATION_TRUST_JSON="$(node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("node:fs").readFileSync(process.env.GRIDEX_REFERENCE_RUNTIME_FIXTURE_PATH,"utf8")).trust))')"
npx playwright test e2e/browser/customer-reference-runtime-local.spec.mjs --config=playwright.config.mjs --project=chromium
GRIDEX_REFERENCE_RUNTIME_VERIFY_AFTER_HTTP=1 npx vitest run --config scripts/customer-reference-runtime-20260930.native.config.ts
rm -f "$GRIDEX_REFERENCE_RUNTIME_FIXTURE_PATH"
unset GRIDEX_REFERENCE_RUNTIME_LOCAL_E2E GRIDEX_REFERENCE_RUNTIME_FIXTURE_PATH GRIDEX_REFERENCE_RUNTIME_VERIFY_AFTER_HTTP GRIDEX_CUSTOMER_DELEGATION_TRUST_JSON
```

Require `CI=true`, `GRIDEX_NATIVE_STATUS`, `RUNNER_TEMP`, actual
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, actual local anon/service keys,
no `GRIDEX_E2E_BROWSER_BASE_URL`, and local psql54322. The existing Playwright
webServer must receive the trust env at startup; restart after fixture trust
changes. Do not reuse an unrelated already-running Next process. Existing CI
stack/config is used; local webpack override from the public-document proof is
not a hosted proof configuration. Private fixture/trust must not be printed or
uploaded; use only the safe marker lines produced by these tests.

## Executed preparation checks

- Node22 scripts TypeScript PASS after replacing the Fixture intersection with
  `Omit<ReadProofFixture,'customers'>`, preserving the enriched array type.
- Main TypeScript PASS with8GB heap; the initial default2GB attempt exhausted
  heap before a result, not a source diagnostic.
- Scoped ESLint PASS; HTTP `node --check` PASS.
- Playwright `--list` registers3 real HTTP scenarios; no test executed by list.
- Config with CI/status/fixture absent actually rejects at startup with
  `reference_runtime_disposable_ci_replay_required`, before any seed/request.
- Actual lifecycle graph+site controlled tests19/19 PASS; they do not replace
  the native/HTTP cases above.

The frozen .3 all52 OpenAPI byte/guide proof remains separate in
`api-release-local.md`; neither its earlier pre-DB401 nor this prepared fixture
is accepted as authenticated runtime success.
