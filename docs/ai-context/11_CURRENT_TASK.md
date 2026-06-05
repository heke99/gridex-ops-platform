# Current Task

## Status

Completed.

## Goal

Make the Systemtest UI and backend understand the expected Z14/E5 ACK chain automatically, instead of relying on manual positive/negative selection.

## Scope

Targeted Systemtest fix for expected ACK decision and action rendering.

## Relevant files

- `app/admin/ediel/system-tests/actions.ts`
- `app/admin/ediel/system-tests/cases/[id]/page.tsx`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`

## Do not touch

- UTILTS runtime rules beyond existing Systemtest behavior
- Billing/import/platform pricing
- Customer UI unrelated to Systemtest
- Database schema/migrations
- RLS policies
- Certificate/encryption implementation

## Rules preserved

- CONTRL is a technical/syntax ACK.
- APERAK is an application/business ACK.
- Systemtest expected steps determine the recommended ACK outcome.
- UI must not allow normal Systemtest users to choose an outcome that contradicts the expected chain.
- Draft/failed ACK must not count as passed.
- No hardcoded inbound IDs, message IDs, timestamps or BGM references.

## Expected result

For AGT E5 inbound PRODAT Z14V, the Systemtest page should show only the recommended positive CONTRL and positive APERAK actions. Backend ACK creation should use the expected test-chain outcome even if an old/wrong manual outcome is submitted. Old negative draft ACKs should be superseded instead of reused as the current result.

## Validation steps

- `npm install`
- `npm run typecheck`
- `npm run ediel:rule-regression`
- `npm run ediel:production-readiness-regression`
- `npm run ediel:routing-security-regression`
- `npm run ediel:inbound-tenant-resolution-regression`
- `npm run build` attempted but timed out in sandbox during optimized production build.

## Result

Implemented targeted fixes:

- Backend now resolves expected ACK outcome from the Systemtest definition before creating an ACK.
- Backend decision follows the expected Systemtest outbound ACK outcome instead of trusting free manual positive/negative UI outcome when a definition exists.
- Stale draft/prepared/queued ACKs with a different outcome than the current backend decision are not reused.
- Systemtest case UI now renders only expected/recommended ACK buttons for the inbound message, not both positive and negative alternatives.

Validation:

- Typecheck passed.
- Ediel rule regression passed.
- Ediel production readiness regression passed.
- Ediel routing security regression passed.
- Ediel inbound tenant-resolution regression passed.
- Build did not complete within sandbox timeout; no TypeScript errors were reported by typecheck.
