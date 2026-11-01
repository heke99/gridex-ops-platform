---
name: scan-secrets
description: Use when scanning code, commits, git history, Docker images, or packages for hardcoded secrets, when editing credential-handling code, .env files, CI/CD workflows, Dockerfiles, or deployment scripts, or before committing or pushing.
metadata:
  version: "0.5.0" # x-release-please-version
---

# Secret Scanning — Offline First

## Overview

`ggshield` is a CLI that detects 700+ types of hardcoded secrets — AWS keys, GitHub tokens, database connection strings, private keys, Stripe keys, Slack webhooks, JWTs, and more — in files, git history, Docker images, and PyPI packages.

**Core rule:** use an available offline scanner on the relevant changes before presenting credential-handling work. Do not commit or expose detected secrets. Report scan scope and limitations accurately.

## Start Here — Read This Before Doing Anything

**Do not skip this section.**

- **Default to offline scanning.** Discover an installed local scanner such as Gitleaks, inspect its version/help, and select the relevant working-tree, staged or history scope. Keep findings redacted. Disable remote verification and confirm the selected mode sends no content or credential values externally. A regex search can supplement review but is not a complete detector.
- **GitGuardian scanning is external processing.** `ggshield secret scan` and the GitGuardian MCP scanner can transmit source or detected secret material to the provider. An installed CLI, API key, generic autonomy mandate, or a request to inspect secrets does not authorize that export. Use them only with explicit authorization covering the provider and payload scope; reuse authorization already given for that exact operation. The commands below and setup references apply only after that condition is met.
- **If no offline scanner is available,** record the unavailable scan and its coverage limit, perform safe local review, and continue unaffected work. Do not substitute an external upload or claim a full scan passed. Never print credential values, dump the environment, or read unrelated credential stores to troubleshoot setup.
- **A rejected export stays rejected.** Do not retry through another client, scanner, flag, encoding or endpoint to bypass automatic approval review. Use an offline alternative and report the blocked action and stated reason.
- **Do not improvise remediation advice.** No general-knowledge rotation walkthroughs, no improvised `git filter-repo` / BFG suggestions, no HMSL omissions. When `ggshield` returns one or more findings, **read [`references/remediation-doctrine.md`](references/remediation-doctrine.md) before composing any user-facing remediation message** — the doctrine differs from common defaults in important ways (rotation > history rewrite; HMSL is the prescribed follow-up for unverifiable validity).
- **For an authorized GitGuardian scan,** pass `--json` and pair recursive `-r` with `-y` to avoid an interactive hang. Keep raw results private and redact findings before reporting. These flags do not provide export authorization.
- **Setup is scoped work.** Consult [references/ggshield-cli-setup.md](references/ggshield-cli-setup.md) only when GitGuardian setup is requested or already authorized. Authentication and `api-status` are network operations; neither authorizes payload scanning.
- **Do not surface code containing a detected secret. Let the scan finish first.** Do not begin remediation on the first hit — `ggshield` reports the complete finding set in one run, and the same credential often appears across several files or commits. Only once the scan has completed:
  1. Stop. Enumerate **every** finding, then group them: collapse the same credential value seen across multiple files / commits / artifacts into a single item, and keep distinct credentials separate. Report the grouped set (file(s), line(s), secret type, **validity**).
  2. **Read [`references/remediation-doctrine.md`](references/remediation-doctrine.md) end-to-end** — do not skip this step. Common defaults on history rewriting, rotation triggers, and HMSL follow-up diverge from GitGuardian doctrine.
  3. Triage the complete, deduplicated set, then compose **one consolidated** remediation plan: rotation first, HMSL follow-up for unverifiable-validity findings, history-rewrite only under the narrow conditions listed in the reference. One credential is one rotation, even if it leaked in five places. A `valid` validity result does **not** let you skip triage — it raises urgency, but ownership and blast radius still select the remediation shape, and a valid production-critical credential is a supervised, sequenced rotation (Coordination), not a fast "just rotate it." See doctrine principle 7.

  Do not commit, do not show the code with the secret inline, do not "just continue and we'll fix it later," and do not start rotating one finding while others are still being scanned or triaged.
- **Do not extend this skill's agent-executable contract to HMSL.** When a finding's `validity` is `unknown`, `cannot_check`, or `no_checker`, the natural follow-up is HasMySecretLeaked (HMSL) — GitGuardian's privacy-preserving hash-lookup service for *known* credentials against the public-leak corpus. HMSL has a **different execution model — user-run only** — and the contract holds whether or not the user has the dedicated `check-hmsl` skill installed:
  - Do **not** invoke `ggshield hmsl check`, `fingerprint`, `query`, `decrypt`, or `check-secret-manager` yourself.
  - Do **not** read the credential file with `Read` / `Grep` / `cat` / `head` / `tail` / `sed` / `awk` / `less` / `xxd` / `wc` / `file` / `ls` or any other tool — that pulls plaintext into the agent context before HMSL's local-hashing protocol can protect it.
  - Print the exact command for the user to run in their own terminal. Use `-n none --json` so the output the user pastes back contains no identifying hints. Suggest `ggshield hmsl quota` before any bulk check. Refuse `--naming-strategy cleartext` outright.
  - If the user has the `check-hmsl` skill installed, the agent should load it for the full protocol and command set; if not, the rules above are sufficient on their own — do not gate the follow-up on having the other skill.

## When to Use

Trigger a scan when:

- The user asks to scan a file, directory, or repository for secrets or credentials
- You are writing or modifying code that handles API keys, tokens, passwords, connection strings, or any credentials — scan before presenting the result
- The user is about to commit or push — scan staged changes first

What `ggshield` covers:

- Scan files and directories on disk (`secret scan path`)
- Audit a repository's full git history (`secret scan repo`) — catches secrets committed and later deleted
- Scan a specific commit, a commit range, or staged changes
- Scan Docker images and PyPI packages
- Run as a CI gate that fails on findings
- Install git hooks (pre-commit / pre-push) and AI agent hooks (Claude Code, Cursor, Copilot) — the agent hooks scan the prompt, tool calls, and tool outputs from inside the agent itself
- Manage false positives via `# ggignore` comments and `.gitguardian.yaml`

For detailed command variants, expected JSON output shapes, and CI integration, see [references/workflows.md](references/workflows.md).
For interpreting scan output, the HMSL follow-up contract, and false-positive workflows, see [references/interpreting-results.md](references/interpreting-results.md).
For remediation — triage, rotation rules, when (and when not) to rewrite git history, per-secret-type runbooks, and validation, see [references/remediation-doctrine.md](references/remediation-doctrine.md).
For shared `ggshield` install, authentication, headless setup, CI tokens, and hook-install commands, see [references/ggshield-cli-setup.md](references/ggshield-cli-setup.md).
For platform-wide topics that span every GitGuardian skill (public docs URL pattern, auth/scope recovery, instance URLs, headless setup), see [references/gitguardian-platform.md](references/gitguardian-platform.md).

## When Not to Use

Do not use this skill when:

- The user already holds a *known* credential and wants to know whether it has leaked publicly — use `check-hmsl`. This skill finds *unknown* secrets; that one checks known ones against the public-leak corpus.
- The request is to inventory credentials across the whole machine (dotfiles, cloud CLI configs, shell history, other repos) — use `scan-machine`.
- The requested provider upload lacks explicit payload authorization: keep the work offline and report the external scan as not executed.

## Onboarding (first use)

### Prerequisites

- **`ggshield` 1.49.0 or later** — required for full feature support including the AI agent hooks (`ggshield install -t claude-code`, `-t cursor`, `-t copilot`). Older `ggshield` versions can scan but can't install agent hooks.
- A **GitGuardian account** (free tier available at https://dashboard.gitguardian.com/signup).

### Setup

For explicitly requested GitGuardian setup, check its installed version and follow [references/ggshield-cli-setup.md](references/ggshield-cli-setup.md). Never echo API keys or copy them into chat. Successful authentication still requires the separate payload-export condition above.

#### Optional — Hooks only when explicitly requested

Hooks change future agent/git behavior and can process prompts, tool inputs and outputs. Do not propose or install them automatically during a scan. If hook installation is explicitly requested, use the `install-hooks` skill and the authorized local/global scope; verify its data-processing boundary before execution. The following are reference commands, not onboarding actions:

```bash
ggshield install -t claude-code -m global     # Claude Code
ggshield install -t cursor -m global          # Cursor
ggshield install -t copilot -m global         # Copilot
```

Preserve the HMSL user-run-only contract above. A prior installation request is not permission to send a new repository or secret payload to an external service.

#### Step 2 — Brief the user on what this skill enables

- Scan code for hardcoded secrets — automatically when handling credentials, or on request for a specific file or directory.
- Audit a repository's git history, a commit range, a single commit, a Docker image, or a PyPI package for leaked secrets.
- Block secrets *before they are written* via the agent hook installed in Step 1; or via git hooks (`ggshield install --mode local`) and ad-hoc scans of staged changes (`scan pre-commit`).
- Manage false positives via inline `# ggignore` comments or `.gitguardian.yaml` rules.

Keep the brief tight; the detailed setup reference is for the agent to consult, not for the user to read.

## Scan commands

These GitGuardian commands require the explicit provider/payload authorization described above. They are not offline commands. Pass `--json`; pair recursive `-r` with `-y` to avoid an interactive hang.

```bash
ggshield secret scan repo . --json                       # full git history
ggshield secret scan path -r -y . --json                 # current files, no git required
ggshield secret scan path <file> --json                  # single file (no -r needed)
ggshield secret scan pre-commit --json                   # staged changes
ggshield secret scan commit-range HEAD~5..HEAD --json    # commit range
ggshield secret scan commit <sha> --json                 # specific commit
ggshield secret scan docker <image> --json               # Docker image
ggshield secret scan pypi <package> --json               # PyPI package
```

Key flags:

| Flag | Effect |
|---|---|
| `--json` | Structured JSON output — always use in automated contexts |
| `-y` / `--yes` | Auto-confirm interactive prompts. **Required whenever `-r` is used in agent contexts** |
| `--exit-zero` | Always exit 0, report findings without blocking CI |
| `--ignore-known-secrets` | Skip secrets already tracked in the GitGuardian dashboard |
| `--minimum-severity <level>` | Only report findings at or above the given severity (`info`, `low`, `medium`, `high`, `critical`) |
| `--output <file>` | Write results to a file instead of stdout |

Exit codes: `0` = no secrets found, `1` = secrets detected, `128` = unexpected error.

Do not use ignore/suppression or exit-zero flags to weaken a required gate.
Suppress a finding only after it is verified as a false positive under the
repository's existing policy; keep the evidence and scan limits explicit.

## When findings are present — quick reference

Full doctrine in [`references/remediation-doctrine.md`](references/remediation-doctrine.md) — load it before composing any user-facing remediation message. Dispatch by which command produced the finding:

| Detection context | Doctrine entry point |
|---|---|
| Agent file-edit hook fired (in-buffer / just-saved file) | [§ 5.1](references/remediation-doctrine.md#51-agent-file-edit-hook-fired) |
| Pre-commit hook fired (staged change blocked) | [§ 5.2](references/remediation-doctrine.md#52-pre-commit-hook-fired) |
| Pre-push hook fired (unpushed commits blocked) | [§ 5.3](references/remediation-doctrine.md#53-pre-push-hook-fired) |
| Repo / commit / Docker image / PyPI package scan finding | Triage in [§ 6](references/remediation-doctrine.md#6-post-leak--public-facing-track) (public) or [§ 7](references/remediation-doctrine.md#7-post-leak--internal-private-track) (internal-private) per where the artifact lives |

**Custom remediation message takes the lead.** If the workspace has a configured remediation workflow, ggshield (≥ 1.30.0) prints the workspace's own message in its hook output. Surface that message verbatim as the primary guidance and fill in the doctrine mechanics around it — do not override it with generic advice. See [§ 13](references/remediation-doctrine.md#13-custom-remediation-workflows-the-organizational-overlay).

The three triggers most often missed:

- **Pushed to a remote → rotate.** History rewriting is generally discouraged once secrets are pushed; rotation is the actual remediation. Do not lead with `git filter-repo` / BFG.
- **Validity is `unknown` / `cannot_check` / `no_checker` / `failed_to_check` → propose HMSL** as the natural follow-up to check public leakage. Prepare the command (`ggshield hmsl quota`, then `ggshield hmsl check ... -n none --json`); **the user runs it**. Never invoke `ggshield hmsl *` yourself, never read the credential file.
- **Local, never pushed → remove, don't rotate.** Rewriting unpushed history is cheap and worth doing here.

## Best Practices

- Scan proactively when writing or modifying code that handles credentials or configuration — do not wait to be asked.
- When a credential is found: always remove it from the code. Rotation is only necessary if the secret has been exposed on a remote — pushed to a shared repository, CI system, or any external service. A secret that is purely local and has never left the machine does not need rotation, only removal.
- Do not commit or present code that contains a detected secret. Stop the workflow, report the finding (file, line, secret type, validity), then fix and re-scan.
- For false positives, add `# ggignore` on the offending line, or run `ggshield secret ignore --last-found` to record it in `.gitguardian.yaml`.

## Troubleshooting

**`ggshield: command not found`** — use an available offline scanner, or report the full scan unavailable. Do not install hooks, authenticate or upload code merely to satisfy this skill.

**`401 Unauthorized`** — for authorized GitGuardian setup, check only whether the required variable is populated; verify token scope through approved account metadata, never its value. Network authentication checks remain scoped operations.

```bash
# skill-safety-presence: GITGUARDIAN_API_KEY
if [ -n "${GITGUARDIAN_API_KEY:-}" ]; then printf '%s\n' 'GITGUARDIAN_API_KEY=SET'; else printf '%s\n' 'GITGUARDIAN_API_KEY=UNSET'; fi
```

**`403 Forbidden` / "Insufficient permissions"** — inspect the denied operation and existing authorization. Consult [references/gitguardian-platform.md](references/gitguardian-platform.md) for the applicable scoped recovery. Do not log out, broaden token scopes or change clients to evade a denial.

**`Not a git repository`** — `ggshield secret scan repo` requires a git context. Use `ggshield secret scan path -r -y .` instead.

**Recursive scan hangs** — an already authorized scan may need `-y` with `-r`. This flag fixes an interactive prompt; it never overrides an approval rejection or payload boundary.

**OAuth browser window does not open** — the environment is headless. Lead with `ggshield auth login --method oob` (ggshield 1.51.0+): it prints a URL the user opens on any device, signs in, and pastes the code back — no manually-created token. Fall back to `--method token` only if `oob` is unsupported (older ggshield, or an instance that doesn't offer it). See **Headless and CI** in [references/ggshield-cli-setup.md](references/ggshield-cli-setup.md).

**Rate limiting** — free tier quota exceeded. Direct the user to check usage at https://dashboard.gitguardian.com.

**Any other or unlisted error** — before improvising a fix, consult GitGuardian's AI-agent docs index at https://docs.gitguardian.com/llms.txt to locate the relevant page, then append `.md` to that page's URL to read it as Markdown. Search there first rather than guessing.
