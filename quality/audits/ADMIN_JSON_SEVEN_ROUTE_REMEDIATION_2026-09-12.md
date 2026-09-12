# Internal JSON contract remediation — first seven routes

Status: IMPLEMENTED; local application verification passed. Hosted CI and independent review are not claimed by this record.
Base: GitHub `9c4e93f6d69b57eea5b677bc9d00f69ed78f0540`, tree `232663b021a581e1eb22ce6aba91af5f94e37294`.
Scope: Task10b2a / masterplan84. No migration, database mutation, provider request or production rollout.

## Skill routing and source admission

Executing-plans, systematic-debugging, test-driven-development, spec-to-code-compliance, code-review, differential review and verification-before-completion apply to the existing API task. The isolated workspace was obtained from owned GitHub Actions run34704968297/artifact10301238629; its source and dependency SHA256 receipts and exact source tree were checked. The local Git commit is a synthetic workspace snapshot, not upstream history. The installed Next16.2.12 route-handler documentation was read. Source, actual callers, canonical company guards, the bounded request reader and relevant engine inputs were inspected. UI, new architecture, hook installation and skill authoring are out of scope; native database tasks remain separate. Review here is self-review, not an independent reviewer approval.

## Confirmed defects and fixes

Seven POST routes used unbounded request.json and permissive field extraction:
- billing/generate-underlay and billing/period-locks;
- pricing/preview, pricing/reprice and pricing/lock-preview;
- spot/import-month and spot/lock-month.

Added a shared bounded reader using the existing stream limiter, plus closed route-specific Zod schemas. Authentication and existing company/lifecycle checks still occur first. Requests with unknown fields, conflicting snake/camel aliases, invalid JSON/object shapes, invalid calendar months, non-boolean persist/force-like inputs, invalid period actions/statuses, or invalid/empty supplied import-area arrays are rejected before domain/provider I/O. A missing optional import-area array retains the existing default; an invalid explicit array is no longer silently filtered into broader work. Valid aliases/defaults, preview persist=false, lock/unlock/reopen behavior and spot settlement case normalization are preserved. Existing domain errors, financial behavior, provider selections and authorization engines are unchanged. The spot settlement response retains its correlation ID, retryability and specific area/month error codes. Its guard test now narrows the actual optional-never response union without returning an undefined response.

## Verification

- Actual seven original route bodies with the final new tests: 165 tests, 87 pass / 78 fail (expected RED). New helpers were not called by those original route bodies.
- Fixed routes plus the existing real canonical-company policy/route tests: 236/236 PASS.
- Full local Vitest suite, `CI=1 ... run --maxWorkers=2`: 210 files / 1840 tests PASS, exit0.
- `npm run typecheck:tests`: PASS after resolving the real spot-route optional response return type.
- ESLint on all ten changed/new TypeScript files: PASS.
- `git diff --check`: PASS.

Local Node22.16.0, dependency archive produced on Node22.23.2. The first unconstrained local whole-suite attempt timed out without a result; a later CLI attempt used an unsupported minWorkers option and failed before tests. Neither attempt is counted as PASS. The bounded two-worker full run above completed normally without changing test assertions, timeout limits or repository configuration. The supported hosted lane remains authoritative for publication acceptance.

## Remaining work

Next: the six invoice/Ediel JSON routes, then five platform routes, partner-price idempotency and move-out identity contract. RLS/native billing/job contracts and full migration replay/types/parity remain OPEN. Runtime log checks separately confirmed missing event_scope on platform audit writes and an ambiguous metering_points→customers join; no fixes for those are claimed here. No main merge or production action is authorized by this partial verification record alone.
