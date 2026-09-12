# Task 8 — temporary hosted migration scaffold receipts

Date: 2026-09-12. Status: implementation ready for independent review and hosted execution. This task adds only a temporary GitHub Actions receipt job. It does not author SQL, create migrations in the checkout, connect to a database, apply migrations, change generated types, update project memory, or publish anything.

## Skill routing and source authority

The repository `supabase`, `executing-plans`, and `verification-before-completion` instructions apply. The Supabase skill requires CLI command discovery through `--help` and forbids invented migration filenames. Official current Supabase CLI documentation was checked and states that `supabase migration new <name>` creates `supabase/migrations/<timestamp>_<name>.sql` in the current work directory, creating that directory when absent. The hosted step still runs all three required help commands against the pinned executable before generation, so the actual CLI remains the syntax authority.

The written Task 8 plan and brief are precise and bounded, so no architecture brainstorming or application TDD applies. No SQL, database, production, authentication, RLS, storage-policy, UI, performance, dependency, scanner, deployment, commit, push, or memory workflow was activated. The task brief explicitly forbids spawning agents; root owns the required independent review, publication, hosted execution, receipt retrieval, and removal of this temporary job.

## Implemented workflow job

`.github/workflows/ops-hardening.yml` now contains `migration-scaffold-receipts` with these controls:

- It is restricted to `pull_request` runs whose `github.head_ref` is `codex/gridex-parity-remediation-20260905`; push runs and unrelated PR heads skip it.
- Job permissions are explicitly limited to `contents: read`.
- `supabase/setup-cli@v1` is reused with the existing pinned version `2.101.0`.
- There is no checkout, service, secret, token, database URL, PostgreSQL client, Supabase link, database command, dependency install, or production connection.
- The step creates one owned directory beneath `RUNNER_TEMP`, enters it, and installs an exact `EXIT` cleanup trap for only that directory. Therefore CLI output cannot enter the repository checkout or its `supabase/migrations` directory.
- It runs `supabase --help`, `supabase migration --help`, and `supabase migration new --help`, then validates `supabase --version` is exactly `2.101.0`.
- It calls `supabase migration new` exactly once for each required name: `canonical_permission_overrides_and_storage_write_guards`, `billing_underlay_evidence_guards`, and `invoice_provider_event_atomic_apply`.
- Before the second and third commands it waits, with a bounded ten-second ceiling, until the UTC clock differs from the preceding actual CLI-generated 14-digit prefix. It never constructs or renames a migration file. It rejects malformed basenames, duplicate prefixes, nonempty scaffold content, multiple matches, or a final file count other than three.
- It emits one finite `GRIDEX_MIGRATION_SCAFFOLD_RECEIPT=<json>` log line. The JSON contains receipt version, observed CLI version, and each actual CLI-generated basename, exact empty content, and computed SHA-256. No artifact is required because the complete empty-file receipt is in the job log.

The generated scaffolds are deliberately not copied into the checkout. Root must retrieve the exact logged basenames only after the hosted job succeeds, then remove this temporary job before forward SQL is authored or published.

## Fresh local construction verification

The following checks ran from the repository root after the edit:

| Check | Outcome | Boundary |
|---|---|---|
| Python source-contract scan of the exact job slice | PASS | Confirmed branch condition, read-only permissions, pinned CLI, all help calls and names, owned cleanup, JSON marker, no checkout/artifact/database/secrets surface |
| PyYAML 6.0.3 parse plus exact job-shape assertions | PASS | Workflow YAML construction only; GitHub has not evaluated the workflow |
| `bash -n` on the exact parsed `run:` block | PASS | Bash syntax only |
| Exact parsed `run:` block with a temporary fake `supabase` executable | PASS | Exercised loop/control flow, UTC tick waits, three distinct generated prefixes, basename ordering, single finite JSON receipt, empty content, SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, and EXIT removal of the owned workspace |
| `git diff --check -- .github/workflows/ops-hardening.yml` | PASS | Whitespace/patch integrity only |

The fake CLI harness generated its own timestamped empty files in `/dev/shm` only to exercise the exact shell block, then verified the inner owned workspace no longer existed. Those fake filenames are not receipts and must never be used as migration names.

## Verification boundary and next action

The Supabase CLI is absent locally and the filesystem is full, as recorded in the task brief. No local command invoked Supabase CLI 2.101.0, and this report does not claim CLI-native scaffold generation. No GitHub Actions run, artifact retrieval, SQL validation, migration replay, database connection, production mutation, commit, or push occurred in this task.

Root's next action is to independently review the exact workflow diff, publish it to the specified PR head, verify the hosted job/run/head identity, parse the single JSON receipt, retain the three exact CLI-generated basenames/content hashes, and remove the temporary job before any separately reviewed forward SQL work.

Independent Task8 spec and quality review: APPROVED, no findings. Actual CLI generation remains pending the hosted job on the exact published head.
