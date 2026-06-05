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
