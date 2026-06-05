# Current Task

## Status

Completed.

## Goal

Create the initial AI context/project memory documentation structure for future Cursor work.

## Scope

Documentation-only setup under docs/ai-context plus root CURSOR.md.

## Relevant files

- CURSOR.md
- docs/ai-context/*.md

## Do not touch

- Application code
- Database schema/migrations beyond documentation
- Billing, BRP/eSett import or platform pricing implementation

## Rules to preserve

- Do not scan or rewrite the full repository by default.
- Do not modify application code in this step.
- Keep Gridex multi-tenant and production-safe.
- Keep customer billing underlay separate from platform tenant billing.
- Production runs on Vercel; do not rely on local-only binaries for production-critical flows.

## Expected result

All requested AI context Markdown files and CURSOR.md exist with the requested guidance for future work.

## Validation steps

- Confirm created file list.
- Confirm git diff only contains documentation/context files.

## Result

Created the requested AI context documentation structure and root Cursor rules. Existing root/docs Ediel documentation remains unchanged and can be reviewed for consolidation later.
