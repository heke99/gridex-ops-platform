# PR310: bind the removed-policy witness to the already-qualified forward RPC

Date: 2026-09-16. Base: `4c7b3a1a5be0d5c9bb499876c0f573411ec17f76`.
Scope: targeted blocker repair, not a new whole-repository audit or release approval.

## Skill routing

Activated systematic-debugging, test-driven-development, differential-review,
Supabase, verification-before-completion and existing quality/release gates.
Read AGENTS.md, active memory/checkpoint, migration/auth domain notes and decisions.
UI, advertising, performance optimization and new-product design are not involved.
No parallel-agent claim; current environment has no such agent tool.

## Confirmed blockers

GitHub OPS run 35086800997, verify job 104763509260 passes migration integrity
(613 files), public-contract legal migration and database contract hardening.
`db:types:check` then rejects the changed migration tail. Types must be genuinely
regenerated after a complete owned replay; the manifest is NOT altered here.

The ordinary owned run 35086800978, job 104763418382 executes 144 foundation,
514 historical timestamp inputs and twelve registered forwards, then rejects
`REMOVED_POLICY_RETAINED_HELPER_BODY_REQUIRED`. Source inspection and an isolated
regression reproduce the exact error. `expected_routines` compares all twelve
routines to the independent pre-forward schema, even though the twelfth forward
already deliberately replaced `canonical_manage_platform_user_access(jsonb)`.
The exact source intersection is this one routine; only its prosrc changed.

## Correction and retained boundaries

Retain the registered migration's exact SHA-256 bytes alongside the immutable
reference before originals are staged away. Derive the new body from the existing
checksum-bound eight-function parser. Require the known old body, new body,
signature, result, owner, language, volatility and search_path. Replace only this
one expected prosrc. Keep its service-only ACL and all other eleven routine
expectations unchanged. The old body is no longer a second acceptable baseline.
Bind both the promoted source and body hash into the execution receipt.

No SQL migration, grant, RLS predicate, table, reference dump, generated type file
or type manifest is changed. No blanket exception or baseline refresh is added.
The 267-policy guard, actual actor tests, state-preservation checks, native ledger,
schema decisions and complete CI remain mandatory. Unit tests isolate policy
hash checking using the existing synthetic metadata fixture; actual SQL CI does
not mock it. No business-DML coverage is inferred from metadata unit tests.

## Verification

Three independent new core regressions reproduced: new body rejected, stale body
accepted, and promoted source not retained. After the fix, all three pass.
Additional metadata/body/ACL mutation, eleven-routine preservation and source
staging tests are committed and wired into ordinary OPS and schema-reference CI.
Complete test and SQL qualification results are to be read from the current run,
not inferred from this source note. Native replay and typegen remain unaccepted.
