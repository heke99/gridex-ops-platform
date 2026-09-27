# F3 P-17 / ACK-02 / ACK-10: PRODAT whole-message response

Draft PR #414, based on remote `main` `2e4eeb65`. This is a bounded code and
consumer checkpoint, not formal Ediel acceptance or market activation.

## Authority and scope

- P26.A r3 (26.A/16.B, effective 2026-04-01), annex 4 p119: LIN/314 starts
  at 1 and increases without gaps. A sequence fault rejects the entire
  PRODAT message, with P-APERAK BGM/1225=27 and a relevant error.
- P26.A pp98–100, §§3.3–3.5: BGM/1225=34 for a processed message; BGM/1001
  and 1004 remain empty. RFF+ACW correlates to the original BGM/1004, while
  UNH/0062 is the reply's separate technical identity. UTILTS has its own
  D04A 312/313 profile and transaction references.
- The canonical `prodatRegisterGroups` owns the physical LIN sequence;
  `prodatFieldDiagnostic`/`projectProdatDiagnostics` own the typed 314 finding.
  The renderer requires both, for every faulty LIN, before selecting 27. A
  submitted string `314`, a cached reference, or an arbitrary caller outcome
  cannot grant a whole-message rejection.
  A second RED review case supplied a qualified 314 from a different physical
  object with the same LIN index; the renderer accepted it before the follow-up
  correction. The guard now also compares own LIN number, register position,
  object, agency and original UNH reference. That foreign error is held.

The actual consumer is `processInboundEdielMessage` → canonical response plan
→ `createAutomaticPositiveAcks` → `buildAperakDraft` →
`renderAperakEdiel` → canonical ACK message/outbox. The source is tenant-bound;
the outbound ACK route and legal sender are resolved by the existing canonical
gateway. This change does not create a route, actor or mandate. The whole
message is stopped before the PRODAT case writer and business state. A valid
LIN sequence with an object-local field 213 error still renders BGM34 and
its own RFF+Z07, not a fabricated sibling success.

## Reproduction and evidence

The real mocked inbound test changed the second LIN from 2 to 4 in a mixed
Z04, leaving original BGM/1004 `D`, source identities and tenant route intact.
Before the change it saved a negative APERAK with ERC42/314 but `BGM+++34`.
Afterwards it saves `BGM+++27`, `RFF+ACW:D`, field 314, a positive technical
CONTRL, two queued ACKs, no case/business effect and identical ACK IDs/outbox
locks on retry. First LIN 2 and duplicate LIN 1 are covered too. An unqualified
314 or positive shortcut on the defective source throws and creates no ACK.

The receiving side had a separate divergence: `classifyCanonicalInboundAck`
previously rejected every P-APERAK BGM27 as invalid. A RED test proved it.
The same outgoing P-APERAK is now parsed back as a negative D96A ACK; 27
with ERC100 remains invalid. The real inbound status updater persists a
tenant-scoped rejected ACK, marks only the correlated outbound row rejected,
and records a PRODAT BGM27 reason and review task rather than UTILTS BGM313.
An unmatched ACK still cannot update an outbound row. The direct consumer
test uses a source-shaped P-APERAK and checks the tenant/id filters.

Local focused tests: 37/37 across five files after the consumer correction;
app, tests and scripts typechecks, scoped lint and diff check passed. The native
`scripts/ediel-z04-ack-native.test.ts` extension adds a third synthetic tenant,
legal actor, route and source; it asserts persisted 27/314/ACW, tenant-bound
ACK/outbox, zero case/switch/supply writes and byte-identical retry. Script
typecheck and scoped lint pass locally. The preceding published head
`d8937505` passed OPS native 369/369, clean replay, schema snapshot and
generated type parity in run `36345730307`; exact-head CI for the subsequent
renderer and inbound-consumer correction is still pending. No staging, TGT/AGT, live
database or market send was run.

## Open qualification

The eight affected traceability rows remain `partial_code` pending native and
broader ACK-02/ACK-10 clauses. Other whole-message rejection causes need their
own source and qualified finding before 27 can be generalized. Historical
field 203 and IDE505 uniqueness, positive LOC+175's object/mandate/sink,
E035 history and retention, and full G06 grammar remain open. #310 is untouched.

Skill routing: local `using-superpowers`, `acquire-codebase-knowledge`,
`spec-to-code-compliance`, `systematic-debugging`, `test-driven-development`,
`differential-review`, `code-review`, `verification-before-completion`, and
Supabase native verification apply to this bounded protocol/storage path.
Broad UI/performance/supply-chain audits, migrations, and parallel agents are
outside this change; no schema or dependency is changed.
