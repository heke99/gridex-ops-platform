# Open blockers

Last updated: 2026-08-08T16:15:00Z

1. `GRIDEX-REM-002` clean replay/fingerprint remains open until exact-HEAD CI passes end-to-end. Current implementation restores the two company contact columns required by the first failing tenant-mail readiness view.

2. Large-file implementation must still be confirmed by ordinary OPS-hardening CI on the same descendant HEAD, although the dedicated split workflow already passed full repository typecheck and the <=2500 line gate.

PR #90 remains unmerged until same-HEAD release verification is green.
