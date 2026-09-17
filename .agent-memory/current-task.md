# Current task

Updated: 2026-09-17. Status: IMPLEMENTED_NOT_VERIFIED; publication/full CI BLOCKED.
Active: F3-D source-exact PRODAT RFF reference projection and affected consumers.
Candidate branch (local only): `codex/ediel-v2-prodat-references-20260917`.
Base main: `5a741b2c6e108d2db08b24aab9c0e6c4b71b1862`.
Verified base tree: `4a2803344e5ba82db1091b5e6f4f2061bf330d7e`.
Audit: `quality/audits/ediel-masterplan-v2/f3-reference-fields.md`.

PR323 is MERGED; its F3-C characteristic task is not still awaiting CI. The live
GitHub main tree and downloaded qualified-source archive were compared exactly.
Current work fixes 11 RFF descriptors/1154 value extraction, new/old meters,
authorisation versus case/permission/object references, and affected readers.
105 distinct source cases: 23 passed/82 failed on the unchanged base; 105 pass
with the correction. All 334 retained source cases pass (439 total). Repeat the
105 cases under UTC, Europe/Stockholm and Pacific/Apia without counting them as
315 distinct cases. 21 full-dependency Vitest consumer tests are present but not
executed; application/script/test TypeScript, full tests/build and normal CI remain.

The current GitHub connector exposes read/search actions, not branch/file writes,
PR creation or merge. Plugin-directory inspection confirms GitHub is installed.
Do not claim a remote branch/PR, push or merge for this candidate. Local npm
installation is also unavailable (network/cache); the source harness is not full CI.
Do not advance to the next implementation task before this candidate is qualified.
No production database, storage, SMTP or deployment action has occurred.
PR310 stays PAUSED at e9611351 with recovery branch unchanged; no SQL/generated
types/schema snapshots/grants/replay inputs are imported.
