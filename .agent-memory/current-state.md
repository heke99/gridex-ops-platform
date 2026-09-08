# Current state

Updated: 2026-09-07
Status: IN_PROGRESS

The active branch is `codex/gridex-parity-remediation-20260905`; draft PR #310
and its current checks show the live publication state. This tooling batch's
published baseline is `2ed764295fe1cf94bb64c5ce730e11714d97fdf0`. The active
review group is `auth_membership_tenant`. The latest verified implementation
head is `6d9e579c8af1c7f4509cb7bbb13750711e3be4fc`: isolated PostgreSQL 17 auth
job `101740868281` (OPS run `34121661358`), Ediel, and
`quality-release-gates` passed. `verify` failed at generated-types tail
`20260907121951`; clean replay failed because unresolved accounting remains.

Current accounting is 588 inputs: 507 `FULL_FILE_SELECTED`, 28 `SUBSTITUTED`,
49 `UNCLASSIFIED`, and 4 `EXPLICITLY_EXCLUDED`. The focused group contains 334
inputs: 265 selected, 25 substituted, 40 unclassified, and 4 excluded. These
counts come directly from the accounting and group mapper; selection and lexical
review hints do not prove successful execution or surviving effects.

Verification boundaries:

- Implementation: the fixed group runner, status consolidation, archive checks,
  15 mapper tests, 29 accounting tests, migration integrity, static provenance,
  and production readiness pass locally. Integrity covers 588 files and 492
  version groups; readiness reports 495 ledger-eligible versions.
- Isolated: the six auth/POA/invitation/actor-FK commands have prior PG17 evidence
  at the verified head above. The combined runner requires hosted PG17 execution
  after the single combined publication; no local PG17 service is available.
- Canonical: generated types fail at the stated migration tail and clean replay
  remains incomplete. Canonical schema, effects, and ledger parity are unproved.
- Production: For this workflow-tooling batch, no production mutation is
  authorized or performed. A read-only snapshot reports ledger count 279 and
  latest version `20260904222450`.
  Vercel production deployment `dpl_6qevcw57wT7X2p5yd5rQA7hzRq8c` is READY at
  `app.gridex.se`, main commit `eb9a25bc989c6de808903f41c2314d5465e9c07b`;
  its runtime database binding is not proven, so this is not parity evidence.

Open internal work is the 25 substituted and 40 unclassified inputs in the active
group, followed by authoritative replay, generated types/schema, ledger comparison,
and bidirectional production parity. No external blocker has been established.
Next: finish the reviewed tooling/map batch, publish it once, and inspect the
hosted group runner and required gates. Then expand the RBAC predecessor/fix/
hard-platform-role fixture recorded by the group map. Do not publish per file or
subtask, infer replay approval from mapper hints, close a
phase from isolated tests, or edit migrations/selection/generated types in this
tooling task. Existing Ediel and global gates remain mandatory.

Historical status is archived at `archive/pre-batch-20260907/` and is not active
evidence.

The reviewed next work boundary and fixture omissions are recorded in
[the auth group map](../quality/audits/AUTH_GROUP_REVIEW_MAP_2026-09-07.md).
[Its complete candidate inventory](../quality/audits/AUTH_GROUP_INPUT_INVENTORY_2026-09-07.json)
matches the current mapper hash, all 334 candidates and global accounting. This
is review evidence; it does not classify the 65 unresolved group candidates as
complete or prove their SQL effects.
