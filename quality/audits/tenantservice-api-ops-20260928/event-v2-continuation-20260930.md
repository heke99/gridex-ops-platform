# Event-v2 continuation — 2026-09-30

## Authority, ownership and preserved work

User instruction: fix the errors and continue the bounded event-v2 plan. No
production change, main merge or full phase/requirement acceptance is authorized.
Both PRs stay draft. This initiative uses its own checkpoint rather than changing
the unrelated Ediel session memory.

Starting #418 head: `9d2cca6456f743f3bfe80bedc3c196d8114ae9b6`.
Starting #422 head: `a826b5886e7b946ea10164d8f736eac07e8c6ac1`.
The original API checkout at `9ed10d8cb1d43effa819fb33111adf5461e71c9f`
and its six local later commits remain untouched. Its tree equals #422's
published tree. API work uses a separate clone and preserves that checkpoint.

Ownership was coordinated before editing in
[#418](https://github.com/heke99/gridex-ops-platform/pull/418#issuecomment-5908284631)
and [#422](https://github.com/heke99/gridex-ops-platform/pull/422#issuecomment-5908285076).
Recheck actual heads and competing writer comments before each non-force push.

## Confirmed dependency errors and bounded correction

The actual production dependency audit reported one high and one moderate
package finding. The first is `nodemailer@9.1.1`: the maintainer's
[GHSA-v53p-9fqp-m79j](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-v53p-9fqp-m79j)
describes expensive recipient-header parsing. A real parser subprocess with
40,000 repeated comment/bracket fragments exceeded its five-second deadline
on the old dependency. The child-process boundary prevents a vulnerable parser
from blocking the test runner. It is not a mocked parser.

The second is the existing `ip-address@10.3.1` override. The maintainer's
[GHSA-j6r3-76f7-8jcv](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-j6r3-76f7-8jcv)
describes incorrect cross-family network membership. The actual old library
returned true for an IPv6 address tested against an IPv4 network; the regression
failed while same-family positive/negative controls passed.

Pin `nodemailer@10.0.13` and override `ip-address@10.7.1`. These resolve all
findings in the executed audit, including the other advisories aggregated for
those two packages. The Nodemailer engine is now Node >=20, compatible with
the project's Node 22 baseline. Generate the lock with declared npm 10.9.2;
only the two package records and Nodemailer's root requirement change.
No runtime business source, schema, SQL function, audit threshold or workflow
is changed by this dependency correction. Real SMTP is never used in the tests.

## Executed local verification

| Check | Result |
| --- | --- |
| Old actual Nodemailer parser reproduction | RED: child timed out at 5 seconds |
| Old actual IP network reproduction | RED: cross-family membership incorrectly true |
| `npm run security:audit-production` after correction | PASS: info/low/moderate/high/critical all zero |
| Independent production `npm audit --omit=dev --json` | PASS: total 0 |
| Seven targeted files, new regressions plus existing Ediel/mail flows | PASS: 36/36 |
| New security/composition files after Buffer narrowing | PASS: 5/5 |
| Scoped ESLint, three new test files | PASS |
| `npm run typecheck` | PASS |
| `npm run typecheck:tests` after Buffer narrowing | PASS |

The three new test files are `nodemailer-address-parser-regression.test.ts`,
`nodemailer-composition-compatibility.test.ts` and
`ip-address-subnet-regression.test.ts`. In-memory stream transport verifies
authored plain/HTML mail, Ediel attachment encoding and exact raw MIME/envelope
compatibility. No communication is sent. An initial sandbox denial of child
process creation was rerun with permitted subprocess execution; no assertion,
timeout or required gate was weakened. The test type initially allowed a
Readable result; actual Buffer checks now validate and narrow both results.

## Ordered implementation and next action

1. Review and publish only the dependency correction on #418. Use the exact
   starting parent and non-force ref update. Await fresh exact-head CI including
   the unchanged native event-v2 replay, browser proofs and production audit.
2. Merge that exact #418 head into the isolated #422 checkout, preserving later
   API commits and original local work. Change the paginated events reader to
   `portal_customer_events_page_v2`; preserve guards, public DTO, limit + 1,
   tenant/customer/resource-bound cursor and deterministic ordering.
3. Add a disposable native HTTP proof using the actual route, actual Supabase
   RPC and signed synthetic delegation. Verify stored version >1, both sources,
   two customers, a foreign tenant, equal timestamps, pagination and cursor
   replay. Distinguish service-double tests from actual HTTP/database evidence.
4. Materialize a new paired immutable OpenAPI release and guide on #422 without
   rewriting historical release bytes. Verify existing later API contracts.
5. Review, recheck ownership/heads, publish non-force, and report the exact
   SHAs, RPC signature, fresh CI/native/HTTP results and remaining limits.

Current checkpoint: local dependency correction verified; independent review,
publication and fresh CI pending. Previously recorded event-v2 native evidence
is historical evidence, not a claim that this new head already passed CI.
The 75 T/U requirement statuses and full phase acceptance are unchanged.

## Skill routing

Applied: `systematic-debugging` and direct false-positive checks for actual audit
errors; TDD for real old/new dependency reproductions; worktree/clone isolation;
`writing-plans` for this ordered bounded delivery; `verification-before-completion`
and `requesting-code-review` for exact changes and truthful results. Independent
read-only review is the only delegated work. Supabase guidance and installed
Next.js route documentation apply to the subsequent RPC/HTTP integration.
Conditional: receiving review feedback and API contract parity on #422.
Skipped: repository-wide baseline audit, maintainer supply-chain inventory
(its trigger excludes dedicated active vulnerability scanning), UI/performance
work, schema optimization, hook installation and unrelated phase work. None is
triggered by these confirmed dependency corrections or the existing RPC switch.
