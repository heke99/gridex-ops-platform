# Cursor Workflow

## Default workflow

Before making changes:

1. Read the relevant ai-context files.
2. Read 11_CURRENT_TASK.md.
3. Identify likely relevant files.
4. Inspect only those files first.
5. If additional files are needed, explain why before expanding scope.
6. Apply the smallest production-safe change that fixes the problem.
7. Run validation.
8. Update 10_CHANGELOG.md.
9. Update ai-context files if rules, architecture or approved flows changed.
10. Return a summary with changed files, reason and validation result.

## Do not do this by default

Do not:

- scan the entire repository without need
- rewrite unrelated files
- perform large refactors unless explicitly requested
- delete existing functionality
- weaken tenant isolation
- bypass RLS by trusting client-submitted company_id
- hardcode test values
- break approved Ediel flows
- change database schema without documenting migration intent
- silently change business rules
- create duplicate billing/export/import systems
- mix customer billing underlay with platform tenant billing
- introduce local-only runtime dependencies for production flows

## Scope expansion rule

Start with the scoped files.

If the correct fix requires files outside the initial scope, Cursor may inspect and modify additional files only when necessary.

When expanding scope, document:

- which extra file is needed
- why it is needed
- what risk it affects
- whether it changes existing behavior

## Multi-file fixes

Cursor may modify several files when the issue crosses module boundaries.

Examples:

- UI state plus server action plus validation function
- EDIFACT parser plus ACK builder plus send guard
- route profile resolver plus outbound draft builder plus diagnostics
- database migration plus server query plus UI display
- file upload plus parser plus row validation plus billing underlay connection
- platform pricing setting plus usage event plus audit log plus sidebar UI

The change must still stay focused on the current task.

## Reuse before creating

Before creating a new function, module, table or route, search for an existing implementation.

Prefer extending existing:

- parser
- ACK builder
- route resolver
- send readiness checker
- event log writer
- tenant guard
- server action
- UI component
- import/upload system
- billing/export system
- audit helper

Do not create parallel duplicate logic unless the old logic is clearly wrong and documented through Override Protocol.

## Large file rule

If a file is over 800 lines and needs changes, Cursor should consider splitting it into smaller focused modules.

But Cursor must not refactor large files just for cleanup unless the current task requires touching that file.

When splitting large files:

- preserve existing behavior
- preserve exports/imports
- keep routes/actions compatible
- avoid breaking approved Ediel flows
- run build/typecheck
- document changed file structure in changelog

## Output rule

When returning files or patches, return only changed or added files.

Do not return the full repository unless explicitly requested.

## Rule override

If an existing context rule is wrong, incomplete or blocks correct production behavior, Cursor may override it only by following 13_OVERRIDE_PROTOCOL.md.

## No silent fallback

Do not silently fallback to unsafe defaults.

Examples of unsafe fallback:

- missing receiver subaddress => send without subaddress
- missing certificate => send unencrypted
- missing route profile => use first route
- unknown tenant => assign to current user company
- failed payload parse => mark as parsed
- unknown ACK decision => positive APERAK
- missing price model => export billing row anyway
- unmatched import row => attach to customer by name only

If required data is missing, block and show clear configuration error.

## After each task

Update 10_CHANGELOG.md with:

- date
- task name
- files changed
- what changed
- why
- validation run
- risks
- follow-up needed

Update 11_CURRENT_TASK.md with:

- status
- result
- changed files
- validation
- unresolved items
