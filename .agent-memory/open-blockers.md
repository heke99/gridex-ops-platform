# Open blockers

Last updated: 2026-08-09T09:21:00Z

## Release handling

The repository owner explicitly instructed the campaign to proceed **without GitHub Actions** because hosted jobs are blocked before step 1 by account billing/spending-limit state. Actions is therefore not a merge gate for this release.

The remaining items below are recorded evidence/configuration gaps, not unresolved code defects in PR #90.

## 1. Final destructive empty-database replay unavailable

The last real clean replay reached `20260728170000_live_schema_code_canonical_sync.sql` and failed first on missing `customer_invoice_lines.vat_rate`. The complete source-defined invoice-line family (`line_type`, `unit`, `vat_rate`, `sort_order`) is now restored and checksum/provenance registered. No isolated PostgreSQL/Supabase preview runner exists to rerun the full empty-database replay after that fix, and production/default Supabase is intentionally not used destructively.

This replay gap is explicitly accepted for the no-Actions merge and must not be described as a PASS.

## 2. Repository protection

GitHub reports `main` unprotected. The installed connector exposes no branch-protection/ruleset write action.

## 3. Supabase hosted Auth setting

Supabase Security Advisor reports Leaked Password Protection disabled. The installed connector exposes no hosted Auth/Management configuration write action.

## Alternative validation completed

- no historical timestamp migration edited in the PR diff;
- migration/checksum lineage registered for new forward migrations;
- fresh read-only Supabase validation: Grid Owner performance patch has exactly one expected canonical target and produces the direct-first guard;
- fresh read-only Supabase validation: OPS health patch has exactly five expected ambiguous status signatures;
- storage isolation/RBAC source reviewed fail-closed;
- `nanoid` upgraded to 3.3.17 in lockfile;
- centralized PII/credential redaction hardened for snake_case, camelCase and separator-style metadata keys;
- latest known production runtime 42702 root cause reproduced and remediated by forward migration;
- branch was ahead of `main` and not behind before final release-status commits.

Next action: mark PR #90 ready, merge it, verify `main` contains the remediation tree, and inspect the resulting production deployment/runtime state.
