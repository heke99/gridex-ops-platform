# Bounded ERR differential review — 2026-09-29

## Decision and comparison

**APPROVE the bounded correction, conditional on authentic exact-new-head native and five delivery gates.** Zero introduced Critical/Important findings. One minor coverage suggestion from the independent reviewer was addressed by retaining two ordinary23505 cases. This is not full acceptance of ACK-08, AT-ACK-08, SC-044, U-03 or CALL-11/12/13.

Production comparison: test-only parent **a671a663aa00a08eaee7c2d52c6c117418c0ad8b** → working correction in `lib/ediel/ack.ts` and `lib/ediel/core/kernel.ts`. Fully verified pre-probe baseline is **0b6ea32ad7e284fc3eca30e827b16aab64614a31**. Parent is test/evidence-only; production files match that verified baseline. Main remains53bf989b. Independent reviewer and refutation agents were read-only; root owns edits/publication.

## Concrete behavior and authority

Before: the real ERR builder declares `ack`, while canonical ERR policy requires `functional_rejection`; actual validator rejects before writer/finalizer. A separately canonically qualified draft reaches the real duplicate gateway, where two physical IDEs with identical E87 reuse the first ACK ID/raw RFF+TN. Authentic test-only native407/411 reproduces both defects; all previous407 native tests pass.

After: ERR process comes from the canonical UTILTS profile already consumed by canonicalEdielPolicy. Transaction-scoped ERR lookup, source-operation identity and23505 recovery use the complete original IDE. Canonical validation, activated source-profile inheritance, legal tenant actor/route, actual writer and conditional finalizer still own execution.

| Changed boundary | Blast radius | Preserved condition | Evidence |
|---|---|---|---|
| Shared ACK builder process | ERR outbound draft from actual runtime; other ACK families retain `ack` | Canonical ERR profile owns businessProcess; validator is retained | Real SeptemberE19 and OctoberE87 tests; actual public consumer native |
| Kernel scoped duplicate lookup | Transaction-scoped APERAK/ERR only | Full relatedTransactionReference; no truncation to wire token or error code | Same-code shared-prefix distinct IDEs; different-code immutable first response |
| Source-operation key | Scoped original full IDE instead of ERR code | Company/source/family remain; legacy unscoped ERR code sequencing retained | Row operation identity and source policy assertions |
|23505 recovery | Same scoped family/outcome/full IDE lookup | Absent own IDE propagates error; APERAK-only obsolete constraint message remains APERAK-only | Two retained ordinary cases; independent real-kernel ERR/APERAK recovery2/2 |
| Durable final response | Existing actual writer/finalizer, unchanged | Own reservation receives own ACK; conditional update retains finalized row | Mixed outcomes; committed-first interruption; native full-row retry snapshot |

Product search found five caller files for buildAckDraft, six for buildUtiltsErrDraft and six for the active createCanonicalAckMessage (definition counted separately). The facade exports the new kernel gateway. The duplicate old definition in kernelLegacy is not exported there and has no direct product importer; refactoring it would widen scope without an active call path. Original scoped ACK/code sequencing is traced to kernel history661abbb42; shared `ack` process to builder historyffa95d78c.

## Adversarial scenarios and coverage

- Two long original IDEs share a prefix and E87: own ACK ID, RFF+TN, related reference, operation and reservation response.
- Mixed accepted, guide-negative and two functional-negative IDEs: positive/negative APERAK and ERR retain distinct scopes; only accepted IDE gets a series. Existing mixed-functional business consumption hold remains, so this does not close SC-044.
- Interruption before second real ERR insertion: committed first ACK and full reservation stay stable; real retry completes only the missing response and then remains identical.
- Legacy message-scoped E87/E10 ERR: separate code sequence keys and immutable retry.
-23505 after initial missing lookup: a matching committed ERR is recovered; another IDE's ERR cannot substitute. Synthetic IO proves changed branch ownership, not PostgreSQL race prevention.
- Native source capture: real unique family/date inbound evidence trigger; source policy is inherited by ACK. Full receipt/reservation, ACK timestamps/bytes/ID/policy, contracts and outbox are compared on retry.
- Guide/functional-negative IDEs never reach metering, billing or completion sinks. Clean positive source is an independent control. No transport worker is invoked.

Native interruption replaces only the second writer call with a pre-insert exception, then restores the actual writer; binding SQL, prior ACK write and finalizer are real. Ordinary tests mock only strict known Supabase IO, with unexpected tables/RPC and network forbidden.

## Verification and limits

Root:108/108 focused tests in six files; tests/scripts TypeScript PASS; scoped lint0errors/4 pre-existing unused warnings; canonical ACK persistence/chain/engine regression PASS; frozen33 originals/121/231 integrity and diff PASS. Independent reviewer:25/25 focused tests in four files, actual-kernel23505 recovery2/2, diff PASS. No local PostgreSQL/docker is available; required corrected native411/411 and five workflows are pending publication on the exact new head.

Optional uninvoked gridex-utilts-aperak-profile-regression.cjs fails the same stale implementation-string assertion on verified baseline0b6ea32a. The helper has replaced that literal condition; the unrelated oracle is not modified or represented as green.

Inherited concurrency limitation: ux_ediel_ack_related constrains the generated ACK transaction_reference and source_operation_id lacks a unique index. Concurrent same-IDE calls can both miss without producing23505. This change establishes full-IDE lookup/recovery for sequential retry; it does not establish atomic concurrent ACK reservation, repair earlier immutable wrong ACKs, or claim the entire multi-ACK loop is atomic. These remain distinct requirements.

The change introduces no SQL, schema/types, grants, authentication policy, dependencies or transport calls. Tenant/source/route adversarial coverage uses existing gates; this delta adds no new proof of those entire requirements. Risk is bounded business response identity/metadata, with actual native and mandatory delivery gates required before PR verification.

Historical203/IDE505 issuer/history/retention, positiveLOC175 registry/legal mandate/separate sink/final ACK owner, fullE035 and unknown earlier Storage causes remain open. Queued U-02 own-field, U-03 direct syntax/header, ACK-03 references and U-14 manual storage-authority findings are outside this correction. #421 remains draft, #310 untouched, traffic held; no staging, TGT/AGT, counterparty or actual sending.

## Actual delivery follow-up — canonical policy facade

D8eccdd6 actual native411/411 and clean replay109647751095 succeeded. Delivery guard nevertheless rejected the new direct utiltsRulebook import (FullE2E/OPS quality,6255/6256 ordinary pass). This introduced architecture error was missed by the first targeted review, and is corrected without guard/allowlist exemption.

Follow-up range d8eccdd6 → workingtree: one product fileack.ts plus strengthened existing dated ERR tests and evidence. Resolve canonicalEdielPolicy using generated own DTM137, matching validator policy date and catalog_evidence mode; let policy select association/guide. No change to full-IDE key, SQL, source capture, actor/route, finalizer, APERAK/CONTRL or transports. Local109/109 (7files), tests/scripts types, lint and route/ACK regressions PASS. Independent fresh reviewer8/8 ERR/authority tests PASS; bounded docs checked, with one stale checkpoint resume pointer corrected. Review approves the bounded delta with zero Critical/Important findings, pending exact-new-head delivery. Exact-new-head native/five gates remain pending. Earlier static review approval is superseded for the direct-import detail; concurrency and whole-contract limits remain unchanged.
