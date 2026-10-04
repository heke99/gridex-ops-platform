# S1 staff assertion timing fix — 2026-10-04

Base: `78278742`, isolated branch `codex/staff-assertion-time-fix`.
User requirement: signed staff assertions have a lifetime of at most 15 minutes;
existing customer and website APIs retain their behavior.

Confirmed P1: `nbf=now`, `iat=now+86400`, `exp=iat+900` passed the shared
verifier's signature, issuer, audience and subject checks and reached staff
membership lookup. Using `nbf ?? iat` for future validity hid the future `iat`,
while `exp - iat` hid an 87,300-second validity window.

Fix in `lib/customer-portal/customerAssertion.ts`: only when `requireIssuedAt`
is enabled, independently require `iat <= now+60` and measure the maximum
900-second window from `min(iat, nbf ?? iat)`. Rejections precede replay consumption
and membership lookup. Existing customer defaults and staff replay expiry skew
are preserved. No SQL, schema, dependency, route or contract changes.

Signed behavior coverage:

- Future issuance masked by current/past `nbf`, including one second past skew.
- Earliest-claim windows of 901, 960 and 87,300 seconds are rejected.
- Normal 900-second windows and issuance/not-before at the 60-second skew limit
  are accepted; replay retention still lasts until `exp+60` and reuse is rejected.
- Expiry at `now-60` is rejected; expiry at `now-59` remains accepted within skew.
- Customer default issuance/not-before handling and unextended replay expiry
  remain compatible, including optional `iat` and previously accepted claim ordering.

Verification used Node `v22.23.3`, with
`PATH=/tmp/gridex-staff-node22/node_modules/.bin:$PATH` and the existing shared
dependency directory; no package installation or external service was needed.

| Command | Executed result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run __tests__/staff-api-context.test.ts __tests__/tenantservice-customer-assertion.test.ts` before the source fix | RED: exit 1; 6 signed timing regressions failed, 53 passed. Each failure resolved with an authorized staff context instead of rejecting. |
| Same focused command after the source fix | GREEN: exit 0; 59/59 tests passed in two files. |
| `npm run typecheck` | PASS: exit 0, application TypeScript. |
| `node node_modules/eslint/bin/eslint.js lib/customer-portal/customerAssertion.ts __tests__/staff-api-context.test.ts __tests__/tenantservice-customer-assertion.test.ts` | PASS: exit 0, no warnings or errors. |
| `node /tmp/gridex-staff-review/assertion-time-fix-proof.cjs` | PASS: original review reproduction pointed at this verifier without body changes. Normal 900-second token: `ok:true`, `consumed:true`; day-future issuance/current `nbf`: `ok:false`, `reason:not_yet_valid`, `consumed:false`. |
| `git diff --check` | PASS. |

Local receipts: `/tmp/gridex-staff-review/assertion-time-{red,green,typecheck,lint}.log`
and `assertion-time-fix-proof.{cjs,log}`. The committed signed tests are the durable
reproduction. Skill routing: receiving-code-review (validate the finding),
systematic-debugging (trace the claim calculations), test-driven-development
(RED before source edit), verification-before-completion (fresh executed receipts).
`using-superpowers` excludes dispatched subagents. Broad discovery/audit/design,
database, UI, performance, hook and skill-authoring workflows have no trigger in
this bounded verifier repair.

Local verification closes this timing defect only. Final composed-PR full suite,
clean replay and exact-head CI are root-owned and pending; no remote or hosted
database operation was performed here.
