# Cursor workflow

Read [AGENTS.md](../../AGENTS.md) and its required memory first. For Ediel, use
[current start](../../.agent-memory/masterplan-current-start.md), actual main/ledger
and latest #766. The same ownership and delivery contract applies to Cursor.

[ADR-001](../../.agent-memory/decisions.md#adr-001--one-progress-system) places active
progress in `.agent-memory`. [11_CURRENT_TASK.md](11_CURRENT_TASK.md) is superseded;
[10_CHANGELOG.md](10_CHANGELOG.md) is history. Read them when relevant, without
maintaining a second active checkpoint. Follow AGENTS for own checkpoints/board
receipts and role-memory plus exact file custody before shared-memory writes.

## Scoped work

1. Read the domain context below and identify relevant implementation files.
2. Inspect those files first. Do not scan or rewrite the full repository by
   default. If more files are needed, explain which, why, affected risk and any
   behavior change before expanding the scope.
3. Reuse existing implementation before creating modules: parser, ACK builder,
   route resolver, send-readiness checker, event log, tenant guard, server action,
   UI component, import/upload, billing/export and audit helpers.
4. Make the smallest production-safe correction, across modules when necessary.
   Do not rewrite unrelated files, remove functionality or make unjustified refactors.
5. Validate; record changed files, reason, exact results, risks and next action
   under AGENTS. Update domain docs when rules, architecture or approved flows change.

If a file over 800 lines needs changes, consider a safe split; size alone does
not justify a refactor. Preserve behavior, exports/imports and route/action
compatibility, run build/typecheck for a split, and document the new structure.
Return only changed/added files or patches unless the full repository is requested.

## Domain reading

Read the [project snapshot](00_PROJECT_SNAPSHOT.md) and relevant domain set:

- Ediel: [core](04_EDIEL_CORE_RULES.md), [PRODAT](05_PRODAT_RULES.md),
  [UTILTS](06_UTILTS_RULES.md), [ACK/CONTRL/APERAK/ERR](07_ACK_CONTRL_APERAK_UTILTS_ERR_RULES.md),
  [approved test flows](08_APPROVED_TEST_FLOWS.md),
  [override](13_OVERRIDE_PROTOCOL.md), [validation](14_VALIDATION_CHECKLIST.md),
  [secrets/certificates](16_SECURITY_SECRETS_CERTIFICATES.md),
  [mail polling/dedupe](17_MAILBOX_POLLING_AND_DEDUPE.md),
  [send readiness/environments](18_SEND_READINESS_AND_ENVIRONMENTS.md).
- UI: [UI/UX](09_UI_UX_RULES.md) and
  [operations/billing underlay](21_UI_OPERATIONS_AND_BILLING_UNDERLAY.md).
- Import, billing, BRP/eSett or platform pricing: [operations/billing underlay](21_UI_OPERATIONS_AND_BILLING_UNDERLAY.md),
  [BRP/eSett imports](22_BRP_ESETT_FILE_IMPORTS.md) and
  [platform billing/pricing](23_PLATFORM_BILLING_AND_USAGE_PRICING.md).

## Production safeguards

- Preserve approved flows. Do not bypass tenant guards, RLS, send readiness or
  encryption/decryption checks. Never trust client-submitted `company_id` as
  tenant authority or silently change business rules.
- Keep customer billing underlay separate from platform billing against tenants.
  Search before introducing billing/export/import systems or other duplicate logic.
- Never hardcode test IDs, inbound IDs, metering-point IDs, one-off references
  or other one-off test values. Document database migration intent.
- Production runs on Vercel. Do not add production-critical dependencies on local
  binaries or self-hosted services.
- Use simple Swedish for tenant UI and understandable superadmin UI, including
  advanced diagnostics.
- Missing required data blocks with a clear configuration error. Do not send
  without a required subaddress/certificate, choose the first route, attribute an
  unknown tenant to the current user's company, mark a failed parse successful,
  turn an unknown ACK into positive APERAK, export a row without its price model,
  or match an imported row to a customer by name alone.

## Rule override

Follow [Override Protocol](13_OVERRIDE_PROTOCOL.md) before changing a wrong,
incomplete, unsafe or blocking rule or approved assumption. Preserve its evidence,
minimal-change and regression requirements; record current task/results through
AGENTS rather than the historical task/changelog destinations named there.
Document the changed rule, why, affected files, validation and remaining risks.
Do not create parallel logic unless the old implementation is demonstrably wrong
and the override is documented.

Original entrypoint and workflow remain in the immutable
[968fd58f snapshot](https://github.com/heke99/gridex-ops-platform/tree/968fd58f2c2e064a1d8b09f3ff9374af4e9ea31d)
as dated history.
