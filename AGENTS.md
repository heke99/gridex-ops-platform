<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Agent Operating Contract

This is a long-lived production project.

## Active Masterplan coordination board — 2026-10-07

Use [#673](https://github.com/heke99/gridex-ops-platform/issues/673) for new
Masterplan CLAIM/READY/BLOCKED/MERGED/RELEASE receipts and handovers.
[#530](https://github.com/heke99/gridex-ops-platform/issues/530) reached GitHub's
2,500-comment limit and remains the historical evidence archive. Read the
current board and relevant linked #530 receipts before selecting or resuming work.

Operational instructions in older memory files or prompts to post new receipts
on #530 now refer to #673. Preserve original #530 links and historical receipts;
do not rewrite them or treat the channel move as a release. Atomic GitHub refs
still determine ownership, and the reservation, documentation, review, coverage
and merge protocols remain unchanged.

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
13. For Masterplan work, read `.agent-memory/masterplan-agent-workflow.md`,
    `.agent-memory/masterplan-reservations.md`, your own checkpoint, the legacy PR register,
    latest #673 receipts, relevant historical #530 receipts and live remote locks before
    selecting a packet.
14. Continue from the recorded next action.

Do not restart completed work because chat context is missing. Code, current
schema and executed verification have higher authority than memory. Maintain
one active work item at a time.

After every atomic subtask, inspect changes, run targeted verification, update
the checkpoint and current task, record the exact next action, and continue.

For parallel Masterplan packets, each technical agent records these updates in
its own packet checkpoint and on #673. Agents acquire the atomic memory-role
lock to reconcile shared current-task/checkpoint/handover from those receipts.

Before session end, update checkpoint, handover, current state, blockers,
completed work, verification matrix and the session log. Never store secrets,
production customer data or raw credentials in project memory.

<!-- BEGIN:upstream-review-skills -->
# Installed agent skills and execution contract

The canonical installed-skill inventory is `skills-lock.json`. The repository
currently contains 42 project-local skills under `.agents/skills/`.

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

## Canonical inventory: 42 installed skills

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

### Performance and observability

39. `vercel-react-best-practices`
40. `performance-optimization`
41. `observability-and-instrumentation`
42. `sql-optimization-patterns`

The installed `vercel-react-best-practices` skill is available for React and
Next.js performance work. The repository's installed Next.js documentation in
`node_modules/next/dist/docs/` remains higher authority for version-specific
APIs, caching, rendering, route conventions, and deprecations.

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

### Performance review overlay

When performance is in scope, complete this evidence pass before remediation:

- `performance-optimization` defines the measure → identify → fix → verify →
  guard workflow. Do not keep neutral or unmeasured optimizations.
- `vercel-react-best-practices` applies to React/Next.js waterfalls, server/client
  boundaries, bundle size, serialization, rendering and re-render findings.
- `observability-and-instrumentation` applies when production-safe timing,
  p50/p95/p99, tracing or structured telemetry is needed to prove the bottleneck
  or verify the result.
- `sql-optimization-patterns` applies to measured database/query bottlenecks,
  together with `supabase-postgres-best-practices`.
- Never cache or shortcut tenant-sensitive auth/RBAC/RLS decisions across
  security boundaries. Never move authoritative server validation client-side
  for speed.
- Record baseline and after measurements using comparable conditions and retain
  only changes that improve the proven metric while all correctness gates stay
  green.

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

## Ediel masterplan v2 delivery contract

Applies to all work against `docs/ediel/masterplan-v2/` (owner decision 2026-10-03; next-wave coordination updated by the owner 2026-10-06).

1. **One rule at a time, to done.** Pick one rule card (or a small cluster that
   shares code) and implement every `condition`/`on_pass`/`on_failure` and every
   acceptance contract `expected`/`prohibited` effect from
   `docs/ediel/masterplan-v2/registers/{rules,acceptance_tests}.json`.
2. **Every effect has an asserting behaviour test.** Call the code; do not
   string-match source files. Tag each test file with the IDs it proves:
   `// masterplan: P-04, AT-P-04, SC-024`.
3. **Approve in the same PR.** When all effects of an ID are asserted and green,
   set it in `quality/audits/ediel-masterplan-v2/coverage.json` (rule
   `VERIFIED`, contract `PASSED`) with the code and test paths as evidence.
   `npm run ediel:masterplan-v2:test-coverage` lists tagged-green candidates;
   `-- --check` (run in CI) fails if an approved ID has no tagged test or a
   tagged test fails. Market activation and counterparty testing stay separate
   gates and do not block code approval.
4. **Small PRs, merged when green.** One rule or cluster per PR, merged the same
   day CI is green. No long-lived composed candidate branches; rebase or split
   instead of accumulating hundreds of files.
5. **Minimal paperwork.** The test and the coverage row are the evidence. Record
   one line per merge in `.agent-memory/handover.md`; do not write new audit
   narratives per step.
6. **Priority:** TEN (beneficiary/data-access grants) → ESCO (Z13 21-day repeat,
   Z15VH, scoped market permission) → ACK (correlation key, incident flow) →
   remaining partial cards.
7. **Shared work:** before starting a cluster, check open PRs and
   `.agent-memory/handover.md` so two sessions never fix the same thing.
8. **Self-selection and reservation (mandatory, Claude and Codex):** choose
   two eligible unapproved rule IDs and their contracts yourself from current
   main, priority and dependencies (or two remaining contract/scenario IDs when
   work is acceptance-only; a final single eligible ID is allowed). Read #673
   and relevant historical #530 receipts,
   current PRs, checkpoints and live remote locks. Atomically reserve IDs and
   exact file scope using `.agent-memory/masterplan-reservations.md`, then post
   `CLAIM <IDs> — <agent> — packet <UUID> — branch <branch>` with the receipt
   and next action before code. Conflicts require selecting other free work.
   No user assignment, coordinator acknowledgement or staggered launch is needed.
   Issue #673 carries new progress; #530 preserves earlier evidence. Atomic refs
   establish ownership. Acquire the
   merge-role lock for serial current-head delivery. Post `READY <IDs> — PR #N` for reviewable work,
   `CI_GREEN` only for the current head, and `MERGED <IDs> — PR #N — <main SHA>`
   after actual delivery. Only then select the next pair. A legacy `DONE` comment
   about a green open PR is not a merge receipt or released ownership.
   Post `RELEASE <ID> — <reason/remaining work/checkpoint>` on explicit handover.
   Never edit `coverage.json` rows for IDs you have not claimed.
   Each agent maintains its checkpoint, mirrors actual receipts under the
   shared-memory role lock, releases its own resources after documentation and
   delivery/handover, and selects the next eligible packet without another prompt.
9. **Mandatory documentation before more work:** each agent records what it
   claimed, what it completed, exact commit/verification, blockers/dependencies
   and its next action before starting and after each meaningful transition.
   No next packet without current memory and atomically confirmed ownership. Follow
   `.agent-memory/masterplan-agent-workflow.md` for the complete contract.
10. **Retained PR work first:** assess relevant entries in
    `.agent-memory/masterplan-legacy-pr-register.json` against current main and
    original requirements before new implementation. CLOSED_UNMERGED preserves
    reusable work and unresolved HOLD/PAUSED criteria. Reopen suitable original
    PRs individually after scope/owner confirmation, or reuse unique changes in
    a small current-main PR linked to the original. Do not import historic stacks
    wholesale or redo delivered work.

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
