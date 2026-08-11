# Current state

Updated: 2026-08-11

## Source truth

- Repository: `heke99/gridex-ops-platform`.
- Default branch: `main` at `38d55dc73b3f6c3a8339d819b90cf96fa0b647e1` (`#108`
  remaining masterpoint convergence).
- Active residual branch: `cursor/codebase-health-and-stability-1848`.

## Post-#108 health status

- `#108` CI verify / clean-replay / quality gates passed before merge.
- Tip review found a CRITICAL grant regression on
  `canonical_run_architecture_reconciliation` (EXECUTE to `authenticated` on
  SECURITY DEFINER without tenant authz), missing success-path check-error
  clears, and the still-open O-008 PUBLIC privilege residual.
- Forward residual `20260811114500_post_108_health_security_residuals.sql`
  closes those items. C28 `recorded_by` assertion was already corrected on
  main by `#108`.
- Stale open PR `#106` (`20260810230000`) must be superseded by this tip
  residual.

## External configuration limits

- Connected Supabase account still exposes only `gridex-ops-dev` for live apply.
- Auth leaked-password protection and exact production SHA evidence remain
  external release gates.
