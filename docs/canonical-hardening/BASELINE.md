# Canonical hardening baseline

Date: 2026-08-02
Release decision: **NO-GO**

## Source integrity

- Uploaded archive SHA-256: `e81980ee20c0b0ce5eb8d1eff6ca2e8bdc1a2971226a08821d90122dbbc32891`
- `package-lock.json` SHA-256 before changes: `3e5c2cba116d338c48c8acc0a889e41b0ed720436ec4d6c6dc860f2748f842c0`
- Original archive contained no Git metadata. Local comparison baseline: `14a476339c89ad6c40e16c721f434d6119239d2a`.
- Baseline migration aggregate SHA-256: `375341af13b0231870b2119f6bf6b7d1d9772cc8d19c767244cd04cd8ff2f2a6`.

## Verified baseline

| Gate | Result |
|---|---|
| Node | PASS — 22.22.0 |
| Next.js | PASS — 16.2.12 build |
| TypeScript | PASS |
| Tests | PASS — 62 files, 417 tests |
| Migration integrity | PASS — 336 files before this change |
| Production hardening static regression | PASS |
| Dependency production audit | PASS — 0 vulnerabilities |

## Connected Supabase project

- Name: `gridex-ops-dev`
- Project ref: `piidsfebjqjmnepdpnas`
- PostgreSQL: 17.6
- Health observed: `ACTIVE_HEALTHY`
- Remote writes performed in this work: none

External staging, JWT/RLS, concurrency and transport verification remain **NOT VERIFIED**.
