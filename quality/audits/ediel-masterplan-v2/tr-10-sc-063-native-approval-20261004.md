# SC-063 — actual uncertain submission and restart

Approved: SC-063 only. TR-05, TR-10, AT-TR-05, AT-TR-10 and SC-040 retain
their existing unapproved/partial states. Complete frozen SC-063 condition,
expected behavior and prohibited behavior were independently reviewed by
ten07 against published `0c526deaa1209c0f0ae5c32d10ff909a4a710a83`, tree
`21ed90a81b5c7a9751b8f815ef367047d9cf67a6`.

Actual disposable Supabase execution: run37237701663, artifact11315843488,
ZIP SHA256 `5258af504678d635e7841a2ae45532b30dbdc0092e0408848746953fd09eb9e9`.
The independent reviewer verified checkout/tree, all nine input hashes against
Git blobs, and byte-identical extracted log/JUnit/receipt. The complete run is
28 total /18 PASS /10 FAIL /0 ERROR /0 SKIP; approval uses only the passing
SC-063 predicates, including all nine uncertainty-case tests. The ten failures
concern incoming ACK pointer linking, fresh-reception permissions and the
separate lock-wait fixture; they remain blockers for the other whole cards.

| Frozen effect | Actual asserting execution |
| --- | --- |
| Connection loss after possible SMTP acceptance | The real transport owner commits provider entry before the declared remote `ETIMEDOUT` at DATA. No private entered attempt or case is seeded. |
| Restart the worker | The actual after-DATA test calls fresh `processEdielOutbox` and `sendOutboxItem`; persistent queue/journal suppress entry, processing zero jobs or returning blocked. |
| Register unknown submission | Actual `delivery_uncertain` plus an entered unknown/unresolved attempt implements the frozen submission-unknown state, without marking delivery accepted. |
| Track before business retry | Actual generic/sealed/crash publishers create a technical `needs_tracking` case bound to tenant/environment/message/attempt/hash/archive. Recovery stays held; late same-attempt observation preserves the immutable opening and history. |
| No blind Z03 resend | The real restart test retains SMTP call count one and unchanged queue/original/effects; verified archive bytes remain bound to the original attempt. |
| No exactly-once delivery promise | The actual scoped copy/API exposes `authorizesResend=false` and `deliveryProven=false`; late acceptance is an observed result and grants no new entry. |

Asserting files:

- `scripts/ediel-tr-05-recovery-native.test.ts`: real after-DATA unknown/restart,
  pending entry/late outcome and accepted projection-repair predicates.
- `scripts/ediel-tr-10-reconciliation-native.test.ts`: all9 actual producer,
  current-scope/archive, immutable history, publication rollback, sealed visible
  entry/witness and late-outcome predicates PASS.
- Supported tag proofs: `scripts/test-ediel-tr-10-reconciliation.cjs`,
  `scripts/test-ediel-tr-10-worker-source.cjs`, and
  `__tests__/ediel-tr-10-reconciliation-copy.test.ts`.
- Raw native receipt is committed at
  `artifacts/masterplan-v2/ediel-tr05-tr10-native-0c526-receipt.json`.

Remote SMTP responses, tenant/legal/source-policy inputs, public clock and
failure injection are explicitly declared fixtures. This establishes actual
code/database behavior; external delivery, market certification and genuine
remote-hop/SPF evidence are not provided. The fixture/guard corrections after
the reviewed head do not alter these passing case/restart producer predicates.
Current composed native/capture and all ordinary exact-head
OPS/browser/upgrade/schema/type/parity checks remain mandatory before merge.
