# Cursor Project Rules

Before making changes, read:

- /docs/ai-context/00_PROJECT_SNAPSHOT.md
- /docs/ai-context/01_CURSOR_WORKFLOW.md
- /docs/ai-context/11_CURRENT_TASK.md

Do not scan or rewrite the full repository by default.

Start with relevant files only.

If more files are needed, explain why.

Preserve approved flows unless Override Protocol is followed.

Update changelog after every completed task.

Never hardcode test IDs, inbound IDs, metering point IDs or one-off references.

Keep changes production-safe and tenant-safe.

Production runs on Vercel. Do not rely on local-only binaries or self-hosted services for production-critical flows.

When returning files or patches, return only changed or added files. Do not return the full repository unless explicitly requested.

For Ediel tasks, also read:

- /docs/ai-context/04_EDIEL_CORE_RULES.md
- /docs/ai-context/05_PRODAT_RULES.md
- /docs/ai-context/06_UTILTS_RULES.md
- /docs/ai-context/07_ACK_CONTRL_APERAK_UTILTS_ERR_RULES.md
- /docs/ai-context/08_APPROVED_TEST_FLOWS.md
- /docs/ai-context/13_OVERRIDE_PROTOCOL.md
- /docs/ai-context/14_VALIDATION_CHECKLIST.md
- /docs/ai-context/16_SECURITY_SECRETS_CERTIFICATES.md
- /docs/ai-context/17_MAILBOX_POLLING_AND_DEDUPE.md
- /docs/ai-context/18_SEND_READINESS_AND_ENVIRONMENTS.md

For UI tasks, also read:

- /docs/ai-context/09_UI_UX_RULES.md
- /docs/ai-context/21_UI_OPERATIONS_AND_BILLING_UNDERLAY.md

For import, billing, BRP/eSett or platform pricing tasks, also read:

- /docs/ai-context/21_UI_OPERATIONS_AND_BILLING_UNDERLAY.md
- /docs/ai-context/22_BRP_ESETT_FILE_IMPORTS.md
- /docs/ai-context/23_PLATFORM_BILLING_AND_USAGE_PRICING.md

Main rules:

- Do not mix end-customer billing underlay with platform billing against tenant companies.
- Do not bypass tenant guards.
- Do not bypass send readiness.
- Do not bypass encryption/decryption checks.
- Do not silently fallback to unsafe defaults.
- Do not create duplicate modules without first searching existing implementation.
- Use simple Swedish UI language for tenant users.
- Keep superadmin UI understandable, even when advanced diagnostics exist.
- If a file over 800 lines must be changed, consider splitting it carefully, but do not refactor just for cleanup unless the task requires it.
