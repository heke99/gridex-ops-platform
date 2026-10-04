# S2 company/client lock order repair — 2026-10-04

The staff account wrappers held the company row FOR UPDATE before waiting for the actor and API client. Existing client status/scope UPDATE acquires the client first and fires the actual catalog-revision trigger. That trigger inserts publication domain events with a company foreign key, requiring KEY SHARE. The opposing company/client locks can form a cycle.

CLI-created forward migration `20261004100918_staff_user_lock_order.sql` changes only the first company locks in the two staff canonical wrappers and the private staff guard to FOR NO KEY UPDATE. This still serializes staff administration and excludes lifecycle updates, while allowing unrelated company foreign-key KEY SHARE. The exact three pre-patch `pg_proc.prosrc` hashes and exactly one matching statement per function are required; unexpected drift aborts the migration transaction. Existing ACLs/search paths and all role profiles remain unchanged.

The historical unchecked access command takes its stronger company FOR UPDATE only after the outer guard has acquired/rechecked actor and client eligibility. Pending client revocation can therefore finish its FK/catalog writes before the guard reads the revoked client and denies the request. The functioning-administrator constraint trigger only counts memberships/Auth/profiles and introduces no earlier company/client lock. Successful access/invitation/replay behavior remains unchanged.

Executed verification:

- Five actual canonical-chain tests PASS: valid access/invitation/exact replay, revoked replay denial, three independent source-drift rejection/atomic rollback cases, service-only/private ACL and fixed search paths.
- Together with actor/client/native-policy files: 43 tests PASS.
- Scoped ESLint, scoped native-driver TypeScript compilation and `git diff --check` PASS.

A genuine two-session native regression is added at `scripts/staff-user-client-concurrency-native.test.ts`. It schedules the actual staff command after its company lock using an unmodified actor-profile row lock barrier. The real client status UPDATE then executes the existing catalog-revision/company-FK chain while the company lock is held. Both first writes and cached replays must reject the newly revoked client without deadlock/timeout, preserve expected cache/audit/role counts, and produce the two publication events proving the real catalog trigger ran. Fixtures are synthetic and remain only in the owned disposable clean replay stack; no audit records are deleted.

Native execution is mandatory parent-owned CI work. This execution environment has no local Postgres server or psql binary, so the two independent sessions were not run locally. The embedded tests validate the authentic function/hash chain but cannot replace native concurrency verification.
