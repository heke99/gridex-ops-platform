# Current Task

## Status

Completed.

## Goal

Fix E5/Z14 inbound PRODAT test chain: generated positive CONTRL send block, incorrect negative APERAK decision for AGT E5/E6/E7 permission responses, and stale draft/failed ACK selection in test evaluation.

## Scope

Targeted Ediel/system-test fix for ACK send consistency, AGT PRODAT permission APERAK decision, and TGT/system-test step selection.

## Relevant files

- `lib/ediel/sendContextConsistency.ts`
- `app/admin/ediel/system-tests/actions.ts`
- `lib/ediel/tgtRegistry.ts`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`

## Do not touch

- UTILTS engine/rules
- Billing/import/platform pricing
- Customer UI unrelated to system tests
- Database schema/migrations
- RLS policies
- Encryption/certificate implementation

## Rules preserved

- CONTRL is a technical/syntax ACK.
- APERAK is an application/business ACK.
- Generated ACKs must be checked against their related inbound business message, not compared as if CONTRL/APERAK were the original business family.
- Do not bypass send guard.
- AGT E5/E6/E7 inbound permission responses require positive APERAK when the payload is syntactically accepted.
- Draft/failed ACK must not count as a passed Gridex outbound test step.
- No hardcoded inbound IDs, message IDs, timestamps or BGM references.

## Expected result

Inbound PRODAT Z14 in AGT E5 can remain parsed/passed, generated CONTRL can pass send consistency when linked to inbound PRODAT context, APERAK is resolved as positive for the AGT E5/E6/E7 permission-response cases, and the test view prioritizes sent ACKs over failed/draft candidates.

## Validation steps

- `npm install`
- `npm run typecheck`
- `npm run build` attempted, but timed out during Next.js optimized production build in this sandbox.
- `npm run ediel:rule-regression`
- `npm run ediel:production-readiness-regression`
- `npm run ediel:routing-security-regression`
- `npm run ediel:inbound-tenant-resolution-regression`

## Result

Implemented targeted fixes:

- ACK send consistency now compares selected test message family against the ACK's related inbound business family when the outbound message is CONTRL/APERAK/UTILTS_ERR.
- System-test APERAK decision now forces positive APERAK for valid AGT DGI/Energitjänsteföretag inbound permission responses E5, E6 and E7 instead of trusting stale/requested negative UI outcome.
- Stale non-reusable draft/prepared/queued ACKs for the same source/test decision are cancelled before new ACK creation.
- TGT/system-test evaluation now chooses the best candidate per step using `sent > failed > queued/prepared > draft` and latest timestamp within the same status rank.

Validation:

- Typecheck passed.
- Ediel rule regression passed.
- Ediel production readiness regression passed.
- Ediel routing security regression passed.
- Ediel inbound tenant-resolution regression passed.
- Build did not complete within sandbox timeout; no TypeScript errors were reported by typecheck.
