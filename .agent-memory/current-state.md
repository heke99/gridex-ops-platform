# Current state

Updated: 2026-08-10

## Source truth

- Repository: `heke99/gridex-ops-platform`.
- Default branch: `main` at `09edc18f` after merge of PR `#105`
  (canonical 57-point architecture remediation).
- Active health branch: `cursor/codebase-health-and-stability-ee51`.

## Post-#105 health status

- `#105` migrations and review remediations are on main through
  `20260810224500_canonical_review_remediation_v1.sql`.
- Hosted Actions run `31437733202` passed verify / clean replay / quality gates
  on the PR head, but the 57-control Node script was not part of OPS hardening
  CI and locally failed C28 on the merged tip until corrected.
- Tip residual work on `ee51` adds `20260810230000` O-008 PUBLIC privilege
  hardening and wires both the 57-control and O-008 PUBLIC regressions into CI.

## Still external / blocked

- Staging/production apply of the new grant migration.
- Supabase Auth leaked-password protection dashboard change.
- Exact Git/CI/Vercel production SHA receipt after the next release.
- Open residual PR `#102` is stale (pre-#105 timestamp) and should be superseded
  by the `ee51` PR.
