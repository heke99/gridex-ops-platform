# Current task

Updated: 2026-08-11

Status: `IN_PROGRESS`

Active work item: post-#110 codebase health residual remediation on
`cursor/codebase-health-and-stability-0f25`.

## Skill routing

- Activated: using-superpowers, find-bugs, differential-review, code-review,
  code-security, fp-check, supabase-postgres-best-practices,
  test-driven-development, scan-secrets (ggshield missing → BLOCKED),
  verification-before-completion
- Conditional later: systematic-debugging if CI fails; requesting-code-review
  after verification
- Skipped: full quality-playbook / threat-model (scoped tip residual);
  brainstorming (requirements evidenced by #110 tip + open #109)

## Exact next action

Open PR for `0f25`, record verification evidence, and note that this branch
supersedes unmerged #109 by rebasing the post-#108 security residual onto the
post-#110 tip plus auth flash/next-path hardenings.
