# SC-010 internal beneficiary export implementation plan

> Use the existing executing-plans workflow. This document belongs to the retained SC010 owner. It does not approve a scenario or transfer shared-file ownership.

Date: 2026-10-05. Owner: grant-revalidation-20261005. Branch: `codex/ediel-sc010-sc071-grant-revalidation-20261005`. Source: actual main `01b11f55af710c3e6aad1f5a433631a88c702047`; all previously reviewed non-ledger inputs remain unchanged. Existing component PR #570 stays at `7a894c3b7938daf9bbbab7680f71ca5911aefc9c` until a substantive candidate is ready.

## Requirement and intended product boundary

SC010 literally requires a grant active at enqueue, revoked before read/send, followed by a job taking a lease and attempting export. Current grant version must be re-evaluated, unauthorized export stopped, and old cached values must never authorize distribution. SC071 requires concurrent actual grant revocation and an internal E66 export job with a transaction boundary. Its retained owner remains revocation-20261005 (#574); this owner must not duplicate that native lane.

The current production source has only synchronous beneficiary GET. Existing market-message outbox, billing export and provisioning queues are different consumers, with different authority and output. Adding a test-only worker or relabelling their leases does not close SC010.

Proposed product: a scoped internal E66 beneficiary export. A queued request stores references and the captured grant version. A leased worker creates a private internal result in the same database transaction as the existing current-authority projection. A beneficiary reads the result through an authenticated route which rechecks the complete current scope. Original owner rows, original market role, immutable provenance, receipts and legal/source authority continue to come from the existing projection consumer. No SMTP endpoint, destination address, fabricated E66, alternate validator or owner-row copy is introduced.

## Exact proposed files and coordination

All product files below are new; no existing producer is replaced:

- `lib/ediel/services/beneficiaryExport.ts`: typed enqueue/claim/execute/read RPC adapter and real bounded worker loop. Claims/execute return IDs and status only; payload does not enter the cron response or worker logs.
- `app/api/ediel/beneficiary/series/[seriesId]/exports/route.ts`: authenticated POST. Reuse the exact existing `parseEdielProjectionRequest`; trusted selected company/user come from `requireAdminApiAccess(['metering.read'])`. Body supplies an idempotency key, not actor/company/authority/output.
- `app/api/ediel/beneficiary/exports/[jobId]/route.ts`: authenticated no-store GET. Current company/user are checked at every result read; no direct private-table access.
- `app/api/ediel/beneficiary/exports/process/route.ts`: bounded authenticated POST worker entry. Worker accepts selected tenant and actor from the existing guard, never arbitrary global service authority. This is a reachable job runner; scheduling is separate from verifying queue/lease/export behavior.
- `supabase/migrations/20261005101500_ediel_beneficiary_export_jobs.sql`: proposed sole forward migration. New private jobs/results, lease/state constraints, tenant/reference constraints and four service-only RPCs. Existing graph/projection functions are called unchanged. Registration, canonical schema snapshot, generated types and migration ordering stay with the integration coordinator.
- `__tests__/ediel-sc-010-beneficiary-export.test.ts`: real routes/parser/adapter/worker behavior with explicitly finite auth/RPC ports.
- `scripts/ediel-sc-010-beneficiary-export-sql-regression.mjs`: extension of the existing qualified projection/current-grant SQL harness, not a replacement harness. Executes the real new SQL and existing source owners; existing upstream fixture limits remain explicit.
- Native export proof: coordinate one new `scripts/ediel-sc-010-beneficiary-export-native.test.ts` using the existing ESCO fixture and existing PostgreSQL lock helper. SC071's owner can reuse the actual production job for its own grant-revoke/lock-order proof instead of adding another job consumer.

Own existing checkpoint and `sc010-sc071/**` carry receipts. Shared `coverage.json`, native config, replay/checksum manifests, schema snapshots, generated types and common memory are unchanged until their retained owners coordinate. New migration is delivered as the product owner's input, not silently registered in a second chain.

Fresh ownership inventory: complete #530 (122 comments) and #491 (453), all77 current open PR file lists, all5,244 paths, no errors or proposed producer-path match. Original SC010 claim5991253973 and SC071 handoff5991386261 remain effective. Before product edits, announce the expanded NEW-file scope and exact shared integration request on #530. An unanswered message cannot transfer an existing reservation.

## Database operation contract

1. Enqueue captures beneficiary company, requesting actor, grant ID/version, purpose, series ID, explicit fields, interval and a bounded page size. It must establish a current valid grant through the existing authority path before accepting the request. Idempotency is scoped to tenant/actor/key and exact immutable request. A changed request using the same key is denied. Store neither prior projected rows nor a reusable authorization flag.
2. Claim is scoped to the authenticated tenant/actor; it returns opaque job ID and a random lease token, never source values. Use `FOR UPDATE SKIP LOCKED`, a database clock, bounded lease duration, expiration and token rotation. Reclaimed jobs reject the previous token. Cross-tenant/actor claims and executes cannot substitute a caller's scope for the durable job scope.
3. Execute acquires the existing authority graph fence in the canonical order before accessing source authority. It verifies exact job/tenant/actor, current token, running status and expiration; uses only captured job arguments for `public.ediel_beneficiary_series_page_v1`; and writes the private result and completed state in that same transaction. No payload may leave this RPC. An authority denial must commit only a named blocked job state, with no result, consumer receipt or source mutation. Unexpected errors remain errors; do not disguise infrastructure failure as an authorization denial.
4. Read first matches the trusted tenant/actor to the job, then calls the existing current projection authority under the same transaction fence before returning a completed internal result. A completed job, receipt or old payload is never itself authorization. Revocation, version change, membership loss, role/source/legal/purpose/field/period changes deny future reads. Result content must retain the source role/provenance and field whitelist.
5. Lock ordering must preserve the existing graph-before-source-before-assignment/grant order. New queue locks cannot create a reverse path into a graph writer. The execution lease must be rechecked after any graph wait; enqueue cannot hold a job row while waiting for graph locks.
6. Private tables have forced RLS and no direct public/anon/authenticated/service-role table privileges. Public RPCs are service-only, use empty/fixed search paths and verify passed trusted actor/tenant in SQL. New FKs must bind all references to the actual provider and beneficiary scope; no global UUID-only ownership assumption. Root captures authentic DDL/type/fingerprint changes.

## Verification tasks

- [ ] Resolve the product boundary and announce precise single-producer ownership. Confirm that internal result distribution is the intended export consumer rather than assuming an unspecified external transport.
- [ ] Write and observe meaningful failing enqueue/lease/execute/read behavior tests, then implement the minimal new consumer. Missing module errors are setup failures, not RED behavior proof.
- [ ] Execute new SQL through the qualified existing harness. Positive control must produce exactly one scoped result with unmodified DGI provenance. Snapshot originals, series/values, receipts, result rows and job state explicitly.
- [ ] Prove active enqueue → actual `revoke_grant` administration → claim → execution blocks both captured version and an attempted current revoked version. Assert zero results/receipt writes/raw disclosure/provider calls, while preserving the legitimate revocation history and blocked job record.
- [ ] Prove wrong tenant/actor/grant/series/purpose/fields/interval, membership/permission loss, exact-scope idempotent replay, changed-request collision, stale/expired/rotated leases, duplicate execution and result-read after revocation. Assert unchanged owner/source rows and unaffected beneficiary control.
- [ ] Native SC010 proof invokes actual authenticated queue/worker/result consumers on the canonical stack. Coordinate SC071's two real concurrent lock orders with its existing native owner; do not claim PGlite concurrency.
- [ ] Independent full literal and tenant/effect review of exact final source and tests. Fix confirmed findings in owned files; pass Node22 types/lint/spec plus relevant existing regressions.
- [ ] Root registers the exact new migration/native include once and captures generated schema/types/checksums; required current candidate CI passes before integration. Approve only SC010 if every effect is proven. SC071 remains with its owner. Publish exact handoff/actual main commit and continue.

## Current limits

This is a concrete implementation proposal, not executed product code or proof. The new consumer cannot be reported as deployed/merged/native/whole-approved. Internal distribution must be accepted as the product sink and the new schema coordinated before treating the design as final. The earlier caller38PASS, SQL-component#572 and prepared native#574 receipts remain reusable only within their stated bounds.
