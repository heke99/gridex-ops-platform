# Open blockers

Updated: 2026-08-11

1. Hosted staging/production SQL application of
   `20260811114500_post_108_health_security_residuals.sql` is not executed from
   this agent environment.
2. Supabase Auth leaked-password protection remains an external dashboard
   action.
3. Exact production Git/CI/Vercel SHA evidence remains an external release gate.
4. `ggshield` CLI is not installed in this environment (secret scan blocked).
5. Overlapping open PR `#106` (`20260810230000`) is stale after `#108` and
   should be superseded by the tip residual once reviewed.

None of these block landing the static residual fix on a tip-based branch.
