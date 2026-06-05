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

## 2026-06-05 Decision engine foundation validation

### Required commands after applying patch

```bash
npm install
npm run typecheck
npm run build
```

Run these if present in `package.json`:

```bash
npm run ediel:rule-regression
npm run ediel:production-readiness-regression
npm run ediel:routing-security-regression
npm run ediel:inbound-tenant-resolution-regression
```

### PRODAT regression checks

- Correct Z14V linked to Z13/process => positive APERAK.
- Correct Z14N linked to Z13/process => positive APERAK.
- Correct Z14VH linked to Z13/process => positive APERAK.
- Invalid/unlinked Z14 => negative APERAK or manual review.
- Z14N must not be globally mapped to negative APERAK.
- No global `Z14 missing NAD UD/IT => negative APERAK` rule.
- Correct Z15V/Z18V => positive APERAK.
- Invalid Z15V status/reason => negative APERAK with ERC/FTX mapping.

### UTILTS regression checks

- TGT U3.1 correct E66 => positive CONTRL + positive APERAK.
- AGT UE1/UE2 context stays separated from TGT U3.
- application/anvisningsfel => negative APERAK.
- functional/process error => UTILTS_ERR.
- transaction-scoped APERAK keeps RFF+ACW pointing at the affected transaction.
- NULL values are only errors when the selected profile/quality code says they are errors.

### ACK lifecycle checks

- Correct sent ACK => success/already_sent.
- Sent ACK is not resent.
- Wrong draft/prepared/queued ACK is superseded/ignored.
- Wrong final sent APERAK/CONTRL is blocked/manual review.
- Draft/failed ACK does not count as passed.
- Engine-vs-expected mismatch in TGT/AGT raises rule_conflict/manual review instead of silently creating the expected payload.

### UI checks

- Tenant admin sees simple status: Pågår, Klar, Väntar på motpart, Åtgärd krävs, Tekniskt stopp.
- Technical terms and raw EDIFACT remain in superadmin/technical view.
- Tenant admin cannot manually choose positive/negative APERAK as the normal workflow.

## Decision node validation added 2026-06-05

After applying this patch, validate these exact cases:

- `decideProdatAperak()` returns positive APERAK for valid Z14N in TGT/AGT/test context.
- `decideProdatAperak()` returns negative APERAK for Z14 without valid CCI/CAV Z23 status.
- `decideProdatAperak()` returns negative APERAK with ERC 41 / FTX 324 for Z18 missing end reason.
- `decideProdatAperak()` returns negative APERAK with ERC 42 / FTX 322 for invalid Z15 status.
- `decideProdatAperak()` returns negative APERAK with ERC 42 / FTX 324 for invalid Z15 end reason.
- `decideProdatAperak()` returns manual review for production Z14/Z15/Z18 without safe process/permission link.
- Portal feedback where expected A902 is 40/41/42 and actual A902 is 100 is detected as mismatch.
- `ensureExpectedAckSent()` returns `already_sent_success` for correct final ACK.
- `ensureExpectedAckSent()` returns `blocked_final_ack_exists` for opposite final ACK.
- `ensureExpectedAckSent()` returns `supersede_replaceable` only for draft/prepared/queued/failed/cancelled ACK.
- `decideUtiltsResponse()` keeps AGT UE1/UE2 separate from TGT U3 and selects UTILTS_ERR where applicable.

## E6 / backend-driven ACK validation

Check:

- E6 inbound PRODAT Z14N can produce positive CONTRL + negative APERAK.
- Negative APERAK contains `BGM+++34`, `ERC+40::260`, `FTX+AAO++105::260+The object could not be identified`.
- APERAK preserves `RFF+ACW` to inbound BGM/document reference.
- APERAK preserves `RFF+LI` from inbound line/reference.
- Systemtest UI shows the backend/effective outcome, not stale static expected positive.
- Button text does not offer a manual positive/negative choice.
- Sent opposite final ACK is blocked.
- Wrong draft/prepared/queued ACK is superseded.

## Backend automation foundation validation

Kör efter patch:

```bash
npm run typecheck
npm run build
npm run ediel:automation-foundation-regression
npm run ediel:regression
```

Databas:
- Kör `20260605160000_ediel_backend_automation_foundation.sql`.
- Kontrollera att dessa finns: `ediel_processing_runs`, `ediel_decision_traces`, `ediel_outbox`, `ediel_ack_lifecycle`, `ediel_process_links`, `ediel_match_candidates`, `ediel_portal_validation_feedback`, `ediel_sla_timers`.
- Kontrollera att `ediel_permissions` och `ediel_unresolved_messages` finns som vyer.

Flödestest:
- Importera inbound PRODAT Z14/Z15/Z18 och verifiera decision trace.
- Kontrollera att osäker business match ger manual review, inte autoskick.
- Kontrollera att redan skickad motsatt final ACK blockerar ny ACK.
- Kontrollera att draft/prepared motsatt ACK supersedas.
- Kontrollera `/admin/ediel/portal-feedback` efter import av portalrapport.
