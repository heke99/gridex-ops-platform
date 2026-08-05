# Gridex OPS — Bug Register

Statuses: `open`, `in_progress`, `fixed`, `partially_fixed`, `blocked`, `unverified`, `accepted_risk`.

## BUG-001 — Customer portal sync converted controlled client errors to HTTP 500

- Severity: `Medium`
- Status: `partially_fixed`
- Category: API contract / error handling
- File: `app/api/v1/customer-portal/sync/route.ts`
- Symbol: `POST`
- Original lines: 365–375 at commit `3eb8445cb840d38af6068d49266ce0881a8e0157`
- Evidence: `readJsonObject` throws exported `ApiInputError` values with 400/413 and stable codes for missing, invalid, non-object or oversized JSON. The original route imported only `readJsonObject`; its final catch returned status 500 for every exception.
- Actual function before fix: malformed or oversized client input was reported as an internal server failure.
- Expected function: preserve the controlled status/code/message/field; only unexpected faults return the generic 500 boundary.
- Reproduction path:
  1. Authenticate a valid `customer_sync.write` client.
  2. POST invalid JSON, an array body, an empty body or a body over 256 KB.
  3. Original behavior returns HTTP 500 instead of 400/413.
- Affected user/tenant: any tenant portal integration; no cross-tenant data exposure.
- Tenant impact: tenant-bound request remains isolated, but the client may retry a non-retryable request.
- Data impact: normally none before parsing; unnecessary retries/log noise possible.
- Security impact: low; malformed-input traffic was misclassified.
- Performance impact: repeated retries and integration log volume.
- Likely production impact: customer portal instability and misleading monitoring/SLA signals.
- Implemented solution: imported `ApiInputError`; controlled failures now preserve status, code, message and field. Unexpected failures retain a generic message and stable `portal_sync_failed` code. Integration logging uses the actual response status.
- Test added: `scripts/gridex-customer-portal-sync-error-contract-regression.cjs`.
- Changed files:
  - `app/api/v1/customer-portal/sync/route.ts`
  - `scripts/gridex-customer-portal-sync-error-contract-regression.cjs`
- Verification command: `node scripts/gridex-customer-portal-sync-error-contract-regression.cjs`
- Verification result: committed source and assertions inspected on exact branch; command execution blocked because no checkout is available and no GitHub Actions run started.
- Fix commit: `aeaa08283e714160181cd007f2c04196d6cf88a2`
- Remaining closure: execute regression plus TypeScript/lint/API compatibility checks. Status must not become `fixed` before those pass.

## BUG-002 — Billing webhook response reveals provider invoice-reference existence

- Severity: `Medium`
- Status: `unverified`
- Category: Security / webhook enumeration
- Files:
  - `app/api/webhooks/billing/[provider]/route.ts`
  - `lib/billing/providerWebhooks.ts`
- Symbols: route `POST`, `resolveTarget`, `processBillingProviderWebhook`
- Lines: exact line inventory pending clean checkout.
- Evidence: tenant/secret resolution by provider invoice GUID occurs before signature validation. A known invoice GUID with a bad signature/timestamp throws `BillingProviderWebhookAuthError` and returns 401; an unknown or ambiguous GUID throws a generic error and returns 500.
- Actual function: unauthenticated callers can distinguish two target-resolution classes from status codes.
- Expected function: externally indistinguishable authentication failure for unknown target, invalid signature and stale/replayed timestamp, while retaining detailed internal logs.
- Reproduction path: submit equal-shaped webhook payloads with a nonexistent GUID and a known GUID but invalid signature; compare response status.
- Affected user/tenant: tenants using billing provider webhooks.
- Tenant impact: no verified cross-tenant access; possible existence inference.
- Data impact: none verified.
- Security impact: provider invoice identifier oracle and error-trigger surface.
- Performance impact: unauthenticated database lookups and 500 alert noise.
- Likely production impact: low to moderate depending on identifier entropy and provider retry semantics.
- Safest solution: normalize external auth/target-resolution response and preserve distinct internal telemetry. Confirm provider retry contract before changing 500 behavior.
- Test to add: unknown target and bad signature must return the same status/body class; valid signed event remains accepted and idempotent.
- Changed files: none.
- Verification command: blocked pending provider contract/runtime fixture.
- Verification result: `unverified`.
- Fix commit: none.

## BUG-003 — Website customer-application orchestration exceeds 8,400 lines

- Severity: `Medium`
- Status: `open`
- Category: Architecture / maintainability / change risk
- File: `lib/website/customerApplications.ts`
- Symbol: module-wide
- Lines: 1–8,400+
- Evidence: exact branch reads succeeded beyond line 8,400. The module mixes request validation, identity, customer/site/meter creation, contract/pricing binding, legal evidence, POA/storage/PDF, email, events and saga behavior.
- Actual function: one module owns multiple transaction and side-effect boundaries.
- Expected function: stable domain modules behind a compatibility facade with unchanged exports and characterization tests.
- Reproduction path: any change to website onboarding requires review across unrelated responsibilities.
- Affected user/tenant: all website-intake tenants.
- Tenant impact: no current bypass verified; reviewability of tenant invariants is reduced.
- Data impact: elevated partial-write/regression risk.
- Security impact: elevated review risk around service-role and public DTO handling.
- Performance impact: indirect; optimization and query ownership are difficult to isolate.
- Likely production impact: high change risk, not an immediate runtime failure.
- Safest solution: defer broad split until clean tests run; extract one stable responsibility per commit while preserving facade exports.
- Test to add: characterization coverage around tenant mismatch, duplicate event, legal/POA and side-effect failure paths.
- Changed files: none.
- Verification command: full targeted website/legal/POA regressions.
- Verification result: blocked.
- Fix commit: none.

## BUG-004 — Architecture memory and repository layout have drifted

- Severity: `Low`
- Status: `partially_fixed`
- Category: Documentation / developer safety
- Files: `.agent-memory/*`, root `README.md`
- Symbol: repository architecture guidance
- Lines: multiple.
- Evidence: memory documents referred to `apps/ops`, while the current application is rooted in `app/`, `components/` and `lib/`. The root README is a narrow historical hotfix document rather than the current platform overview.
- Actual function: agents/developers can search or run commands in stale paths.
- Expected function: one canonical, current repository map linked from AGENTS/README.
- Reproduction path: follow the old `apps/ops` instructions on the current branch.
- Affected user/tenant: developers/operators; indirect tenant risk through mistaken changes.
- Tenant/data/security/performance impact: indirect.
- Implemented mitigation: current layout documented in `quality/CODEBASE.md` and `quality/ARCHITECTURE.md`; `.agent-memory/current-task.md` updated with audit handoff.
- Remaining closure: update all stale memory references and root README in a dedicated documentation change.
- Verification result: partial.
- Fix commit: report finalization commit.

## BUG-005 — Required checkpoint filename differs from available repository memory

- Severity: `Low`
- Status: `blocked`
- Category: Agent process / documentation
- File: `.agent-memory/checkpoint.md`
- Symbol: required memory handoff
- Lines: not applicable.
- Evidence: `AGENTS.md` requires `checkpoint.md`, but the branch contains `checkpoint.json` and no `checkpoint.md`.
- Actual function: strict agents encounter a missing required file.
- Expected function: AGENTS and actual memory file agree, or both formats exist with clear authority.
- Reproduction path: attempt to fetch `.agent-memory/checkpoint.md`.
- Affected user/tenant: maintainers/agents only.
- Impact: process ambiguity; no direct runtime impact.
- Safest solution: decide canonical format and update AGENTS/memory atomically.
- Test to add: repository instruction-file existence check.
- Changed files: none.
- Verification result: blocked pending owner decision on canonical format.
- Fix commit: none.

## SEC-001 — Leaked-password protection reported disabled

- Severity: `Medium`
- Status: `unverified`
- Category: Authentication configuration
- File: Supabase Auth project configuration
- Symbol: leaked-password protection
- Lines: not applicable.
- Evidence: Supabase security advisor reported the setting disabled; available connector tools do not expose an independent auth-settings read or write.
- Actual function: password screening against known leaked credentials may be disabled.
- Expected function: enable the protection unless incompatible with documented auth policy.
- Reproduction path: inspect Supabase Auth password settings/advisor.
- Affected user/tenant: password-authenticated users across all tenants.
- Tenant impact: shared authentication posture; no cross-tenant access verified.
- Data/security impact: increased credential-stuffing/account-takeover risk.
- Safest solution: verify in Supabase dashboard/Management API and enable through an authorized configuration change.
- Test to add: auth configuration compliance check.
- Verification result: `unverified`.
- Fix commit: none; configuration only.

## Summary

| Severity | Total | Fixed | Partially fixed | Open | Blocked | Unverified |
|---|---:|---:|---:|---:|---:|---:|
| Critical | 0 | 0 | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 0 | 0 | 0 |
| Medium | 4 | 0 | 1 | 1 | 0 | 2 |
| Low | 2 | 0 | 1 | 0 | 1 | 0 |
