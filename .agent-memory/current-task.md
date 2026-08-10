# Current task

Updated: 2026-08-10

Status: `IN_PROGRESS`

Active work item: post-#104 codebase health residual remediation on
`cursor/codebase-health-and-stability-94a3`.

## Skill routing

- Activated: using-superpowers, find-bugs, code-review, code-security,
  variant-analysis, supabase-postgres-best-practices, test-driven-development,
  scan-secrets (attempt), verification-before-completion
- Conditional later: requesting-code-review / finishing-a-development-branch
  after PR opens
- Skipped: full quality-playbook / threat-model (scoped residual remediation);
  brainstorming (requirements evidenced by open draft #102 + #104 hygiene gap);
  acquire-codebase-knowledge (not a full onboarding request)

## Subtask

Land confirmed PUBLIC privilege residuals left after `#104` merged the 75-point
remediation while draft `#102` remained unmerged:

1. O-008 readiness views still revoke only anon/authenticated, leaving PUBLIC
   grants able to re-expose SELECT.
2. `#104` hygiene migration revoked `platform_schema_state` from anon/auth only
   (same PUBLIC inheritance pattern).

Exact next action after verification commit: push branch, open PR, update
handover with PR link, note draft `#102` superseded by newer forward timestamp.
