<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent Operating Contract

This is a long-lived production project.

Before every non-trivial task:

1. Read `.agent-memory/README.md`.
2. Read `.agent-memory/current-state.md`.
3. Read `.agent-memory/current-task.md`.
4. Read `.agent-memory/checkpoint.json`.
5. Read `.agent-memory/handover.md`.
6. Read `.agent-memory/open-blockers.md`.
7. Read the active section of `.agent-memory/work-plan.md`.
8. Read relevant domain-memory files.
9. Search `.agent-memory/decisions.md`.
10. Search `.agent-memory/known-failures.md`.
11. Inspect `git status` and `git diff` when Git metadata is available.
12. Inspect the actual implementation.
13. Continue from the recorded next action.

Do not restart completed work because chat context is missing. Code, current
schema and executed verification have higher authority than memory. Maintain
one active work item at a time.

After every atomic subtask, inspect changes, run targeted verification, update
the checkpoint and current task, record the exact next action, and continue.

Before session end, update checkpoint, handover, current state, blockers,
completed work, verification matrix and the session log. Never store secrets,
production customer data or raw credentials in project memory.

<!-- BEGIN:upstream-review-skills -->
# Upstream repository review skills

For repository-wide integrity, database, tenant, security, performance,
architecture, or refactoring work, explicitly use all relevant installed
upstream skills.

Required execution order:

1. acquire-codebase-knowledge
2. quality-playbook
3. supabase
4. supabase-postgres-best-practices
5. security-threat-model
6. threat-model-analyst
7. code-review
8. find-bugs
9. react-best-practices
10. web-design-guidelines
11. refactor
12. code-simplifier
13. quality-playbook recheck

Rules:

- Review the complete repository, not only the current diff.
- Read the existing .agent-memory files before starting.
- Treat tenant isolation as a critical invariant.
- Compare code, schema, migrations, generated types, API contracts,
  background jobs, webhooks, tests and deployment configuration.
- Every read, write, job, document, communication and API response must
  belong to the correct tenant, company, organization, creator, customer
  or person.
- Establish an evidence-based audit before changing source code.
- Implement only verified fixes.
- Prefer small, incremental changes.
- Use forward migrations rather than modifying migrations already applied
  in production.
- Do not weaken RLS, authorization, validation, constraints or type safety.
- Do not claim that a check passed unless it was executed successfully.
- Preserve unrelated working-tree changes.
- Record fixed, open, blocked and unverified findings under quality/.
- Evaluate files longer than 2,000 lines and split them only at safe,
  verifiable boundaries.
<!-- END:upstream-review-skills -->
