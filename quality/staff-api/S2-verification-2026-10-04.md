# S2 shared staff commands and adapters

Implemented in isolated `feat/staff-api-s2-20261004`, based on main fa4147b.

Skill routing: using-superpowers / using-git-worktrees for isolation, test-driven-development for behavioral regression, code-security for user input and transactional authorization, Supabase for migration CLI and function privileges, verification-before-completion for evidence. The scoped staff governance implementation does not run the full repository audit/quality playbook or Ediel campaign; root owns final integration/replay qualification.

Commands in `lib/tenant/staffCommands.ts` require explicit company and actor identity, role-profile permission ceilings and users.read/write. API adapters require isolated staff scopes and idempotency; actor identity joins the outer idempotency payload and canonical durable key namespace. OPS company actions and the alternate responsible-user settings action call the same commands. Settings validate the same ceiling before account lookups and commit the atomic role command before privileged Auth/profile updates; native authorization failure leaves those side effects untouched. Staff invite results never return the invitation token or acceptance URL. A disable preserves historic membership with status disabled; enable restores its existing canonical role.

Migration `20261004083640_staff_user_commands.sql` was created by Supabase CLI 2.119.0. Guards re-resolve the profile plus same-company allow/deny overrides after company-row locking. No global/platform role confers staff API authority. Active accepted membership, active profile and a nondeleted/nonbanned Auth user are required. Native last-admin and self-disable rules remain in the same locked transaction as canonical membership/role changes. Lifecycle is rechecked under the lock. Audit rows carry actor_user_id and metadata.api_client_id/channel atomically.

Narrow existing transaction repairs: operations/support role mappings accepted; role_key persisted by canonical access producer; request_payload and request_hash moved together. The legacy null-key backfill only uses exactly one active mapped same-company user_role and leaves ambiguity/explicit roles untouched. Historical migrations and generated artifacts remain unchanged.

Executed with Node 22.23.3:

- Five focused Vitest files: 36 tests passed. Includes domain rejection cases, typed OPS preflight error mapping, actor-bound handler idempotency, closed inputs, embedded PostgreSQL profile/normalizer parity, same-company overrides, backfill ambiguity, lifecycle/role ceiling/self/last-admin guards.
- Scoped ESLint: no errors or warnings.
- service-role-ratchet: 2251 call sites versus immutable baseline 2353; baseline not changed.
- git diff --check passed.
- Isolated app typecheck with 4GB heap completed and reported dependency mismatch from temporary root context (requireIssuedAt absent in this old isolated customerAssertion) plus newly unknown tenant-query row types. The S2 row types were corrected. Earlier default 2GB attempts exhausted heap. No final integrated app/test typecheck success is claimed here; root owns that check with composed S1 dependencies.

Embedded PostgreSQL guards are not authentic native concurrency proof. `scripts/staff-user-commands-regression.sql` is prepared for disposable clean replay and rolls back synthetic data; it exercises the actual canonical mutation, role persistence, disable/enable replay, mandatory audit, foreign targets and native role ceilings. Root must run it against genuine replay before merge. Independent S3 actual-function embedded SQL mechanics and local repeat passed: real historical canonical access wrapper/hash trigger + actual S2 migration, mapped role persistence, disable/enable replay, one mandatory audit; invitation success/exact replay/changed-email conflict; injected audit failure rolls back membership, roles, canonical cache/events; cached replay rechecks inactive company lifecycle. This remains embedded SQL evidence, not genuine replay/concurrency/RLS proof. S3/S4 reviewed transaction and lifecycle paths; their typed preflight error/lifecycle findings were corrected before the checkpoint.

No push, PR, merge, production change or real invitation delivery performed by this package owner. Root owns the stacked PR and current migration integrity/type/schema artifacts.

Alternate-producer review: repository search found only company actions, the responsible-user settings adapter, initial platform-only company bootstrap, verified invitation acceptance, and genuinely global platform role/access management. The remaining lib/auth legacy grant/deactivate exports have no OPS callers after the settings adaptation. Bootstrap/acceptance/global platform governance retain their existing separate rules and cannot be invoked through staff routes.
