# Decision Engine Rules

## Backend authority

Backend decision engines must be the source of truth for:

- ACK result
- positive/negative APERAK
- UTILTS_ERR vs APERAK
- send readiness
- route selection
- encryption requirement
- tenant resolution
- billing/export validation
- import row validation
- platform usage event creation

UI can recommend and display, but must not override backend decisions silently.

## No hardcoded test fixes

Decision logic must not hardcode:

- inbound id
- message id
- test run id
- customer id
- metering point id
- timestamps
- one-off reference strings

Use actual payload data, configuration, route profile, actor settings and environment.

## Manual override

Manual override must be explicit, audited and reasoned.

Manual override must not silently bypass:

- tenant routing
- send readiness
- encryption readiness
- billing export finalization
- finalized import correction
- platform billing finalization
