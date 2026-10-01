# Separate verified invoice redelivery decision

This package implements the previously absent local T17 decision. It does not
activate provider delivery or change an issued invoice, captured request,
underlay, pricing row, invoice line or document. The previous billing and import
packages remain unchanged. No hosted write, provider traffic, email, commit or
push was performed by this owner.

## Evidence and resulting behavior

The first PostgreSQL-core test called the real missing command and failed with
SQLSTATE `42883`. The first command/action suite failed on its missing module.
Both now execute the implemented production functions successfully. This is a
new local capability; a successful retry of invoice creation is not redelivery.

`gridex_record_invoice_redelivery_decision_v1` is service-only and checks the
current active company/customer, OPS user/profile/membership, server-derived
session and the existing `billing_underlay.export` permission. It locks the
same current authority rows as existing profile commands. An advisory key lock
serializes competing tenant idempotency keys; current authority is checked
after waiting and before returning even a completed replay.

The destination is derived from canonical customer defaults and explicit
contract overrides with their current revisions. Missing fields inherit;
explicit null does not. Contact email is never a fallback. A selected active
`owner` account must belong to this customer and company and have a real local
Auth `user_id` with a consistent local alias. Existing matching portal identity
rows cannot be inactive or ambiguous. General portal access and the `billing`
or `viewer` account roles do not establish the supported owner mandate.

A narrow private definer helper locks and reads the current Auth user. It
requires a current confirmed email, no deletion/ban, and an exact match with
the current effective billing email. No submitted email or verified flag is
accepted as evidence. Auth table grants, Auth identities and account roles are
unchanged. The final session clock and Auth evidence check occurs after local
inserts, so late expiry rolls the transaction back.

The original sent provider GUID, request and current issued financial rows are
sealed in a separate immutable decision. Item then invoice locks follow the
provider-event lock order. Invoice row locking also stabilizes existing parent
foreign-key dependencies; lines and document rows are separately locked.
Financial hashing includes the original invoice (excluding lifecycle status,
paid time and update time), original request/GUID and ordered invoice lines.
Document hashing seals ordered customer/company/invoice-bound document rows
and their nonempty file references. These are database reference hashes, not
verification of remote PDF bytes.

A separate internal domain audit event and the decision commit together. No
transport outbox entry is created. Delivery remains
`blocked_provider_adapter`; its table constraint and immutability guard prevent
that local decision from being reinterpreted as a delivered invoice. Replay
checks authority, request intent, revisions, Auth confirmation evidence and
both original hashes; changed inputs/proof/history conflict.

## Actual OPS binding

The sent invoice detail page exposes a link only for its current actor/tenant
with export permission (or its platform context). The new decision page guards
the selected company before invoice/resource queries, displays the shared
resolver's current email/source/revisions and reads the configured tenant
channel. Owner options are constrained by company/customer/active/owner and
local identity. Read-only or unavailable owner/channel projections disable the
form. The command repeats all authority checks under database locks; the page
is not an authorization token.

The real exported form action calls the canonical decision command. It rejects
unexpected verification/actor fields and missing revisions, uses the current
server session, normalizes UUID case and checks returned resource/revision/hash
and blocked-delivery state. Public errors contain safe fixed messages. Cache
refresh failure preserves the confirmed decision outcome and asks for reload.
Revalidation targets the real invoice export-item route.

The client controls its reason and selected account, preserving drafts across
returned errors. Pending and completed states disable submission. It says
“Leveransbeslut skapat” and explicitly distinguishes that result from a future
delivery through the invoice partner. No external API/OpenAPI surface was added.

## Verification receipt

| Proof | Exact command / result |
| --- | --- |
| Production SQL RED | `NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/invoice-redelivery-decision-20260930.postgres.test.cjs` before implementation: 1 failed, missing function `42883`. |
| Production SQL GREEN | Same command: 6/6 passed. Positive separate decision/replay, 17 rejection variants, 7 changed/revoked replay variants, immutable table/ACL/direct-insert rejection, explicit override preservation, final live session expiry and late insert fault rollback. A temporary nontransactional sequence proves the expiry fixture reached the post-insert delay rather than failing at preflight. |
| Actual module/action/UI | `node22 node_modules/vitest/vitest.mjs run __tests__/invoice-redelivery-decision-20260930.test.ts __tests__/invoice-redelivery-ui-20260930.test.ts`: 16/16 passed (10 command/action, 6 page/component/form). |
| Frozen import regression | The same run with `__tests__/billing-import-action-outcome.test.ts` and `__tests__/customer-import-billing-separation.test.ts`: 36/36 passed in 4 files. |
| Lint | ESLint on the 7 touched/new TS/TSX files: 0 errors/warnings. CJS fixtures are ignored by the repository ESLint pattern; they are executed by Node and syntax-checked separately. |
| Final syntax/diff | Node `--check` on both CJS files and `git diff --check` on all 12 package paths: PASS. Final SQL core 6/6 and actual source/UI 16/16 were repeated after the last change. |
| Native full history | `psql "$NATIVE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/invoice-redelivery-decision-20260930-native.sql`: prepared, NOT EXECUTED locally. It seeds synthetic current grants/session/owner, locks original billing configuration, captures the request/GUID, creates original financial/line/document references, changes the billing default through the real command, records/replays the separate decision and compares the whole original invoice/item/underlay/pricing/line/document graph. It also checks wrong customer/company/actor/proof/revision, ACL, final-clock marker and late-fault rollback. |

`node22` above is `/tmp/ediel-toolchain/node_modules/node/bin/node`.
The core runtime is PGlite 0.3.14/PostgreSQL 17.5 with reduced schema and the
production canonical permission/session/authority bodies. Its tiny digest
adapter uses PostgreSQL's SHA-256 primitive. It is not a complete migration
replay, PostgREST, two independent database sessions, browser or remote provider
test. Page/component tests execute actual components with controlled server and
hook boundaries; they do not prove native browser form reset/navigation.
Root owns integrated application/test typechecking, native workflow inclusion,
generated schema/types/checksums and publication.

Frozen migration SHA-256:
`8565f0e7515bc231757d3e59308e8430bda4b848dd1d61c83335525579240f8e`.

## Original requirement outcome boundaries

| Requirement | This package's verified contribution | Remaining boundary |
| --- | --- | --- |
| T17 | Local separate immutable decision, current owner/Auth verification, traceable actor/revisions, positive SQL and actual OPS action path. | Full native history and real browser not executed locally. Actual provider redelivery method/acknowledgement is absent; agency/external Auth ownership has no supported verification source. These components remain expressly blocked. |
| T01/T02/T07/T08/T09/T10/T25 | Scoped owner/resource rejection, no request-supplied verification, selected-company action/page denial, service-only ACL, current and revoked replay authority. | Native current-session/RLS/HTTP journeys remain separate gates; no whole requirement accepted from mocks/core alone. |
| T14/T15 | Current explicit contract email is chosen independently of changed default; selected revision and source are captured. | Shared readiness/export acceptance belongs to the existing billing/native package. |
| T16 | Core command leaves whole original financial/line/document rows unchanged; native profile-change plus decision fixture compares the whole original issued graph. | Real storage byte immutability is not established by a document-row hash. |
| T18/T20/T22/T23 | Revision checks, atomic late failures, strict replay and key intent conflicts are executed in the SQL core. | Core concurrent requests are serialized by one engine; no claim of two-session scheduling or crash/HTTP replay. |
| U01/U02/U03/U04/U05/U09/U17/U20 | Actual page/link/form/action binding, scoped disabling, pending/completed lock, safe persisted vs blocked-delivery outcome, controlled retained error drafts. | Native browser, refresh/back/leave behavior, screen-reader journey and navigation guards are unverified; no blanket U acceptance. |

Independent read-only SQL review by the requirements owner and OPS source/UI
review found no concrete source blocker within this narrow local scope. Owner
labels use the existing scoped recorded account address, without claiming it is
fresh Auth verification; the command supplies that proof separately. No
speculative agency mandate, email-only customer lookup, new Auth
verification mechanism or documented provider resend contract was introduced.

## Frozen package files

- `supabase/migrations/20260930222346_invoice_verified_redelivery_decision.sql` (created by Supabase CLI)
- `lib/billing/invoiceRedeliveryDecision.ts`
- `app/admin/billing/invoices/[id]/redelivery-actions.ts`
- `app/admin/billing/invoices/[id]/redelivery/page.tsx`
- `app/admin/billing/invoices/[id]/redelivery/RedeliveryDecisionForm.tsx`
- `app/admin/billing/invoices/[id]/page.tsx` (narrow navigation link)
- `__tests__/invoice-redelivery-decision-20260930.test.ts`
- `__tests__/invoice-redelivery-ui-20260930.test.ts`
- `scripts/invoice-redelivery-decision-20260930-core.cjs`
- `scripts/invoice-redelivery-decision-20260930.postgres.test.cjs`
- `scripts/invoice-redelivery-decision-20260930-native.sql`
- this report
