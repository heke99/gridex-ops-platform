# Current state

Last updated: 2026-08-09T09:21:00Z

- Branch: `remediation/gridex-ops-full-integrity-performance`
- PR: `#90`
- Release path: `NO_ACTIONS_RELEASE_VALIDATION`
- Owner instruction: proceed without GitHub Actions because hosted jobs are account/billing blocked before step 1.

## Remediation state

The campaign has implemented the audit/runtime fixes on the branch without editing historical migration sources or applying destructive writes to the connected default Supabase project.

The last real clean replay before the runner outage reached `20260728170000_live_schema_code_canonical_sync.sql` and failed first on missing `customer_invoice_lines.vat_rate`. The complete source-defined invoice-line runtime family (`line_type`, `unit`, `vat_rate`, `sort_order`) is now restored through checksum-pinned `bootstrap/20260525_customer_invoice_lines_runtime_foundation.sql`, registered in provenance metadata and deterministic foundation order.

Fresh no-Actions release validation on 2026-08-09 confirmed:

- branch was ahead of main with no behind commits before the final status commits;
- PR diff edits no historical timestamp migration; database changes are new forward migrations plus derived bootstrap/replay artifacts;
- Grid Owner performance migration matches exactly one current canonical join and materializes the direct-first guard; prior read-only benchmark was ~1.09 s / 186 rows versus ~26 ms / 183 rows;
- OPS health migration matches exactly five current ambiguous `status` signatures and fails closed on shape drift;
- storage isolation validates company/customer/site ownership and RBAC and moves its SECURITY DEFINER helper out of the PostgREST-exposed public schema;
- `nanoid` lockfile resolution is upgraded from 3.3.16 to 3.3.17;
- central log redaction now normalizes sensitive metadata keys across snake_case, camelCase and separator variants;
- customer application orchestration remains split from ~9,808 lines into <=2500-line production modules.

GitHub Actions is not used as the release gate for this merge by explicit owner instruction. The final empty-database replay after the invoice-line prerequisite remains unavailable and must not be represented as passed.

## External configuration gaps

- `main` is reported unprotected; connector has no branch-protection/ruleset write operation.
- Supabase Leaked Password Protection is disabled; connector has no hosted Auth/Management configuration write operation.
- No isolated Supabase preview database exists for a destructive final replay.

Proceed with PR #90 ready/merge using the documented no-Actions validation path, then verify the resulting `main` SHA and production deployment state.
