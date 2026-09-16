# Database-first selected-chain frontier — 2026-09-12

Status: BLOCKED at historical live-schema sync. This report does not accept a complete replay, generated types or release.

## Request and preservation

Follow database/types -> two confirmed runtime faults -> full RLS/permissions -> billing transactions -> jobs and point86 -> paused API remainder -> review/merge/deploy. Completed API work must not be redone.

Starting head: d94e1f0b7aa2b6d98d133a039261ec0d2e2aeae1. Published implementation commits: 1ba0f7b1c4fe41da7ab379a7ac2244def49dd3da and eacc6d404f229f91b13e9eb60c301f0b4ac148ef. Both were built against the actual GitHub parent, verified by complete local/GitHub tree equality and pushed without force to PR310. The two commits change only six database diagnostic/executor/test/workflow paths. Application/API sources, the paused partner-price patch, historical migrations, manifests, generated types and main are unchanged.

## Implemented and verified

The diagnostic now executes the original source-pinned timestamp selector after the118 foundation inputs. It retains all508 timestamp/interleaved inputs, five prerequisite boundaries, source order/checksums, whole-file transaction behavior, stop-on-first-error behavior and the existing AcceptedInputs private-result protection. It does not write a ledger, schema baseline or generated types and never sets completeReplayVerified to true.

The first native run,34714610111/job103609490437 on1ba0f7b, passed118 foundation +44 timestamp inputs. At timestamp45, 20260611100000_energy_resolver_grid_area_operations.sql failed0A000 because the plain postgres:17 target lacks the PostGIS extension required by its first executable statement.

An explicit PostGIS profile was added to the same owned-target class. The default remains postgres:17; the spatial profile accepts no arbitrary image/URL. Both retain network=none, tmpfs, private logging, read-only private input mount and exact owner cleanup. The diagnostic reads back the actual image ID, owner, network and PG17/PostGIS availability before source SQL. The runtime tag is mutable and its observed image ID is evidence, not a claim that the input was digest-pinned.

On eacc6d4, native run34715245340/job103611207798 passed all21 constructor/selection/privacy tests and the formerly failing PostGIS migration. It executed all118 foundation +228 timestamp inputs, then failed at timestamp229 with42601. Cleanup passed. Actual runtime: PG170005/PostGIS3.5.2; image ID is in the companion JSON receipt. This is a native PostgreSQL diagnostic, not exact managed Supabase parity.

## Current blocker and exact next action

The failing file is migrations/20260728170000_live_schema_code_canonical_sync.sql, SHA2564b1af824f75423faa393d60b845d3b39a3998bcfc7d7ea1cec2a54aa8d3bd400. Its session-guard repair block at lines789–821 removes v_disabled_at and immediately recompiles the function before subsequent calls remove that variable's SELECT INTO target and other references. The original guard is defined in 20260519_batch_6d2_runtime_governance_completion.sql. The later 20260730130000_historical_sync_forward_repair.sql explicitly documents this invalid intermediate definition and installs a complete guard atomically, but the failing earlier migration prevents reaching it in the current reconstruction.

The native42601 is observed; the specific intermediate-definition mechanism is supported by those source definitions and the existing forward-repair comment. A new isolated reproduction/repair/final-state proof for this boundary has not been implemented. The next task must preserve immutable history, verify the intended final function/ACL/behavior and prove continuation/rollback. Do not skip the file, waive source effects, fabricate types or suppress validation merely to turn the job green.

## Other gates and limitations

Accounting is exactly unchanged:600 inputs,558 FULL_FILE_SELECTED,23 SUBSTITUTED,14 UNCLASSIFIED and5 EXPLICITLY_EXCLUDED. --require-full-effects still exits1 with37 unresolved global dispositions and no input-contract errors. Selection is not complete source-effect acceptance.

On eacc6d4, OPS34715245359 quality-release-gates103611207992 passed lint, script/test types, mechanical checks, application/quality tests, API docs/compatibility/release checks, RBAC, budgets and build. The same run's verify103611207917 failed at db:migrations:check; clean-migration-replay103611208029 failed at clean replay/generated types. Full E2E, full RLS, native billing transactions, job recovery/fairness, point86 and independent review remain open.

The broader local accounting/group selftest attempts exceeded the execution-tool timeout and are not asserted as local passes. The21 targeted local tests completed successfully; hosted21 passed on the exact PostGIS commit. No managed database SQL, historical rewrite, schema/type artifact publication, merge to main or Vercel deployment occurred.

## Routing and continuity

Used the existing execution plan, source-first debugging, targeted red/green tests, code/differential self-review and verification-before-completion. Supabase source/replay guidance informed the boundary. API, frontend/browser, billing/job implementation and deployment skills are deferred because their steps have not been reached. No separate agent/reviewer result is claimed.

Current state and checkpoint now point to database reconstruction, not API work. Prior large completed-work/verification/session logs are preserved byte-for-byte under .agent-memory/archive/pre-db-frontier-20260912/ and linked from the current logs; their SHA256 digests are in DB_SELECTED_CHAIN_RECEIPT_2026-09-12.json. No historical evidence was discarded.
