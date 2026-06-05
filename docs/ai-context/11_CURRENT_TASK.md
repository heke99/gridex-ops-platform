# Current Task

## Status

Batch 1 implemented: Systemtest UI now follows backend ACK outcome, and E6 is aligned with the approved backend negative APERAK facit.

## Goal

Make Gridex stop treating UI/test definitions as the authority for APERAK positive/negative outcome. Backend decision engine is the source of truth; UI displays and sends the backend recommendation.

## Scope completed

- E6 AGT PRODAT Z14N definition now expects negative APERAK in the approved `facility_not_identified` scenario.
- Systemtest button label no longer hardcodes positive/negative APERAK.
- Outbound ACK rows get richer `systemTestAckSend` metadata:
  - requestedOutcome
  - effectiveOutcome
  - backendReason
  - backendRuleKeys
  - applicationErrors
  - ackScope
  - relatedTransactionReference
  - context
- Systemtest run evaluation reads backend/effective outcome from ACK metadata before flagging outcome mismatch.
- Generic non-production permission-negative scenario is handled for unlinked Z14/Z15/Z18 where the expected test path is negative.
- Production still requires manual review for unlinked Z14/Z15/Z18 instead of guessing.
- APERAK reference generation now prefers inbound raw `RFF+LI` over fallback row transaction reference.
- Composite `npm run ediel:regression` added.

## Important implemented rules

- Correct linked Z14N can still be positive APERAK.
- E6 approved facit: positive CONTRL + negative APERAK, ERC 40 / FTX 105, `The object could not be identified`.
- UI outcome is not authority; requested outcome is only a hint/comparison value.
- Sent opposite final ACK remains blocked.
- Wrong draft/prepared/queued ACK can be superseded.

## Changed files in this patch

- `app/admin/ediel/system-tests/actions.ts`
- `app/admin/ediel/system-tests/cases/[id]/page.tsx`
- `lib/ediel/tgtRegistry.ts`
- `lib/ediel/decisionEngine.ts`
- `lib/ediel/ack.ts`
- `scripts/ediel-rule-regression.cjs`
- `package.json`
- docs listed in changelog

## Validation to run locally

```bash
npm install
npm run typecheck
npm run ediel:regression
npm run build
```

## Next task

Batch 2 should build the full backend orchestrator/outbox foundation from the master spec: inbound pipeline, tenant resolution, customer/metering point/process matching, auto-ack policy, SLA timers, manual review queues and decision traces.
