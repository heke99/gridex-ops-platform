# Post-#149 Ediel runtime identity residuals (2026-08-15)

Main tip reviewed: `c5a5501a` (#149).
Branch: `cursor/codebase-health-and-stability-7053`.

## Residuals closed

1. HIGH — Reland open #148 Processa om terminal sync + actionable reasons
2. HIGH — Reland open #148 production command request_hash + primary website client
3. HIGH — Incomplete AGT/TGT runtime identity at start/import/autopilot call sites
4. HIGH — Soft `setup_package = test_suite` bind made multi UTILTS packages ambiguous

## Fix summary

- `resolveEdielSystemTestPackageForCase` maps suite/role/family/message code to package
- `createEdielTestRun` no longer invents `setup_package` from the message-family token
- Bind trigger requires exact package id for evidence/running runs
- Autopilot threads `setup_package` from the bound test run
