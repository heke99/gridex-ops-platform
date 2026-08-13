# Open blockers

Updated: 2026-08-13

1. Hosted CI for `a855` not yet observed in this session.
2. ggshield CLI missing locally — secret scan BLOCKED in agent environment.
3. Unmerged `#115` / `#113` / older health drafts overlap this tip residual;
   close as superseded after `a855` merges.
4. `#116` review-hardening migration is not fully idempotent on already-restored
   end-state DBs (ops clone/re-apply risk); do not rewrite applied migration.
5. External release evidence gates from the 75-point campaign remain outside this
   health residual scope.
