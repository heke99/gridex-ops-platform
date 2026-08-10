# Current task

Updated: 2026-08-10

Status: `CODE_AND_CONNECTED_DEV_COMPLETE_RELEASE_BLOCKED`.

The 75-point remediation has been implemented and locally verified against the supplied source archive. The connected `gridex-ops-dev` database is migrated and schema/code expectations were checked. This archive contains no `.git`, so its claimed `main@78013b71a1f7fccd166b38f0712e20d1df198e11` provenance cannot be independently verified.

Remaining release work requires external evidence, not invented local state:

- run the clean empty-database replay in the configured CI job;
- run mandatory GitHub checks on the real repository;
- compare staging and production Supabase with the verified dev/repo contract;
- enable Supabase Auth leaked-password protection when password login is used;
- prove merged Git SHA = CI SHA = Vercel production SHA;
- capture production p50/p95/p99 after deployment.

Do not mark the campaign `COMPLETE` until those gates pass. See `docs/remediation/GRIDEX_75_POINT_EXECUTION_REPORT_2026-08-10.md`.
