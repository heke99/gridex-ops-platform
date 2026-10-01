# Support, phone and attachment continuation — 2026-09-30

This is a bounded source and proof continuation of T24, T26–T36 and T47. The
existing support implementation already prepares the requested same-case journey.
The new files close a **prepared-proof** gap for overlapping first creation in
two independent database transactions and two current portal sessions. They do
not modify production support behavior or authorize a caller through a phone
conversation. No native, HTTP or browser PASS is claimed here before the exact
candidate CI executes it.

## Owned changes and executed checks

- `__tests__/support-continuation-20260930.test.ts`: nine additional adapter and
  actual multipart cases. Customer projections fail closed on internal rows,
  an unconfigured clean status or download URL. Wrong reservation owner prevents
  upload. A revoked session at commit prevents accepted intake. Duplicate parts,
  client scanner results, asserted verification and storage keys are refused.
- `scripts/customer-support-continuation-20260930-native.config.ts`: requires
  `CI=true`, the supplied disposable status JSON and literal local Supabase
  `http://127.0.0.1:54321`. Database connections are fixed to local port 54322.
- `scripts/customer-support-continuation-20260930-native.test.ts`: three
  independently named native tests. Only the Next bundler marker is mocked;
  command/read adapters, actual database transactions and physical Storage bytes
  use the real migrated disposable stack.

Executed locally with Node 22.23.3 from the existing isolated Node cache:

```text
vitest run
  __tests__/support-continuation-20260930.test.ts
  __tests__/support-command.test.ts
  __tests__/support-attachments.test.ts
  __tests__/support-publication-session.test.ts
  __tests__/customer-delegation-assertion.test.ts
  __tests__/customer-delegation-boundary.test.ts
  __tests__/support-ops-read-boundary.test.ts
  __tests__/support-read-session.test.ts
8 files, 57 tests: PASS

eslint: the three newly owned TypeScript files: PASS
tsc --noEmit -p tsconfig.scripts.json --incremental false: PASS
```

These are additional qualification cases against existing behavior. There is no
new support implementation fix, so no fabricated implementation RED/GREEN claim.
Whole application/test type checks, independent review, build and native/HTTP/
browser/artifact equality remain the parent candidate gates. Local psql and
Docker are absent; native fixtures were **NOT_EXECUTED** locally. The shared
workflow, checksums, generated contracts, active memory and publication remain
root-owned.

## New native evidence prepared, not observed

| Expected marker | Concrete assertion |
| --- | --- |
| `SUPPORT_CONTINUATION_CONCURRENT_NATIVE_PASS` | The first portal create completes inside an uncommitted psql transaction. A second psql transaction uses another current `auth.sessions` row for the same actual owner and identical key/payload. The fixture observes its real `pg_stat_activity` lock wait before committing the first. Both results identify the same case; one result is new and one replay. There is exactly one case, thread, message, command result, command audit, domain event and outbox intent. Changed payload conflicts. Expired and deleted sessions cannot replay the completed command and leave the support graph unchanged. |
| `SUPPORT_CONTINUATION_QUARANTINE_NATIVE_PASS` | Actual inert suspicious text bytes are uploaded through the real intake adapter, then read back with service authority and hashed against the stored digest. Status remains quarantined. Anonymous Storage download fails and the customer DTO exposes no path/download URL. A different active owner in the same company cannot read/upload through the first customer's case reference. An expired portal session loses protected attachment read. No additional support graph effects follow denials. This does not test detection of real malware. |
| `SUPPORT_CONTINUATION_EXPIRED_CLIENT_NATIVE_PASS` | A real active API-client row with case read/write scopes and current account binding creates and reads its own case. After its `expires_at` passes, both protected read and completed-command replay fail with current actor denial, without changing support state. This tests the database relationship policy; the separate existing HTTP fixture tests signature and exact-action handling. |

Execution for root integration, after the existing disposable migrated-stack
startup and `GRIDEX_NATIVE_STATUS` setup:

```sh
npx vitest run --config scripts/customer-support-continuation-20260930-native.config.ts
```

No second proof workflow, stack reset or production migration is introduced.
All fixture identities, companies, account links and auth sessions are synthetic
rows confined to the disposable stack. They are actual database authority rows,
not fake authority accepted by a production caller. The new concurrency test is
distinct from the existing HTTP `Promise.all`: that older case retries an
already-completed creation and cannot establish overlap of first creation.

## Existing same-case journey traced

`e2e/browser/customer-support-local.spec.mjs` already creates the original
`Synthetic case A1` through the actual customer HTTP API and retains its canonical
reference. It continues that exact case with a customer reply, a staff-only phone
note and an explicit OPS customer answer. Its journey then adds one API and one
portal file as physical private uploads, publishes two explicitly authored staff
phone summaries, closes and reopens customer intake, and reads the resulting
conversation through the actual portal and API.

The final portal checks the same `case_reference`, final summary visibility,
absence of `INTERNAL SECRET SUPPORT NOTE`, phone channel and a `support_staff_`
author reference derived from the real staff identifier. API messages contain
`author_kind=staff` and `channel=phone`, never private actor/customer/company IDs.
The post-browser `scripts/customer-support-http-native.test.ts` independently
checks the same original case at support revision 8, two publication rows, actual
staff UUID/channel, the private unverified phone note, physical attachment hashes,
private Storage access, outbox counts and unchanged synthetic historical billing
rows. It emits `SUPPORT_JOURNEY_POST_NATIVE_PASS` only after those checks run.
Independent staff billing permission is exercised by the existing journey; the
caller's identity explicitly remains unverified.

These are source-confirmed prepared fixtures. Their marker names and screenshot
paths are not receipts from an executed candidate. No duplicate journey fixture
or edits to the shared billing/site/settings implementation are needed here.

## Original requirement outcomes in this bounded packet

| Requirement | Prepared or local evidence | Remaining acceptance boundary |
| --- | --- | --- |
| T24 concurrent same-key create | New real two-transaction/two-session first-create fixture with complete one-logical-case effects | Exact candidate native CI result required. |
| T26 right tenant and portal | Existing actual HTTP isolates A1/A2/B1; existing portal/browser and post-browser case counts | Exact candidate native/browser and deployed tenant site's actual consumer still required. |
| T27 phone continuation | Existing same API case receives a private phone note and explicit staff phone publication, then portal/API read | Exact candidate native/browser required. Phone identification is not inferred from continuation. |
| T28 identified customer without portal account | Existing command SQL prepares staff-authorized internal phone case for a customer without an account; no publication or caller account is created | Safe staff internal help is implementable. Caller-authorized disclosure or sensitive changes after real identification remain blocked by the absent approved phone identity/risk policy and provider. |
| T29 unidentified caller denied | Strict support inputs reject self-asserted verification; phone commands store internal, unverified staff records. Existing browser rejects untrusted caller sensitive profile changes | Real caller channel disclosure policy cannot be verified without a configured trusted provider. No public caller capability is issued by the internal case. |
| T30 changed contact is not account ownership | Existing issuer-bound assertion and current account lookup cannot be replaced by contact fields; phone `verified` fields are rejected | Real old-account ownership proof/enrollment remains unconfigured; contact/account changes are separate commands. |
| T31 expired/replayed/wrong-bound proof | Existing cryptographic unit cases cover expiry and issuer/action/customer binding; completed command retries recheck current authority | A one-time sensitive phone proof, consumption/replay ledger and real issuer are absent. Ordinary short-lived API assertions are deliberately reused for idempotent API retries and do not establish this requirement. |
| T32 no billing right from support mandate | Support routes have explicit `customer_cases.*` scopes and `cases.*` staff permission; billing has an independent scope/command. Existing journey treats staff billing authority independently | Full billing requirement outcome belongs to the billing owner's candidate evidence. A real phone delegate with no billing mandate cannot be qualified without the real caller policy/provider. |
| T33 private note remains private | Source SQL creates no public event/outbox for internal notes; public events carry identifiers/revision, not note bodies. Existing HTTP/browser/post-browser assert no note/body/private ID leak; new customer attachment projection rejects internal rows | Exact candidate runtime required. Actual external webhook/notification/transport provider delivery has no receipt in this packet. |
| T34 actual staff and channel | Existing explicit publication stores session-derived staff UUID and phone channel; portal exposes its derived staff reference; existing native/browser verify that same case | Exact candidate native/browser required; the displayed staff reference does not verify the caller. |
| T35 foreign attachment reference denied | Existing HTTP same-company/other-company denial; new native active sibling owner cannot read or upload via another customer's reference; local wrong reservation owner prevents byte upload | Exact candidate physical Storage/native/HTTP/browser required. |
| T36 unscanned/malicious quarantine | Schema permits only `quarantined`; actual upload/read DTO has no clean/download capability. Existing physical-file proof plus new inert suspicious bytes test; local clean/path injection denial | Quarantine behavior needs exact candidate native. Real malware detection, authenticated scanner verdict and clean-file release are explicitly blocked by an unconfigured scanner protocol/provider. This blocks release/scanner acceptance, not private intake. |
| T47 expired support mandate | New elapsed live session read/replay and API-client `expires_at` read/replay cases; existing current role/account/client revocation fixtures | Exact candidate native required for these implemented policies. A distinct time-bounded real phone delegate mandate is unconfigured and is not replaced by staff/API session tests. |

No original requirement is promoted to fully verified by local mocked adapter
tests or source inspection. The parent acceptance ledger must use executed exact
candidate receipts and retain the explicit scoped blockers above.

## Precise external blockers and safe implemented work

The repository has no configured trusted phone identity/risk provider or approved
old-account recovery/disclosure policy. A real contract must identify the issuer
and authenticated channel; bind a verified subject to the existing company,
customer and account; state the permitted exact action and billing mandate;
expire and revoke that mandate; and consume a single-use proof for sensitive
changes under transaction/replay rules. A new email, telephone number, known
customer number, staff-selected customer or `verified=true` is insufficient.
Until that contract/provider is configured and independently tested, only that
caller-authorized protected path is blocked. Staff with current session,
membership and `cases.write` can still record internal help and continue the
existing case; explicit customer publication remains attributable staff work.

The attachment scanner has no configured consumer/provider, authenticated verdict
contract or release implementation. Required evidence must bind a trusted scanner
verdict to the exact attachment owner and immutable stored-byte hash, deny
forged/replayed/wrong-bound verdicts, preserve infected/unscanned quarantine, and
authorize any clean-file release/read against current authority. The current
table constraint and DTO accept only quarantine. Therefore private reserve/upload/
commit, foreign-reference denial and actual bytes can be qualified independently;
malware detection and clean-file release remain explicitly blocked. No client
parameter, filename or superficial magic check substitutes for a scan verdict.

Storage and PostgreSQL do not share one transaction. If authority is revoked
after upload but before commit, private bytes and a pending reservation may
remain; the adapter denies success and the command does not create an accepted
attachment/scan intent. The local test verifies that denial, not orphan cleanup or
provider atomicity. The existing reserve/retry path preserves the key/hash and
only recovers a lost Storage response after comparing exact existing bytes.

Skills applied: repository systematic-debugging, test-driven-development /
writing-good-tests, spec-to-code-compliance, verification-before-completion,
Supabase and PostgreSQL lock/privilege guidance already read for this continuation.
No production write, external communication, issuer enrollment, scanner activation,
main merge or Ediel activation occurred.
