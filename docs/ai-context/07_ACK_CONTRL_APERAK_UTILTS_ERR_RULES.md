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
