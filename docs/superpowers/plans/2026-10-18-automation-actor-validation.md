# Validate the configured automation actor before scheduled work

The customer-operations cron currently accepts an existing Auth user without checking
the active `user_profiles` row required by permission deadline execution. It also
returns `ok: true` when Auth verification fails. The production deadline step has
reported `42501 permission_execution_actor_unqualified` on consecutive deployments.

1. Add behavior regressions for missing/invalid configuration, Auth failures,
   mismatched/deleted/banned identities, missing/inactive profiles and profile errors.
2. Require the exact configured Auth identity and an active matching profile.
   Verification failures must return a distinct, unsuccessful configuration status.
   Never create profiles, reactivate accounts or grant tenant permissions here.
3. Run existing actor/configuration and cron-isolation regressions, application/test
   typechecks, scoped lint, database/API integrity gates and a production build.
4. Obtain two independent reviews before normal delivery. Keep the cron route,
   actively owned POA implementation in PR #828, schema producers and shared memory
   outside this four-file change. Production activation requires normal delivery.

Skill routing: systematic-debugging and fp-check establish the execution path and
observed SQL failure; TDD covers the validator; using-git-worktrees isolates current
main; writing-plans records this sequence; verification-before-completion and
requesting-code-review control delivery. Supabase guidance applies to the read-only
Auth/profile boundary. No UI, package, schema or measured performance change is made,
so design, supply-chain, SQL optimization and native/GEN production are not activated.

The earlier Web audit and live checks remain in Gridex Web PR #53. Intermittent
upstream timeouts are not attributed to this validator without further evidence.
