# S2: genuine two-session last-administrator regression

Scope: `scripts/staff-user-concurrency-native.test.ts`, added independently in the S3 worktree for the S2 package. Relevant workflows: repository security review, native SQL regression and verification before completion. Application, schema, OpenAPI, deployment and existing Ediel memory are unchanged by this package.

The mandatory native test has two cases: simultaneous administrator disable, and simultaneous administrator demotion to customer service. Each creates one random synthetic company with exactly two active accepted administrators and a separate active customer-service actor. That actor receives only its own company's `users.write` override. The synthetic unused API client has `staff_users.write`; no API secret is used.

Two separate `psql` processes invoke the installed `canonical_change_tenant_user_access` command with the verified staff marker. The first transaction performs its mutation and keeps the lock before committing. An observer checks `pg_stat_activity` and `pg_blocking_pids`: the second backend must actually be blocked by the first backend before the test releases the first commit. The second command must then reject with `staff_last_admin_required`.

Both cases verify one remaining active administrator, unchanged remaining target, exactly one successful durable audit with the expected actor/client/channel/target, no failed-target audit or command cache, and an exact successful replay without an additional audit.

All connections use the fixed disposable `127.0.0.1:54322` database, and execution requires the owned local API URL `http://127.0.0.1:54321`. Rows commit so both connections can observe the same cohort. The client's exact random ID is revoked in `finally`. The cohort remains until the owning replay harness destroys its stack; the test does not disable triggers, mutate schema or delete audit rows.

Verification on 2026-10-04:

- Scoped TypeScript compile: PASS.
- Scoped ESLint: PASS.
- Diff whitespace check: PASS.
- Independent review caught the globally unique client prefix constraint. Every cohort now uses its own random client ID as the prefix, so both cases and reruns can seed independently while retaining revoked clients.
- The held psql input explicitly ends with a newline while stdin stays open, so psql can execute its command/marker line before the subsequent commit is sent.
- Genuine local native execution: NOT RUN. A local `psql` binary was located, but the owned `127.0.0.1:54322` endpoint refused the connection. No fallback database or hosted endpoint was used.
- Native CI execution and actual schema/RLS/grant qualification remain root-owned.

Integration: add `scripts/staff-user-concurrency-native.test.ts` to the mandatory staff native Vitest configuration's include list. Run it after the S2 migration and its role definitions are present, using the existing local stack environment; it contains no skip condition. Keep replay stack teardown active even when the regression fails.
