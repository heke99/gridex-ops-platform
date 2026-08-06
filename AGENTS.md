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
# Installed agent skills and execution contract

The canonical installed-skill inventory is `skills-lock.json`. The repository
currently contains 38 project-local skills under `.agents/skills/`.

For every non-trivial task, inspect the available skills before acting. Use all
skills relevant to the task, but do not run unrelated skills merely to satisfy a
count. At the start of the task, record a short skill-routing note containing:

- activated skills and why each applies;
- conditional skills that may activate later;
- skipped skill groups and the concrete reason they are not relevant.

If the task is a repository-wide audit, integrity review, security assessment,
multi-tenant review, database review, API-contract review, performance review,
or broad refactor, use the full baseline workflow below. A skill may only be
skipped when its trigger is objectively absent; record the reason in the audit.

## Canonical inventory: 38 installed skills

### Orchestration and delivery

1. `using-superpowers`
2. `brainstorming`
3. `writing-plans`
4. `executing-plans`
5. `dispatching-parallel-agents`
6. `subagent-driven-development`
7. `using-git-worktrees`
8. `finishing-a-development-branch`
9. `writing-skills`

### Repository understanding and quality

10. `acquire-codebase-knowledge`
11. `quality-playbook`
12. `code-review`
13. `find-bugs`
14. `differential-review`
15. `receiving-code-review`
16. `requesting-code-review`
17. `refactor`
18. `code-simplifier`
19. `verification-before-completion`

### Debugging and testing

20. `systematic-debugging`
21. `test-driven-development`
22. `property-based-testing`
23. `fp-check`
24. `variant-analysis`

### Security, static analysis, and supply chain

25. `code-security`
26. `security-threat-model`
27. `threat-model-analyst`
28. `semgrep`
29. `codeql`
30. `sarif-parsing`
31. `scan-secrets`
32. `install-hooks`
33. `sharp-edges`
34. `supply-chain-risk-auditor`

### Platform, contracts, and interface quality

35. `supabase`
36. `supabase-postgres-best-practices`
37. `spec-to-code-compliance`
38. `web-design-guidelines`

`react-best-practices` is not installed and must not be referenced as an
available project skill.

## Full baseline audit workflow

Use this order for a complete Gridex OPS baseline review. Complete the evidence
phase before changing source code.

### Phase 0 — Route and isolate the work

1. `using-superpowers`
2. `using-git-worktrees` when isolation from the current worktree is needed
3. `brainstorming` only when requirements, intended behavior, or architecture
   choices are ambiguous
4. `writing-plans` for work spanning multiple components or commits
5. `dispatching-parallel-agents` or `subagent-driven-development` only for
   independent workstreams with explicit boundaries

### Phase 1 — Establish repository truth

6. `acquire-codebase-knowledge`
7. `quality-playbook`
8. Read code, schema, migrations, generated types, OpenAPI documents, tests,
   jobs, webhooks, deployment configuration, and `.agent-memory`.
9. Produce an evidence-backed inventory before proposing fixes.

### Phase 2 — Database and tenant integrity

10. `supabase`
11. `supabase-postgres-best-practices`
12. Verify RLS, grants, SECURITY DEFINER usage, tenant filters, actor ownership,
    foreign keys, uniqueness, concurrency, migration integrity, and service-role
    boundaries.
13. Treat cross-tenant access, missing ownership, or wrong-company attribution
    as critical until disproven.

### Phase 3 — Security and static analysis

14. `security-threat-model`
15. `threat-model-analyst`
16. `code-security`
17. `scan-secrets`
18. `semgrep`
19. `codeql`
20. `sarif-parsing` when SARIF output is produced
21. `sharp-edges`
22. `supply-chain-risk-auditor`
23. `install-hooks` only when the user explicitly requests hook installation or
    prevention controls and the required consent is obtained

### Phase 4 — Contract, behavior, and defect analysis

24. `spec-to-code-compliance`
25. `code-review`
26. `differential-review` when a branch, PR, release, or revision comparison
    exists
27. `find-bugs`
28. `variant-analysis` after a concrete bug class or root cause is identified
29. `fp-check` for every material finding before it is classified as confirmed
30. `property-based-testing` where invariants, parsers, state machines,
    idempotency, pricing, authorization, or serialization logic benefit from
    generated cases
31. `web-design-guidelines` for user-facing UI, accessibility, interaction, or
    design-system work

### Phase 5 — Remediation

Do not modify production code until the finding is evidenced and passes
`fp-check` or equivalent direct verification.

32. `systematic-debugging` for each confirmed defect
33. `test-driven-development` before implementing the fix
34. `writing-plans` or `executing-plans` for multi-step remediation
35. `refactor` only when structural change is required to remove the verified
    root cause
36. `code-simplifier` after correctness is established, never before
37. Preserve existing behavior outside the verified scope.
38. Use forward migrations; never rewrite migrations already applied in
    production.

### Phase 6 — Review and completion gates

39. Run targeted tests, typecheck, migration checks, contract regressions,
    security scans, and the relevant OPS hardening workflow.
40. `requesting-code-review`
41. `receiving-code-review` when review feedback exists
42. `verification-before-completion`
43. Re-run `quality-playbook`
44. `finishing-a-development-branch`
45. Do not state that work is complete unless the required checks were executed
    successfully and the results are recorded.

## Non-negotiable project invariants

- Review the complete relevant execution path, not only the current diff.
- Treat tenant isolation as a critical invariant.
- Every read, write, job, document, communication, audit event, invoice,
  contract, customer record, and API response must belong to the correct tenant,
  company, organization, creator, customer, or person.
- Compare application code, database schema, migrations, generated types,
  OpenAPI contracts, background jobs, webhooks, tests, deployment configuration,
  and documented product behavior.
- Distinguish confirmed findings, likely findings, false positives, blocked
  checks, and unverified assumptions.
- Every confirmed finding must include severity, evidence, affected files,
  reproduction or proof, business impact, root cause, and a targeted fix.
- Implement only verified fixes.
- Prefer small, independently reviewable changes.
- Do not weaken RLS, authorization, validation, constraints, auditability,
  idempotency, or type safety.
- Preserve unrelated working-tree changes.
- Never expose, copy, or commit real secrets, credentials, or production data.
- Record fixed, open, blocked, false-positive, and unverified findings under
  `quality/` or the task-specific audit path.
- Evaluate files longer than 2,000 lines and split them only at safe,
  verifiable boundaries.
- `writing-skills` applies only when creating or modifying reusable skill
  instructions; it is not a general documentation requirement.

## Required audit output

For repository-wide audits, produce:

1. a skill-routing record;
2. an evidence-backed system inventory;
3. a prioritized findings register;
4. false-positive and blocked-check registers;
5. a tenant-isolation and ownership matrix;
6. a verification matrix showing the exact commands and outcomes;
7. a remediation plan divided into small PRs;
8. no production-code changes unless the user explicitly requested remediation.
<!-- END:upstream-review-skills -->
