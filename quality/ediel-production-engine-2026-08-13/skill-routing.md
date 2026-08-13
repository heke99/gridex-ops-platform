# Skill routing — canonical multi-tenant Ediel production engine

Date: 2026-08-13

## Activated

- `using-superpowers`: enforce the repository skill contract.
- `acquire-codebase-knowledge`: produce a source-backed repository and execution-graph inventory.
- `quality-playbook`: derive requirements, audit behavior and preserve reproducible evidence.
- `writing-plans` and `executing-plans`: decompose and execute the repository-wide remediation with checkpoints.
- `supabase` and `supabase-postgres-best-practices`: inspect live PostgreSQL state, migrations, RLS, grants, functions, indexes and advisors.
- `spec-to-code-compliance`: map the supplied Ediel requirements and official rule sources to code, schema and tests.
- `security-threat-model`, `threat-model-analyst`, `code-security`, `scan-secrets`, `semgrep`, `codeql`, `sharp-edges` and `supply-chain-risk-auditor`: cover tenant isolation, privileged SQL, parsers, routes, dependencies and release security.
- `code-review`, `find-bugs`, `differential-review`, `variant-analysis` and `fp-check`: confirm findings and search for same-root variants before remediation.
- `systematic-debugging`, `test-driven-development` and `property-based-testing`: reproduce each verified defect and prove its root-cause fix.
- `refactor` and `code-simplifier`: consolidate duplicate Ediel semantics only after correctness is established.
- `requesting-code-review`, `receiving-code-review`, `verification-before-completion` and `finishing-a-development-branch`: gate publication and merge.
- GitHub plugin (`github`, `gh-fix-ci`, `yeet` fallback): repository, PR, review and hosted-CI state.
- Supabase plugin: live project `piidsfebjqjmnepdpnas` inspection and verified forward migration work.
- Vercel plugin (`deployments-cicd`, `vercel-api`): deployment/build/runtime verification after merge.

## Conditional

- `sarif-parsing`: activates if CodeQL or Semgrep emits SARIF.
- `web-design-guidelines`: activates only if user-facing Ediel status or diagnostics UI requires changes.
- `receiving-code-review`: activates when current or newly created PR feedback is actionable.

## Skipped

- `brainstorming`: the supplied 134-section target is explicit; no product-design ambiguity blocks the audit.
- `dispatching-parallel-agents` and `subagent-driven-development`: Quality Playbook requires synchronous same-session evidence, and the current multi-agent policy does not permit delegation for this task.
- `install-hooks`: no hook installation was requested and the skill requires separate consent.
- `writing-skills`: no reusable skill is being created or modified.
