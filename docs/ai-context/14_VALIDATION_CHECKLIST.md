# Validation Checklist

Use relevant parts depending on task.

## General validation

- npm install if dependencies changed
- npm run typecheck if available
- npm run lint if available and meaningful
- npm run build
- run targeted tests if available
- inspect generated payload if EDIFACT changed
- confirm no unrelated files changed

## Ediel validation

Check:

- actual UNH/BGM message type
- sender Ediel ID
- sender subaddress
- receiver Ediel ID
- receiver subaddress
- environment
- route profile
- encryption state
- decryption state if inbound encrypted
- generated CONTRL
- generated APERAK
- generated UTILTS_ERR
- RFF references
- DOC references
- STS/ERC/FTX codes
- UNT segment count
- event log clarity
- tenant/company assignment
- send readiness result

## PRODAT validation

Check:

- BGM code
- NAD+FR
- NAD+DO
- relevant NAD roles such as Z02
- CCI/CAV where relevant
- RFF+Z05/RFF+LI/RFF+ACW where relevant
- permission engine result where relevant
- ACK chain

## UTILTS validation

Check:

- BGM
- DTM+597
- DTM+354 parsing
- QTY values
- transaction references
- message-scope vs transaction-scope APERAK
- UTILTS_ERR vs APERAK decision
- STS reason codes
- mandatory NAD parties

## Database validation

Check:

- migration applies cleanly
- no destructive change
- company_id/tenant scope exists where needed
- RLS policy is correct
- indexes exist for query-heavy tables
- server actions do not trust client company_id

## UI validation

Check:

- simple and professional text
- tenant users see normal business words
- no confusing message family labels
- clear next action
- clear error messages
- no hidden technical blocker without explanation
- tenant admin sees only what they should
- superadmin sees technical controls in a simple way

## Billing underlay validation

Check:

- customer belongs to correct tenant
- active agreement exists
- active site exists
- metering point exists
- billing period is selected
- no duplicate export exists for same period/site/customer
- price model exists
- fees are calculated
- VAT handling is consistent
- meter data exists or estimation rule is approved
- export run is auditable
- failed rows have clear reasons

## Audit validation

Check:

- important action creates audit event
- audit event has company_id
- audit event has actor/user/source
- before/after values are stored where useful
- manual override requires reason
- audit is visible in correct UI scope

## BRP/eSett/import validation

Check:

- file belongs to correct company_id
- uploaded_by is stored
- source type is selected
- period is selected or parsed
- parser detects file format correctly
- rows are parsed
- row-level errors are stored
- metering points are matched safely
- unmatched rows go to manual review
- duplicate rows are detected
- finalized billing data is not overwritten
- audit events are created
- tenant user cannot access other tenant files

## Platform billing validation

Check:

- usage prices are configurable
- default prices are seeded only as defaults
- admin can edit active prices
- usage events include company_id
- usage events have stable type/code
- price snapshot is stored on report line
- duplicate usage events are prevented where required
- duplicate finalized reports are prevented for same tenant/period
- manual adjustments require reason
- audit events exist for price/report changes
- customer billing underlay is not mixed with platform billing
