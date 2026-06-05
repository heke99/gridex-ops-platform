# ACK, CONTRL, APERAK and UTILTS_ERR Rules

## Separation of ACK types

CONTRL:

- technical/syntax acknowledgement
- confirms whether EDIFACT message was structurally/syntactically acceptable

APERAK:

- application/business acknowledgement
- positive when business/application validation passes
- negative when business/application validation fails

UTILTS_ERR:

- functional error response where required by UTILTS functional rejection rules

## Do not confuse

Do not treat:

- positive CONTRL as business acceptance
- generated ACK family as same as inbound business family without checking message type
- route profile family as actual EDIFACT message type
- UI recommendation as source of truth over backend validation

## ACK send guard

ACK send guard must prevent mismatched sends, but it must classify messages correctly.

If a generated CONTRL is blocked because selected test suite/message family does not match generated message:

- inspect the classification logic
- inspect generated message metadata
- inspect selected test suite/message family
- inspect relation to inbound message
- inspect route profile/test matcher
- do not bypass the guard without proof it is wrong

## Event logs

When ACK send fails, event log should show:

- generated ACK type
- related inbound message ID/reference
- expected family/suite
- actual generated message family/type
- route profile used
- sender/receiver/subaddress
- encryption state
- reason for block

## Backend authority

The backend engine must be authoritative for:

- ACK type
- positive/negative result
- error codes
- send readiness
- route validation
- encryption validation

UI should display and explain, not silently override.

## 2026-06-05 Decision engine update — ACK lifecycle and idempotency

ACK lifecycle is production-critical.

### Immutable final ACK rule

Once a final ACK has been sent for the same source message/transaction/context, the system must not silently send an opposite outcome later.

Rules:

- correct ACK already sent => success / already_sent
- do not resend a sent ACK
- wrong draft/prepared/queued ACK => supersede or ignore
- wrong sent APERAK/CONTRL => block and require manual correction/review
- failed correct ACK may be retried or regenerated according to retry policy

Do not mark an already-sent correct ACK as failed because a resend attempt was blocked.

### Expected-vs-actual in TGT/AGT

TGT/AGT expected outcome is verification context, not production logic.

Flow:

1. Engine decides from payload + context + profile.
2. TGT/AGT comparator checks expected outcome.
3. If they match, continue.
4. If they conflict, raise rule_conflict/manual review.
5. Do not silently create the payload the test page wants if the engine disagrees.

### Forbidden ACK combinations

- no APERAK on APERAK
- no APERAK on CONTRL
- no CONTRL on CONTRL
- CONTRL on APERAK is allowed when required by the flow

## 2026-06-05 — UI follows backend outcome

Systemtest UI must not decide positive/negative ACK outcome.

Rules:

- The button text should not hardcode “positiv” or “negativ” unless it is rendering a backend preview.
- Form/requested outcome is only a hint for comparison, not authority.
- `systemTestAckSend.effectiveOutcome` / backend decision outcome is the expected actual outcome for sent Gridex ACK rows.
- Draft/prepared/queued ACKs are not passed; Gridex outbound steps pass only after final SMTP/send status.
- Sent ACK with backend outcome equal to actual payload outcome should pass even if an older static expected definition disagrees.
