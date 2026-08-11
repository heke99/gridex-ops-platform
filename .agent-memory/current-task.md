# Current task

Updated: 2026-08-11

Status: `IN_PROGRESS`

Active work item: post-`#108` codebase health residuals on
`cursor/codebase-health-and-stability-1848`.

## Active subtask

Land and verify the tip-based forward residual migration
`20260811114500_post_108_health_security_residuals.sql`, then open the PR.

## Confirmed residuals addressed in this tip branch

1. **CRITICAL** — `#108` widened `canonical_run_architecture_reconciliation`
   EXECUTE to `authenticated` on a SECURITY DEFINER function with no tenant
   authz gate. Restored service-role-only EXECUTE.
2. **MEDIUM** — success-path `check-error:*` clears removed by `#108`. Restored
   for every current check key and drain legacy
   `due-stranded-canonical-outbox`.
3. **HIGH** — O-008 PUBLIC privilege residual still open after `#105`/`#108`.
   Re-landed after tip `20260811080000` (do not reuse stale `#106`
   `20260810230000`).

## Exact next action

Wait for PR `#109` CI; after merge, close/supersede stale `#106` and apply
`20260811114500` on connected environments.
