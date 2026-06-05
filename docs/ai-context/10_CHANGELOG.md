# Changelog

Use this file after every Cursor task.

Template:

## YYYY-MM-DD — Task name

### Changed files

- path/to/file

### What changed

- Describe the change.

### Why

- Explain why this was needed.

### Validation

- npm run typecheck
- npm run build
- relevant tests/manual checks

### Regression risks

- List risks.

### Follow-up

- List unresolved items or "None".

## 2026-06-05 — Create AI context documentation

### Changed files

- CURSOR.md
- docs/ai-context/00_PROJECT_SNAPSHOT.md
- docs/ai-context/01_CURSOR_WORKFLOW.md
- docs/ai-context/02_ARCHITECTURE_MAP.md
- docs/ai-context/03_DATABASE_RLS_TENANT_RULES.md
- docs/ai-context/04_EDIEL_CORE_RULES.md
- docs/ai-context/05_PRODAT_RULES.md
- docs/ai-context/06_UTILTS_RULES.md
- docs/ai-context/07_ACK_CONTRL_APERAK_UTILTS_ERR_RULES.md
- docs/ai-context/08_APPROVED_TEST_FLOWS.md
- docs/ai-context/09_UI_UX_RULES.md
- docs/ai-context/10_CHANGELOG.md
- docs/ai-context/11_CURRENT_TASK.md
- docs/ai-context/12_KNOWN_RISKS_AND_REGRESSIONS.md
- docs/ai-context/13_OVERRIDE_PROTOCOL.md
- docs/ai-context/14_VALIDATION_CHECKLIST.md
- docs/ai-context/15_FILE_OWNERSHIP_MAP.md
- docs/ai-context/16_SECURITY_SECRETS_CERTIFICATES.md
- docs/ai-context/17_MAILBOX_POLLING_AND_DEDUPE.md
- docs/ai-context/18_SEND_READINESS_AND_ENVIRONMENTS.md
- docs/ai-context/19_DECISION_ENGINE_RULES.md
- docs/ai-context/20_DEBUGGING_PLAYBOOK.md
- docs/ai-context/21_UI_OPERATIONS_AND_BILLING_UNDERLAY.md
- docs/ai-context/22_BRP_ESETT_FILE_IMPORTS.md
- docs/ai-context/23_PLATFORM_BILLING_AND_USAGE_PRICING.md

### What changed

- Added the requested AI context/project memory documentation structure.
- Added root-level Cursor rules that point future work to the context files first.

### Why

- Future Cursor work should start from durable project context instead of scanning or rewriting the whole repository by default.

### Validation

- Verified git status/diff only includes documentation/context files.

### Regression risks

- None expected; documentation-only change.

### Follow-up

- Existing Ediel docs may be reviewed later for overlap and merged into the ai-context where useful.

## 2026-06-05 — Update AI context file ownership map

### Changed files

- docs/ai-context/15_FILE_OWNERSHIP_MAP.md
- docs/ai-context/10_CHANGELOG.md
- docs/ai-context/11_CURRENT_TASK.md
- docs/ai-context/00_PROJECT_SNAPSHOT.md

### What changed

- Replaced the generic file ownership map with a repo-specific map of actual Ediel, PRODAT, UTILTS, routing, inbound mail, billing/import, platform, RBAC and database areas.
- Added legacy Ediel docs that should be consolidated later without deleting the originals.
- Added known large files that must be handled carefully and not refactored casually.

### Why

- Future Cursor work should start from targeted file areas instead of scanning the whole repository.
- The repo contains large operational files and sensitive Ediel flows; narrow task scoping reduces regression risk.

### Validation

- Documentation-only update.
- No application code or migrations should be changed.
- App build is not required for this documentation-only change.

### Regression risks

- None expected; documentation-only.

### Follow-up

- Later consolidate `docs/ediel-elbolag-live-runbook.md` and `docs/ediel-operations-test-flow.md` into the relevant ai-context files.

## 2026-06-05 — Fix AGT E5/Z14 ACK send and APERAK decision

### Changed files

- `lib/ediel/sendContextConsistency.ts`
- `app/admin/ediel/system-tests/actions.ts`
- `lib/ediel/tgtRegistry.ts`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`

### What changed

- Updated send consistency so generated ACK messages are validated against their related inbound business family when linked to a test run.
- Added AGT DGI/Energitjänsteföretag E5/E6/E7 positive APERAK handling for valid inbound PRODAT permission responses.
- Cancelled stale non-reusable draft/prepared/queued ACKs before generating a new Systemtest ACK for the same source/test decision.
- Updated TGT/system-test step matching to prioritize `sent` messages over failed/draft candidates and newest candidates within each status rank.

### Why

- Inbound PRODAT Z14 was parsed correctly, but generated CONTRL was blocked because the send guard compared selected PRODAT family directly to generated CONTRL family.
- E5/Z14V could produce negative APERAK from stale/requested or over-aggressive permission validation even though the AGT E5 expected flow is positive CONTRL + positive APERAK for a valid inbound Z14V.
- Old draft/failed ACK rows could be selected by the test view and create false mismatch even after a newer correct message existed.

### Validation

- `npm install`
- `npm run typecheck` — passed
- `npm run ediel:rule-regression` — passed
- `npm run ediel:production-readiness-regression` — passed
- `npm run ediel:routing-security-regression` — passed
- `npm run ediel:inbound-tenant-resolution-regression` — passed
- `npm run build` — attempted twice; timed out during Next.js optimized production build in the sandbox before completion.

### Regression risks

- Low-to-medium: ACK send consistency now depends on `validation_report.sourceFamily`/related payload metadata for ACK messages. Existing ACK draft generation already stores `sourceFamily` and source IDs.
- AGT E5/E6/E7 positive APERAK override is scoped to test case code plus inbound PRODAT Z14/Z15 permission-response shape; it does not weaken generic production PRODAT validation.

### Follow-up

- Re-run `npm run build` locally/Vercel where build has enough time.
- Retest E5/Z14V end-to-end in Edielportalen: inbound Z14 parsed → positive CONTRL sent → positive APERAK sent.

## 2026-06-05 — Lock Systemtest ACK actions to expected chain

### Changed files

- `app/admin/ediel/system-tests/actions.ts`
- `app/admin/ediel/system-tests/cases/[id]/page.tsx`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`

### What changed

- Added a backend guard that resolves the expected ACK outcome from the Systemtest definition before creating CONTRL/APERAK/UTILTS_ERR.
- The backend now follows the expected outbound ACK step for the test case instead of trusting a free manual UI outcome when a Systemtest definition exists.
- Non-reusable draft/prepared/queued ACKs with a different outcome than the current backend decision are no longer reused and are superseded/cancelled.
- The Systemtest case UI now renders only the ACK actions expected by the test chain instead of offering both positive and negative CONTRL/APERAK options.
- The UI copy now explains that backend/test-chain logic selects positive/negative; the user only triggers the recommended expected ACK.

### Why

- E5/Z14 could be approved manually when the user selected the expected response, but the system still allowed wrong manual selections.
- The system must understand the expected chain itself: inbound PRODAT Z14V in E5 should guide the UI/backend to positive CONTRL and positive APERAK.
- Old negative APERAK drafts should not remain current when the expected test-chain decision is positive.

### Validation

- `npm install`
- `npm run typecheck` — passed
- `npm run ediel:rule-regression` — passed
- `npm run ediel:production-readiness-regression` — passed
- `npm run ediel:routing-security-regression` — passed
- `npm run ediel:inbound-tenant-resolution-regression` — passed
- `npm run build` — attempted; timed out during Next.js optimized production build in the sandbox before completion.

### Regression risks

- Low: UI now hides manual positive/negative alternatives on Systemtest case pages and exposes only expected ACK actions. Advanced manual override flows, if needed, should be implemented separately with reason/audit.
- Low-to-medium: backend expected-outcome forcing applies when a Systemtest definition contains an expected outbound ACK outcome. This is intentional for Systemtest flows and avoids wrong UI-selected outcomes.

### Follow-up

- Re-run full production build locally/Vercel where build time is sufficient.
- Re-test E5/Z14V: inbound Z14 parsed → recommended positive CONTRL sent → recommended positive APERAK sent.
- If a future test needs manual override, add a separate superadmin/debug override with required reason and audit instead of free positive/negative buttons in the main test flow.
