# Handover

Updated: 2026-08-12

Branch `cursor/codebase-health-and-stability-5dfb` closes the post-#112 auth
flash/next-path residuals on the post-#114 tip and locks SVK
`failed_retryable` reconciliation retry ordering in the OPS health regression.

Do not merge open `#113` (`60b7`) as the vehicle once `5dfb` is reviewed;
`#113` predates `#114` and would need a rebase. Prefer merging `5dfb` then
closing `#113` as superseded.

ggshield was unavailable in this environment; rely on CI/host secret scanning
before production apply of any new migrations (none in this residual set).
