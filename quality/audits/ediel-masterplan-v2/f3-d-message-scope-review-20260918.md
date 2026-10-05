# PR330: second-message scope review correction

Status: locally qualified; fresh published-head CI and substantive rereview still required.
Parent under review: `b3afa40a24713c726aa89ad9342cb577649aa15d`, tree `c832d360ea7bbb399cdbb00b5583b191d6c702ac`.
Independent static review: CodeRabbit issue comment **5731012182**. Previous wire/row and freeze corrections were confirmed, but a later PRODAT could remain outside the standalone rulebook send decision. The reviewer did not execute tests.

## Reproduced, not inferred

The unchanged b3afa standalone guard allowed both test and production rows for a synthetic two-message payload. The test transport also allowed it; production transport already blocked on other routing/profile errors, so no production-transport bypass is claimed. The refined28-case baseline had7pass/21fail. An earlier test-construction RegExp error is excluded from that baseline. The final fixture typing was made explicitly Partial without changing values or assertions; a failed test-TypeScript qualification is retained as failed, followed by a full final rerun.

## Bounded correction

A shared token-level outbound scope check counts real UNH headers and rejects more than one whenever any message is PRODAT, including PRODAT appearing after UTILTS/APERAK. It runs before sync/registry policy selection and before row preflight exemptions, producing protected `PRODAT_DEPENDENT_MESSAGE_SCOPE_UNDETERMINED`. Both standalone and transport paths therefore reject before intentional-invalid/system-test exceptions. The existing one-message outbound profile is enforced; this does not pretend to validate every message of a multi-message interchange or alter inbound/detached parsing.

28 new actual-path cases exercise test/production, three UNA alphabets, three first-message families, stale first-message parsed caches, both APIs, row/send/transport boundaries, overrides and the actual validation_report system-test marker. Single-message positive controls and escaped UNH-looking data remain accepted at the bounded D guard; two D-valid messages still require separate sends. Synthetic partial fixtures are not complete normative messages or live database evidence.

## Fresh local qualification

**2502/2502 application tests in237 files**, including all208 subtype cases (146 original +34 first review +28 new); **851/851 retained source cases**. All three TypeScript projects, lint, unchanged coverage thresholds, specification integrity, mechanical checks, quality tests, RBAC and existing source-size budgets pass. Lint retains100 warnings. Coverage lines35.56%, statements34.14%, branches27.07%, functions40.95%. Source map:3696 execution files, SHA256 `b846751d8ada16437259e406b0c9645a1220b271356e69f231d7f65272d3a9c2`, no before/after drift. Commands, outcomes and log/source hashes are in the adjacent JSON.

These local results are not the new commit's ordinary build/replay/CI or independent final rereview. Old b3afa ordinary OPS35352810422, Ediel35352810380, FullE2E35352810369 and Browser35352810361 all passed but do not qualify this correction.

## Boundaries and next action

Publish this exact source, run four ordinary PR workflows and substantive same-SHA rereview, handle any findings, freshly check base/head/reviews/checks, then expected-head merge. Only then continue the remaining D inventory. PR310 remains paused. The remaining104 numeric D cells,10parent groups, fullF3–F7/masterplan and live certification are not complete. Existing main full-release35334649693 failures remain separate; do not alter baseline checksums or claim PR smoke certifies full release. No DB/storage/market operation or explicit deployment is performed; existing Vercel Git integration can automatically deploy a user-authorized main merge.
