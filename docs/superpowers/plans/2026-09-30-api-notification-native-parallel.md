# Customer API notification transaction and native reads implementation plan

> **For agentic workers:** Use the repository's subagent-driven-development workflow for implementation and review. Six bounded workers may run in parallel; one root owns integration and publication. Checkboxes below are execution checkpoints, not completed-code claims.

**Goal:** Deliver one coherent API package that makes notification mark-read transactional and qualifies the existing legal and metering reads through real local HTTP and database calls.

**Architecture:** Keep the existing delegated customer guard and public response shapes. Move notification resolution, authorization recheck, mutation, completion and audit into one service-role-only database command; preserve existing public references and legacy completed idempotency results. Qualify legal and metering routes independently, then materialize one paired release on the integrated candidate.

**Tech Stack:** Installed Next.js, TypeScript, Supabase/PostgreSQL, Vitest and Playwright; Node 22 matching CI.

## Global constraints and current evidence

- Live #422 head checked: `cc90678d45602d37db7f8edf9713597c66fee28a`; #418: `7afb3dcac62376edc5cab24c83ebcce80cb06e9a`. Both remain draft and unmerged.
- Local checkout `codex/api-event-v2-finalize-20260930` at `e37f24c0` preserves the same tested source tree plus handover documentation. Preserve original checkouts and all subsequent remote changes.
- Event-v2 is already qualified. Retain its gates in final CI; do not restart its investigation or manually rerun its successful historical jobs.
- This document is a prepared execution package. Notification remediation and new legal/metering native qualification have not been implemented by this planning turn.
- Keep strict scopes, exact-action signed delegation, tenant/customer ownership and revocation checks. Never upload keys or raw assertions.
- Use a new forward migration created with the installed Supabase CLI; never rewrite applied migrations. Test only the disposable local stack.
- Keep `2026-09-30.1` and all older immutable release files byte-identical. Do not choose a later release version until inspecting the current version source and remote head before integration.
- Root alone owns workflow changes, generated types/schema/fingerprint/manifests, shared memory, integration and non-force publication. No main merge, production migration or customer communication belongs to this package.
- The requirements owner retains T/U meanings and acceptance decisions. This package does not establish full masterplan acceptance.

## Confirmed findings

1. `app/api/v1/customer/notifications/read/route.ts` updates notifications before `lib/api/strictRequest.ts` separately completes `customer_portal_write_idempotency`. The existing failure test proves a persisted update, HTTP500, failed claim, then same-key409. This is an executed mock-boundary reproduction, not native transaction proof.
2. Notification reference resolution scans the entire customer history in pages of1000. `lib/customer-portal/publicDto.ts` computes the reference on reads; no indexed canonical notification reference exists.
3. Legal and metering routes can throw `PlatformSchemaNotReadyError`; the shared handler now returns safe retryable503. Their current OpenAPI operations omit503.
4. Legal/metering route doubles and the synthetic reference client do not establish native database or real local HTTP qualification.

## Parallel ownership

| Worker | Owned files | Deliverable |
| --- | --- | --- |
| Database command | New CLI-created notification migration; notification SQL fixtures | Indexed stable references and atomic authorized command |
| API adapter | `app/api/v1/customer/notifications/read/route.ts`; new `lib/customer-portal/notificationCommands.ts`; notification route/validation tests | Existing public API invoking the atomic command |
| Notification proof | New `scripts/customer-notification-read-native.test.ts`, `.config.ts`; new `e2e/browser/customer-notification-read-local.spec.mjs` | Real GET→POST→replay→GET and rollback/concurrency proof |
| Legal proof | New `scripts/customer-legal-read-native.test.ts`, `.config.ts`; new `e2e/browser/customer-legal-read-local.spec.mjs`; existing legal route tests if needed | Existing legal GET qualified across customer/tenant boundaries |
| Metering proof | New `scripts/customer-metering-read-native.test.ts`, `.config.ts`; new `e2e/browser/customer-metering-read-local.spec.mjs`; existing metering route tests if needed | Existing metering GET qualified with filter-bound pagination |
| Contract/release | Portal generator, relevant parity tests, guides and reference client; final versioned OpenAPI pair | Accurate transaction semantics and legal/metering503 |
| Root integration | `.github/workflows/ops-hardening.yml`; generated contracts; shared release version sources and project memory | One reviewed candidate, final release, exact-head CI and receipt |

Worker files above are proposed new files; they do not already exist. Each proof worker owns separate fixture files, synthetic identifiers and cleanup. Workers never run destructive reset against a shared database. Root schedules combined native execution against one freshly replayed stack. The read-proof workers require no new schema: both current tables already have their columns and keyset indexes.

## Task 1: Lock notification compatibility and the command interface

**Reference:** `supabase/migrations/20260928213000_secondary_contact_atomic_command.sql`, `lib/api/strictRequest.ts`, `lib/integrations/publicReferences.ts`, and the current notification route.

**Proposed private server interface:** `public.gridex_mark_customer_notifications_read_v1(p_command jsonb) RETURNS jsonb`, callable only by service_role, using SECURITY INVOKER and current authorization checks before replay. Root, database, API and proof workers lock the strict command JSON and SQL-error mappings together before writing dependent implementation.

**Public interface to preserve:** POST request has only `notification_references`,1–100 distinct strings. Success data remains `updated_count`, `notification_references`, `read_at`. Preserve request reference order, first persisted row read time, attempt-time `read_at`, neutral404 for missing/foreign references and existing409 codes.

- [ ] Run the existing failure reproduction on Node22:

```sh
node node_modules/vitest/vitest.mjs run __tests__/customer-api-notification-write-boundary.test.ts
```

Expected before remediation: the existing gap-characterization test passes by observing500, one persisted write and subsequent409. Passing that test does not mean atomicity is fixed.

- [ ] Freeze command fields covering company, customer, active API client, verified delegated subject, key and reference array. Signature/issuer verification stays in the API; the database additionally checks active tenant/client/scope/customer relation under locks.
- [ ] Preserve the `customer_portal_write_idempotency` namespace: tenant+client+customer+route+key. A completed legacy row returns its exact stored response after current authorization is checked. Old failed/processing rows retain their safe409 behavior; do not assume their earlier effects rolled back.
- [ ] Preserve the existing compact payload hash. For this fixed one-field payload, reproduce the exact JSON string and SHA256 used by `strictRequest.ts`; do not substitute PostgreSQL jsonb text hashing with different whitespace. Include ordered reference arrays in cross-language vectors.
- [ ] Preserve exact reference derivation: SHA256 of `gridex-public-reference:v1:<company>:notification:<id>`, base64url, first32 characters, prefixed `notification_`. Generated storage or another database-owned writer must cover existing and future producers, with a tenant/customer/reference index.
- [ ] Include canonical audit and persisted command/result evidence in the same transaction. Use an internal outbox only where the existing canonical domain-event mechanism requires one; creating this proof must not send communication.

Only this small interface agreement precedes the dependent notification edits. Legal/metering fixtures and contract assertions may start immediately.

## Task 2: Database notification command

**Consumes:** Frozen Task1 interface and compatibility vectors. **Produces:** Service-only RPC, indexed references and SQL proof.

- [ ] Create the forward migration using `supabase migration new` after discovering installed CLI help; implement using the existing contact command's ownership/locking pattern.
- [ ] Verify exact old/new reference bytes for existing and newly inserted rows, plus compact legacy request hashes and completed claim replay.
- [ ] Lock current ownership/authorization before checking replay; resolve the complete requested set within tenant/customer before any mutation.
- [ ] Update only unread rows. Persist completion, response and canonical audit within the same transaction.
- [ ] Run late completion/audit failure injection: no notification, new claim or audit remains after failure. A subsequent new transaction with the same new key can succeed because the failed transaction left no claim.
- [ ] Run two real concurrent transactions: identical key/payload has one committed result; changed payload conflicts; revoke link/client/scope and deny replay; anon/authenticated cannot execute the RPC.
- [ ] Verify indexed access for a large synthetic customer history without relying on wall-clock thresholds from an unrelated environment. Commit owned files only and obtain an independent review.

## Task 3: API adapter and notification proof, in parallel

**Consumes:** Frozen Task1 RPC/result/error contract. **Produces:** Route adapter and real HTTP/native evidence.

- [ ] API worker writes a failing route test requiring one RPC and no historical scan/direct update/separate-completion call.
- [ ] Replace only this operation's wrapper with the command adapter. Keep strict request parsing, guard, delegation and public envelope; preserve the shared wrapper for other operations.
- [ ] Replace the old gap-characterization assertion with a regression for the corrected transaction boundary; retain independent native fault injection as the atomicity proof.
- [ ] Proof worker seeds two customers in one tenant plus one customer in another tenant, unread/already-read rows and legacy completed/failed/processing claims.
- [ ] Run actual local HTTP GET→POST→same-key replay→GET; mixed own/foreign404 must produce no partial effect. Verify previous read time stays unchanged and a new key updates zero already-read rows.
- [ ] After HTTP, query actual notification/result/audit rows and source ownership. Use the existing safe request helper; keep fixtures/keys in RUNNER_TEMP and traces off.

Targeted route command:

```sh
node node_modules/vitest/vitest.mjs run __tests__/customer-api-notification-read-routes.test.ts __tests__/customer-api-notification-read-validation.test.ts __tests__/customer-api-notification-write-boundary.test.ts
```

New native config commands follow the repository's event-v2 seed→HTTP→postcheck structure; root owns the workflow wiring.

## Task 4: Legal and metering proof, two independent workers

**Consumes:** Existing GET routes and guard. **Produces:** Separate genuine HTTP/native seed and postcheck evidence; runtime fixes only for reproduced defects.

- [ ] Both workers seed customerA1/A2 and tenantB customer with tied microsecond timestamps, then enumerate all pages and replay cursors without duplicates or omissions.
- [ ] Both workers test missing/incorrect scope and action, denied delegation, revoked relation, foreign customer/tenant/resource/tampered cursors, default/invalid/capped limits, explicit public allowlists and no internal identifiers.
- [ ] Legal worker covers bundle/legacy document references, nullable fields and all nine public fields. Seed legal `source='customer_portal'`, not the invalid mock value `portal`. Full references need the actual product→product version→legal bundle→bundle document parent chain with mandatory hashes/version/direction fields; legacy references need `legal_text_versions`. Test legacy schema fallback separately; do not modify the current shared schema to manufacture fallback during combined replay.
- [ ] Metering worker covers owned facilities, `facility_id`, `from`/`to`, UTC/full timestamps and inclusive boundary times; `to` applies to `period_end`. Create the actual customer→site→metering point chain with tenant/customer composite FKs. Current rows require non-null `quantity_kwh` and `period_end > period_start`; tied times need distinct source references/metering points so deduplication constraints remain valid. Nullable DTO characterization stays separate from this current-schema seed. Test filter-bound cursors and invalid-input denial before query.
- [ ] Both postchecks confirm source rows unchanged and access logs attributed to the actual selected customers. Snapshot after the complete seed, including metering-trigger effects. Distinguish actual portal-identity denial from legitimate OPS reader permissions in anon/authenticated checks.
- [ ] Run existing route characterization during fixture preparation:

```sh
node node_modules/vitest/vitest.mjs run __tests__/customer-api-legal-read-routes.test.ts __tests__/customer-api-metering-routes.test.ts
```

## Task 5: Contract preparation and one final release

**Consumes:** Existing public shapes; final frozen notification behavior. **Produces:** Canonical503 parity, guide/client cases and one paired immutable release.

- [ ] Write RED parity assertions for503 on legal/metering and explicit transaction/replay semantics after the notification interface is frozen.
- [ ] Add canonical ErrorEnvelope and safe `platform_schema_not_ready`, `retryable:true` descriptions to both GET operations in `scripts/finalize-openapi-release.portal.cjs`.
- [ ] Prepare reference-client cases for same-key changed-payload409, mixed own/foreign404, zero subsequent updates and exact replay. Label its synthetic server as synthetic; native proof comes from Tasks2–4.
- [ ] After integration freezes runtime, root and release owner advance shared version sources once, then run:

```sh
npm run api:finalize
npm run api:materialize
npm run api:docs
npm run api:compatibility
npm run api:runtime:parity
npm run api:release:verify
node scripts/tenantservice/customer-api-reference.mjs
```

- [ ] Verify all prior immutable artifact bytes/modes and operation IDs are preserved. Obtain independent release review.

## Task 6: Root integration and completion

- [ ] Inspect all worker diffs and reviews, integrate owned changes, and wire each new seed/HTTP/postcheck config into the existing clean replay. Resolve shared fixture timing/environment conflicts centrally.
- [ ] Generate authentic types/schema/fingerprint/manifests from the disposable migrated database and reconcile their bytes; never hand-edit generated definitions.
- [ ] Run one full final local suite, relevant lint, app/test/script typechecks, RBAC, release checks and build. Run isolated proof preparation in parallel where it has no shared database mutation.
- [ ] Recheck remote heads and ownership before one non-force publication on the same API draft. Preserve #418 work and all later commits.
- [ ] Require fresh applicable CI on the published candidate: verify/quality/clean replay and the relevant browser/E2E jobs. Inspect each new native/HTTP/postcheck marker and artifact parity.
- [ ] On an actual failure, fix its verified cause and run the affected local regression before a new candidate. Only a changed candidate or unresolved failed gate justifies repeating final qualification; do not weaken tests or loop successful jobs.
- [ ] Record exact SHA/tree, checks, proof limits and remaining gaps in #422. Update current project memory without accepting entire T/U/P phases.

## Subsequent scope

External support cases/messages/attachments remain a separate coherent implementation package; deployed issuer/customer integration and served release-byte verification remain separate environment evidence. Their preparation can be assigned after the six workers' ownership is settled, without expanding this final release before its acceptance conditions are defined.

## Planning evidence and self-review

Three read-only domain reviews completed in parallel on `e37f24c0`. The source reviewer ran14 existing notification tests in five files, all passing, including the known-gap reproduction. Root checked live PR heads, the notification route, shared wrapper, reference hash, contact command pattern and legal/metering503 paths. No source, schema, runtime release or workflow changed in this planning turn.

Skill routing: using-superpowers, writing-plans and dispatching-parallel-agents apply to this bounded execution package; Supabase applies to schema/authorization dependencies. Implementation will activate TDD/debugging, current Next documentation, SQL/security reviews and completion verification. Broad UI/performance audits and external provider activation are outside this planning scope. The user's requested parallel delivery selects the multi-agent approach without another workflow-choice question.
