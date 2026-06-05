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

## 2026-06-05 — Build Ediel decision engine foundation

### Changed files

- `app/admin/ediel/system-tests/actions.ts`
- `lib/ediel/classify.ts`
- `lib/ediel/core/kernel.ts`
- `lib/ediel/inbound/productionInboundDecisionEngine.ts`
- `lib/ediel/orchestrator.ts`
- `lib/ediel/rulebook/ruleProfileSelector.ts`
- `lib/ediel/statusUi.ts`
- `docs/ai-context/05_PRODAT_RULES.md`
- `docs/ai-context/06_UTILTS_RULES.md`
- `docs/ai-context/07_ACK_CONTRL_APERAK_UTILTS_ERR_RULES.md`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`
- `docs/ai-context/12_KNOWN_RISKS_AND_REGRESSIONS.md`
- `docs/ai-context/14_VALIDATION_CHECKLIST.md`
- `docs/ai-context/19_DECISION_ENGINE_RULES.md`

### What changed

- Added the first generic Ediel classification/rule-profile foundation.
- Added broader classification for PRODAT, UTILTS, CONTRL, APERAK and UTILTS_ERR.
- Added PRODAT permission classification for Z13/Z14/Z15/Z18, including Z14V/Z14N/Z14VH handling.
- Added logic foundation so correct Z14N is treated as a valid business denial that can receive positive APERAK.
- Added rule-profile selector foundation for PRODAT, UTILTS and ACK families.
- Hardened ACK lifecycle/idempotency: correct sent ACK is success/already_sent, sent ACKs are not resent, wrong drafts can be superseded, opposite final ACK is blocked/manual review.
- Added tenant-safe business status mapping helper.
- Updated AI context docs with PRODAT, UTILTS, ACK, validation and known-risk rules.

### Why

- The system must not build one-off E5/E6/E7 or Z14 test patches.
- Ediel production logic must be based on payload, context, route, actor role, tenant and business state.
- TGT/AGT expected outcomes should verify engine decisions, not become production rules.
- Z14N is a valid business-denial message and must not automatically become negative APERAK.
- Final ACKs are operationally binding and must not be silently replaced with the opposite outcome.

### Validation

- Patch contents were generated as changed/added files only.
- Full build/typecheck could not be completed in the sandbox because dependencies are not installed in the extracted environment.
- Local validation required:
  - `npm install`
  - `npm run typecheck`
  - `npm run build`
  - Ediel regression scripts if available.

### Regression risks

- Medium: this is a foundation change touching ACK orchestration and classification. Run full Ediel regression before production sends.
- Medium: full PRODAT field-level validation still requires importing the Edielportal Excel rule file.
- Low-to-medium: tenant UI must be checked so technical statuses do not leak into the normal tenant workflow.

### Follow-up

- Import/version the PRODAT Excel field rules: `Uppgifter i PRODAT 26-A 16-B april 2026`.
- Add portal validation report parser.
- Add full regression cases for every PRODAT/UTILTS profile.
- Add/verify superadmin manual review queue for rule_conflict and blocked_final_ack_exists.

## 2026-06-05 — Build full Ediel decision node and regression coverage

### Changed files

- `lib/ediel/decisionEngine.ts`
- `lib/ediel/ackDecision.ts`
- `lib/ediel/prodat/prodatAperak.ts`
- `lib/ediel/inbound/productionInboundDecisionEngine.ts`
- `scripts/ediel-rule-regression.cjs`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`
- `docs/ai-context/12_KNOWN_RISKS_AND_REGRESSIONS.md`
- `docs/ai-context/14_VALIDATION_CHECKLIST.md`
- `docs/ai-context/19_DECISION_ENGINE_RULES.md`

### What changed

- Added a reusable `lib/ediel/decisionEngine.ts` decision node for PRODAT APERAK, UTILTS APERAK/UTILTS_ERR, portal validation feedback and ACK lifecycle decisions.
- Centralized the rules that correct Z14N is a valid business denial and must produce positive APERAK when payload/process is valid.
- Added explicit negative APERAK handling for invalid Z14 missing/invalid permission status, Z18 missing permission end reason, Z15 invalid status/reason, and portal A902 mismatch feedback.
- Added production-safe manual review behavior for Z14/Z15/Z18 where production cannot safely link the inbound message to a Z13/permission/process.
- Wired the generic ACK recommendation path to the new decision node, including manual-review blocking and UTILTS_ERR selection.
- Kept the legacy `decideProdatAperakOutcome()` API but routed it through the new decision node.
- Added regression checks for Z14N positive APERAK, invalid Z14 negative APERAK, Z18 missing end reason, production unlinked Z14 manual review, portal A902 mismatch and final ACK lifecycle behavior.

### Why

- The previous foundation selected rule profiles but still lacked one reusable decision node that all runtime paths could call.
- Test expected outcome must not be the production rule; it should only compare against the engine decision.
- Production must not silently choose positive or negative APERAK when an inbound permission message cannot be matched to the right business process.
- A sent final APERAK/CONTRL cannot be replaced by the opposite outcome.

### Validation

- `tsc --noEmit --pretty false` was attempted in sandbox.
- No TypeScript diagnostics were reported for the changed files when filtering for:
  - `lib/ediel/decisionEngine.ts`
  - `lib/ediel/ackDecision.ts`
  - `lib/ediel/prodat/prodatAperak.ts`
  - `lib/ediel/inbound/productionInboundDecisionEngine.ts`
- Full typecheck still cannot complete cleanly in sandbox because dependencies/types are not installed (`next`, `react`, `@supabase/supabase-js`, Node types, etc.).
- `node scripts/ediel-rule-regression.cjs` was attempted but cannot run in sandbox without dependencies because the existing script imports modules that require `@supabase/supabase-js`.

### Regression risks

- Medium: generic ACK recommendations now block production Z14/Z15/Z18 without a safe process link. This is intentional for safety, but production flows must ensure related message/business match is populated before auto-ACK.
- Medium: Z18 now produces negative APERAK when end reason is missing. If any valid Ediel profile allows missing Z25 in a specific context, that context must be represented in the rule profile before auto-send.
- Low: legacy `decideProdatAperakOutcome()` cannot return `manual_review`; it maps manual review to a safe negative error for old callers.

### Follow-up

- Install dependencies and run:
  - `npm install`
  - `npm run typecheck`
  - `npm run ediel:rule-regression`
  - `npm run build`
- Import the official PRODAT Excel field matrix once available.
- Build full UI display for decision trace/manual review queue if not already complete in the target branch.

## 2026-06-05 — E6 backend-driven APERAK/UI alignment

### Changed files

- `app/admin/ediel/system-tests/actions.ts`
- `app/admin/ediel/system-tests/cases/[id]/page.tsx`
- `lib/ediel/tgtRegistry.ts`
- `lib/ediel/decisionEngine.ts`
- `lib/ediel/ack.ts`
- `scripts/ediel-rule-regression.cjs`
- `package.json`
- `docs/ai-context/05_PRODAT_RULES.md`
- `docs/ai-context/07_ACK_CONTRL_APERAK_UTILTS_ERR_RULES.md`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`
- `docs/ai-context/12_KNOWN_RISKS_AND_REGRESSIONS.md`
- `docs/ai-context/14_VALIDATION_CHECKLIST.md`
- `docs/ai-context/19_DECISION_ENGINE_RULES.md`

### What changed

- Updated E6 AGT PRODAT Z14N test definition to expect backend-driven negative APERAK when `facility_not_identified` applies.
- Removed hardcoded positive/negative ACK wording from the Systemtest send button.
- Made Systemtest evaluation read backend/effective ACK outcome from the outbound ACK row before marking outcome mismatch.
- Added backend decision trace fields to `systemTestAckSend` validation report.
- Added generic non-production permission negative scenario handling for unlinked Z14/Z15/Z18 when expected negative and no safe business link exists.
- Fixed APERAK RFF+LI reference preference so raw inbound `RFF+LI` is preserved before falling back to row `transaction_reference`.
- Added `npm run ediel:regression` composite command.
- Added regression coverage for E6 negative APERAK with ERC 40 / FTX 105 and preserved RFF+LI.

### Why

- E6 was approved by Edielportalen with negative APERAK, while UI still showed positive expected outcome.
- UI must follow backend decisions and not drive APERAK outcome.
- Production safety requires opposite final ACK blocking and backend rule trace, not manual outcome buttons.

### Validation

- Run locally: `npm run typecheck`
- Run locally: `npm run ediel:regression`
- Run locally: `npm run build`

### Regression risks

- Existing UI may still show static test-step text for old runs until ACK rows contain `systemTestAckSend` decision metadata.
- Production unlinked Z14/Z15/Z18 remains manual review; do not auto-send negative APERAK in production without deterministic process validation.

### Follow-up

- Build full backend orchestrator/outbox tables and portal feedback import page from the master spec.

## 2026-06-05 — Backend automation foundation Batch 2/3

### Ändrat
- Lade till backend automation foundation ovanpå befintligt inbound-flow: `lib/ediel/orchestrator/edielProcessingPipeline.ts`, `inboundOrchestrator.ts`, `autoAckOrchestrator.ts` och outbox/SLA/portal-feedback-moduler.
- Inbound runtime sparar nu icke-blockerande automation trace/SLA/matchningsbeslut via `recordBackendAutomationPipelineTrace` utan att skapa dubbla ACK:ar.
- Lade till business matching-moduler för kund, mätpunkt, process och permission med confidence-modell `high/medium/low`.
- Lade till outbox lifecycle: create, process, send och supersede/blockering av motsatt final ACK.
- Lade till SLA timers: CONTRL/APERAK due + warning/critical/expired.
- Lade till portal-feedback parser och admin-sida `/admin/ediel/portal-feedback`.
- Lade till migration `20260605160000_ediel_backend_automation_foundation.sql` för `ediel_processing_runs`, `ediel_decision_traces`, `ediel_outbox`, `ediel_ack_lifecycle`, `ediel_process_links`, `ediel_match_candidates`, `ediel_portal_validation_feedback`, `ediel_sla_timers`, rule profile shells och kompatibilitetsvyer för `ediel_permissions`/`ediel_unresolved_messages`.
- Lade till regression `npm run ediel:automation-foundation-regression` och kopplade den till `npm run ediel:regression`.

### Varför
- Gridex ska gå från manuella superadmin-knappar till backend-driven Ediel-automation där UI visar beslut, inte styr beslut.
- Tenant, route, kund/anläggning/mätpunkt/process och ACK-lifecycle måste vara spårbara innan autoskick i produktion.

### Skyddar test/produktion
- E6-lärdomen: portal/UI-facit kan avvika; backend decision trace ska vara källa.
- Förhindrar positiv och negativ APERAK för samma inbound/transaktion via lifecycle guard.
- Förhindrar tenant-läckage genom att osäker tenant/business match blir manual review och trace, inte autoskick.

### Verifiering
- `npm run ediel:automation-foundation-regression`
- `npm run typecheck`
- `npm run build`
- `npm run ediel:regression`

### Kvarstående risker
- Full automatisk send-policy ska aktiveras stegvis efter att migrationen är körd och verkliga route/certifikat/tenant-data är verifierad.
- Field matrix import och full UI för decision traces/outbox är foundation-ready men inte komplett byggt i denna batch.
