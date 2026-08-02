# Canonical hardening baseline

Date: 2026-08-02
Release decision: **NO-GO**

## Source integrity

- Uploaded archive SHA-256: `e623976d333a3d4686e01ddd3ead83e599c21284a983347efaf7939dbaefd0d3`
- `package-lock.json` SHA-256 before changes: `3e5c2cba116d338c48c8acc0a889e41b0ed720436ec4d6c6dc860f2748f842c0`
- Original archive contained no Git metadata; branch and commit are **NOT VERIFIED**.
- Migration aggregate after the prepared emergency migration: `127e738a3e2f24368b8fd8758745fd93f886c2db788efb8ae2767fafb71fa16c`.

## Verified baseline

| Gate | Result |
|---|---|
| Node | PASS — 22.22.0 |
| Next.js | PASS — 16.2.12 build |
| TypeScript | PASS |
| Tests | PASS — 62 files, 417 tests |
| Migration integrity | PASS — 339 files / 243 version groups after the prepared emergency migration |
| Production hardening static regression | PASS |
| Dependency production audit | PASS — 0 vulnerabilities |

## Connected Supabase project

- Name: `gridex-ops-dev`
- Project ref: `piidsfebjqjmnepdpnas`
- PostgreSQL: 17.6
- Health observed: `ACTIVE_HEALTHY`
- Remote writes performed in this work: none

The remote ledger now contains all canonical versions through
`20260802180000`. The prepared `20260802190000` emergency migration is **not
applied**. External REST/JWT RLS, concurrency and transport verification remain
**NOT VERIFIED**.
