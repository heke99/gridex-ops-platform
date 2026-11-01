## Discover the current host's tools

Read the active tool catalog and schemas before mapping a skill's generic tool names. Availability is provided by the host; do not edit global Codex configuration or copy Claude configuration to enable assumed capabilities.

In a host exposing the current collaboration API, use `collaboration.spawn_agent`, `collaboration.send_message`, `collaboration.followup_task`, `collaboration.wait_agent`, `collaboration.list_agents` and `collaboration.interrupt_agent` according to their actual schemas. Call collaboration tools directly, outside `functions.exec`. Keep implementers available for bounded fixes; an interrupt stops a turn, not the agent. Do not invent a lifecycle tool absent from the catalog. If delegation is unavailable, perform the scoped work inline or give a concrete handoff.

For command tools exposed through `functions.exec`, call the discovered `tools.exec_command` and inspect its result. Resume an `exec_command` session with `tools.write_stdin`. Use `functions.wait` only after a `functions.exec` result reports a running cell ID; these identifiers are different. For other hosts, use their exposed equivalents and schemas.

Resolve skill locations from the supplied catalog or the installed repository `.agents/skills/` tree. Read referenced files relative to the installed skill, not an assumed upstream checkout. Missing optional runners are a capability limit; use the documented available mode without fabricating scripts or claiming that unavailable checks ran.

## Environment Detection

Skills that create worktrees or finish branches should detect their
environment with read-only git commands before proceeding:

```bash
worktree_git_dir=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
worktree_common_dir=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
worktree_branch=$(git branch --show-current)
```

- First exclude a submodule with `git rev-parse --show-superproject-working-tree`.
- Different resolved Git/common directories in a non-submodule mean an existing linked worktree; reuse it.
- An empty branch name means detached HEAD. It says nothing about filesystem permissions, remote authorization or available branch/PR tools. Check the actual operation and existing worktree/custody mandate; create an own branch when authorized and supported.

See `using-git-worktrees` Step 0 and `finishing-a-development-branch`
Step 1 for how each skill uses these signals.

## Codex App Finishing

Use available branch, PR and app controls within existing authorization. If an operation is actually denied, record that operation and reason; continue safe independent work and prepare a concrete handoff. Do not infer a sandbox denial from Git state, invent UI controls, or bypass an approval rejection through another tool. Reuse the user's existing task mandate instead of requesting generic permission again. Production, external payload processing, hooks and shared producer transitions retain their own boundaries.
