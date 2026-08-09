# Current task

Last updated: 2026-08-09T15:10:00Z
Branch: `cursor/codebase-health-and-stability-7f6c`
Trigger: main push `#99` (`2f02fb10`)

Status: `IMPLEMENTED_NOT_VERIFIED` — PR `#100` opened; local static/vitest PASS.

## Skill routing

- Activated: `using-superpowers`, `find-bugs`, `code-review`, `code-security`,
  `variant-analysis`, `supabase-postgres-best-practices`,
  `test-driven-development`, `verification-before-completion`
- Conditional later: `systematic-debugging` if verification fails;
  `finishing-a-development-branch` after PR open
- Skipped: full `quality-playbook` / threat-model (scoped residual remediation,
  not repository-wide audit); `brainstorming` (requirements already evidenced by
  #98/#99 and prior residual notes)

## Active work

Close confirmed residuals that `#99` did not land:

1. Same-class portal parse-outside-try variants on `/api/v1/customer/sync` and
   `/api/v1/customer/portal-bundle` POST.
2. O-008 PUBLIC privilege residual via forward migration
   `20260809151500_gridex_ops_o008_public_privilege_hardening.sql`
   (exact donor blob/checksum from unmerged `#98`).

## Already landed by #99 (do not reopen)

- Legacy `/api/v1/customer-portal/sync` controlled ApiInputError classifier
- Reserved `module` → `legalModule` renames
- Public-contract fixture updates

## Next action

Review/merge PR `#100`; apply `20260809151500` on the authorized ledger path;
supersede overlapping residual PRs `#96` / `#98` after merge.
