# Current state

Updated: 2026-08-15

## Post-#149 health residuals

- Tip `c5a5501a` (#149) landed Ediel role identity, readiness, and service-role
  RPC restrictions.
- Open #148 residuals were not on tip; they are relanded on
  `cursor/codebase-health-and-stability-7053`.
- #149 multi-package AGT UTILTS left incomplete runtime identity and soft
  `setup_package` binding; both are closed with exact package resolution and a
  forward migration `20260815220000_ediel_test_run_setup_package_exact_bind.sql`.

## Verification

- Vitest residuals (145/147/149/ediel e2e): PASS
- Migration integrity: PASS (454 / 358)
- Types check: PASS (latest migration pointer updated; types hash unchanged)
- `tsc -p tsconfig.app.json`: PASS
- Production npm audit: 0 vulnerabilities
