# Legacy native server marker and support fixture boundary

This is the separate bounded repair of actual clean candidate506's first native
failure, followed by its stale actor fixture. No production server-only barrier,
authority function, privilege, Ediel activation, lifecycle writer or shared
workflow was changed by this packet.

Actual CI506 reached the six-file native batch and dynamic
createTenantSupportCase → supportCommand import, failing with ERR_MODULE_NOT_FOUND
for bare server-only. Next ships its react-server marker export at the pinned
installed `next/dist/compiled/server-only/empty.js`, but no standalone bare
package was present. The exact six-file config now maps only /^server-only$/ to
that shipped file. The production import and default Next client rejection stay
intact. Database/auth modules have no new mocks.

The new smoke imports the **actual** existing native config in a child Vitest
process, with only private synthetic local config needed for module import.
Actual RED failed at missing server-only; GREEN reaches the unchanged 403 actor
gate for the legacy actorUserId-only shape before database/network access.
Fresh smoke **1/1 PASS** (included in combined 25/25); scoped ESLint and owned
TypeScript import-closure checks PASS. The actual full six-file native suite is
**NOT_EXECUTED** locally; actual next candidate CI is mandatory.

## Ordinary private support and explicit withdrawal

Root adjudicated this from original master T29/T32 and explicit separate
status/lifecycle rules (`masteruppdrag.md`, identity/contact separation and partner
failure/lifecycle sections). The old generic type other path reused assessWithdrawal,
which returns billingBlocked/manualReview even for non-withdrawal, then invoked
operational stops. Current explicit support command correctly creates an open,
private case with support_create; ordinary support intake must not confer billing
or lifecycle authority. This is a documented product boundary decision, not only
an event spelling update. Dedicated domain stop/withdrawal writers are unchanged.

The corrected actual native fixture uses actual auth.users/profile/membership,
live auth.sessions and selected-company cases.write. A separate real read-only
actor is denied before any support graph writes; its later status mutation is
also denied. No invented actor token or session helper substitutes for database
current authority.

The fixture seeds nonempty contract, monetary underlay, draft invoice/line,
customer-info/metering requests, outbound/partner queue, supplier switch and an
existing operation job. Full row snapshots of **19 existing company graph tables**
(customers, contract/supply, billing/invoice/docs, requests, queues, switch/events,
operation jobs/events/tasks, lifecycle decisions and canonical domain/outbox)
remain identical after generic support create, exact retry and allowed support
status update. There is exactly one immutable captured case INSERT and
support_create event, one canonical command result/audit and one private message.
Private OPS intake correctly produces **zero new customer domain/outbox/publication**
rows; existing outbox rows remain unchanged. Customer-public support notification
proof remains in the separately existing native/browser journey. A separately
enqueued actual job has one immutable INSERT and retry returns that same ID;
the prior job is unchanged.

Financial/lifecycle acceptance is retained through a **separate explicit
createCustomerCase withdrawal** producer test. Its live staff session/current
cases.write is established explicitly before the real legacy call. It positively
asserts stopped info/metering/outbound/partner flows, blocked underlay linked to
that case, cancelled contract, cancelled-before-start/lifecycle-blocked supplier
switch, actual withdrawal lifecycle decision and immutable operational_stop_applied,
supplier_switches_paused and lifecycle_blocked process facts. Existing invoice,
invoice line/document and job rows are preserved. No provider send, physical
issued-byte acceptance or actual customer mandate is fabricated.

This legacy withdrawal test is **producer/effect preservation proof**, not
acceptance of its whole legacy non-atomic caller authorization/session protocol.
The generic current support command has atomic authority; the older withdrawal
helper is a sequence of transactions and its wider caller policy remains the
root requirement-map gate. There was no production canonical support change.
Native fixture assertions and these two expected markers are prepared only:

- SUPPORT_PRIVATE_FINANCIAL_LIFECYCLE_BOUNDARY_NATIVE_PASS
- EXPLICIT_WITHDRAWAL_OPERATIONAL_STOP_NATIVE_PASS

Run the existing batch after disposable stack/history startup:

```sh
node node_modules/vitest/vitest.mjs run --config scripts/ediel-source-owner-native.config.ts
```

Skills used: systematic-debugging/fp-check (actual module import and implementation
trace), TDD for marker import, verification-before-completion and
spec-to-code-compliance. Full schema/fixture effects have not been replaced by
mock or test expectation alone. Root retains workflow/checksum/generated/memory/
publication ownership and must review the final candidate's actual native receipt.

## Exact frozen source manifest

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `scripts/ediel-source-owner-native.config.ts` | `9d8e01e2399b04b238f762b6557ba0730bf06273` | `fbdac72f4cc277d5d8eec38ad5a78a0037084b815983a7e1a80ebb4963b9e52b` |
| `__tests__/ediel-native-server-marker-20260930.test.ts` | `7120ad45b4ea6b11cbdffb540620ba4e6c9b1fb9` | `db6db51460f08b050f3eb22e5ce1002f2b1336a561e2585bf5d3405307f8ec0b` |
| `scripts/ediel-correction-context-native.test.ts` | `c50d76bca8d52d2d35c5fab95c135bfed0c2dcd0` | `eb5a52ef6eb610b1ba301c8e39c2034cb91f9e1c20960a68984c252e526508fe` |
