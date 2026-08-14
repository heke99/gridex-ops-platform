# Next actions

Updated: 2026-08-14

1. Open/merge `cursor/codebase-health-and-stability-d15d` after hosted CI and
   clean-migration-replay are green (squash only).
2. Close superseded conflicting PR `#140`/`ea1a` after `d15d` merges.
3. Apply forward migration `20260814190000` on staging/production only after
   Git/CI parity evidence for the merged SHA.
4. Run ggshield / secret scan in CI/host (CLI unavailable in this environment).
5. Restore exact official UTILTS operation/request matrices and TGT/AGT evidence
   when external sources become available.
6. Change Vercel project runtime from Node 24.x to Node 22 when operators can.
