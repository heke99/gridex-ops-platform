# PR330 — second-message review correction

Status: IN_PROGRESS. Original candidate recovered and published as0a89e102. First
review correction is published asb3afa40a (treec832d360), with all four ordinary
CI workflows green. Independent rereview5731012182 confirmed the first fixes but
found the later-message standalone send boundary. It is locally repaired and
qualified; publication, fresh CI/build/replay and substantive rereview remain.

Branch: codex/ediel-v2-dependent-conditions-20260918. PR330. Main baseb916213e.
Read live GitHub state before continuing; this committed memory is a prepublication
snapshot. Do not reapply the original ZIP over newer reviewed changes. Once merged,
do not restart this unit: continue the remaining original D inventory.

Shared outbound token scope check rejects multiple UNH headers if any message
is PRODAT, before policy selection, row preflight and test-send exceptions. It
does not change inbound multi-message parsing.28 new actual-path cases reproduce
21 failures on unchanged b3afa (7positive/control cases pass). Final2502/2502
application tests in237files include208 subtype cases;851/851 retained source
cases pass. All3TS/lint/coverage/quality/RBAC/source budget gates pass. Historical
failed harness/type-check attempts are explicitly retained as failures. See
`quality/audits/ediel-masterplan-v2/f3-d-message-scope-review-20260918.md` and `.json` for exact checks and source hashes.

Required next: publish, run exact-head ordinary CI, obtain substantive independent
review, resolve findings, fresh head/base/readiness checks, expected-head merge.
PR310 stays paused/excluded. Scope only6numeric D cells; remaining104,10parent
conditions, fullmasterplan/livecert remain unverified. Existing main full-release
35334649693 failures stay open. Existing Vercel Git integration auto-deploys main;
no explicit deployment/settings change, DB mutation or market send performed here.
