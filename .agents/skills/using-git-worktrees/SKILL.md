---
name: using-git-worktrees
description: Use when starting feature work that needs isolation from current workspace or before executing implementation plans - ensures an isolated workspace exists via native tools or git worktree fallback
---

# Using Git Worktrees

## Overview

Ensure work happens in an isolated workspace. Prefer your platform's native worktree tools. Fall back to manual git worktrees only when no native tool is available.

**Core principle:** Detect existing isolation first. Then use native tools. Then fall back to git. Never fight the harness.

**Announce at start:** "I'm using the using-git-worktrees skill to set up an isolated workspace."

## Step 0: Detect Existing Isolation

**Before creating anything, check if you are already in an isolated workspace.**

```bash
worktree_git_dir=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
worktree_common_dir=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
worktree_branch=$(git branch --show-current)
```

**Submodule guard:** Different Git/common directories also occur inside git submodules. Before concluding "already in a worktree," verify you are not in a submodule:

```bash
# If this returns a path, you're in a submodule, not a worktree — treat as normal repo
git rev-parse --show-superproject-working-tree 2>/dev/null
```

**If the resolved directories differ (and not a submodule):** You are already in a linked worktree. Skip to Step 2 (Project Setup). Do NOT create another worktree.

Report with branch state:
- On a branch: "Already in isolated workspace at `<path>` on branch `<name>`."
- Detached HEAD: "Already in isolated workspace at `<path>` (detached HEAD, externally managed). Branch creation needed at finish time."

**If the resolved directories match (or in a submodule):** Continue with the repository/submodule's actual isolation needs.

Use the user's existing task mandate and declared workspace preference. Routine reversible isolation within that scope needs no repeated generic confirmation. Honor an explicit instruction to work in place. Ask only when an unresolved choice materially changes scope or requires authorization not already given; continue independent safe work meanwhile.

**A worktree isolates files, not services.** On a shared host, database stacks, Docker labels/volumes, ports, mail receivers and native/GEN producers need their own verified ownership and namespace. Do not start, stop, reset or reuse another worker's resources because the filesystem is isolated.

## Step 1: Create Isolated Workspace

**You have two mechanisms. Try them in this order.**

### 1a. Native Worktree Tools (preferred)

Discover whether the current host exposes a worktree tool and read its schema. Use an available native tool within the existing mandate, then skip to Step 2. Do not infer availability from another runtime's tool names or modify global configuration to obtain a tool.

Native tools handle directory placement, branch creation, and cleanup automatically. Using `git worktree add` when you have a native tool creates phantom state your harness can't see or manage.

Only proceed to Step 1b if you have no native worktree tool available.

### 1b. Git Worktree Fallback

**Only use this if Step 1a does not apply** — you have no native worktree tool available. Create a worktree manually using git.

#### Directory Selection

Follow this priority order. Explicit user preference always beats observed filesystem state.

1. **Check your instructions for a declared worktree directory preference.** If the user has already specified one, use it without asking.

2. **Check for an existing project-local worktree directory:**
   ```bash
   ls -d .worktrees 2>/dev/null     # Preferred (hidden)
   ls -d worktrees 2>/dev/null      # Alternative
   ```
   If found, use it. If both exist, `.worktrees` wins.

3. **If there is no other guidance available**, default to `.worktrees/` at the project root.

#### Safety Verification (project-local directories only)

**MUST verify directory is ignored before creating worktree:**

```bash
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

**If NOT ignored:** Prefer an authorized directory outside the repository. Change `.gitignore` only when that file is within the task's verified custody and the change is necessary; do not create an unrelated commit automatically.

**Why critical:** Prevents accidentally committing worktree contents to repository.

#### Create the Worktree

```bash
# Determine path based on chosen location
path="$LOCATION/$BRANCH_NAME"

git worktree add "$path" -b "$BRANCH_NAME"
cd "$path"
```

**Sandbox fallback:** If creation is actually denied, record the operation and reason. Use another already-authorized isolated path or continue read-only/independent work. Do not silently write in a shared current checkout or retry through another tool to evade an approval rejection. Explain a concrete remaining authorization need only if it blocks necessary work.

## Step 2: Project Setup

Read the manifest, lockfile, pinned runtime and repository setup instructions. Reuse a compatible prepared dependency installation when supported. Install only missing dependencies needed by this task, using the declared lock-preserving command; do not upgrade or rewrite a lockfile as setup. Do not auto-build, install hooks, start services or run broad suites merely because a manifest exists. Record unavailable runtime/tooling and continue useful work that does not depend on it.

## Step 3: Verify Clean Baseline

Inspect Git state and run the smallest relevant baseline checks for the planned change. Keep required final quality gates; a targeted baseline does not replace them. Native, mutating integration, full-build and shared-producer checks run only in their qualified owned environment.

**If a baseline check fails:** Record its exact command, source and outcome; investigate within the existing authorized scope, distinguish pre-existing failures, and continue independent work. Do not weaken a gate or request another generic proceed/investigate decision. Clarify only a concrete unresolved scope, destructive action or external authorization requirement.

**If the relevant checks pass:** Report their actual scope. If checks could not run, state that limit instead of declaring a passing baseline.

### Report

```
Worktree ready at <full-path>
Baseline checks: <actual commands/results or explicit not-run limitation>
Ready to implement <feature-name>
```

## Quick Reference

| Situation | Action |
|-----------|--------|
| Already in linked worktree | Skip creation (Step 0) |
| In a submodule | Treat as normal repo (Step 0 guard) |
| Native worktree tool available | Use it (Step 1a) |
| No native tool | Git worktree fallback (Step 1b) |
| `.worktrees/` exists | Use it (verify ignored) |
| `worktrees/` exists | Use it (verify ignored) |
| Both exist | Use `.worktrees/` |
| Neither exists | Check instruction file, then default `.worktrees/` |
| Directory not ignored | Prefer an authorized external directory; edit ignore rules only in custody |
| Permission error on create | Preserve isolation; record denial and continue authorized independent work |
| Tests fail during baseline | Record and troubleshoot within mandate; preserve required gates |
| Dependencies missing | Install only task-required pinned dependencies when authorized |

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'm obviously not in a worktree — no need to check" | Run Step 0. Harness-created isolation and submodules both fool eyeballing; the detection commands settle it. |
| "`git worktree add` is quicker than hunting for a native tool" | A native tool (e.g. `EnterWorktree`) owns placement, branching, and cleanup. Bypassing it is the #1 mistake — it creates phantom state your harness can't see or manage. |
| "The worktree directory is surely ignored already" | Run `git check-ignore`. An unignored worktree directory commits the whole tree into the repo. |
| "Any directory name works" | Explicit instructions beat an existing project-local directory, which beats the `.worktrees/` default. |
| "The workspace is fresh — baseline checks can wait" | Establish the relevant source/check baseline, report failures and investigate within the task mandate. Required final gates still apply. |
