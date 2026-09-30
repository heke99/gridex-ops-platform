# Clean replay startup evidence hygiene — local correction

## Confirmed defect

Actual OPS run `36775178898`, clean job `110091164302`, printed one
publishable and one secret local Supabase key during startup. The workflow
tees that shell output into its uploaded clean-replay log. Credential values
were counted and redacted during the read-only review; none were saved here.
Actual tested checkout was `60b2c0cef3d315df3205c973a681bea2651b2c75`,
with the same tree `cd0c6f0459ad9ad9478a5f8e8fe735c359a4b407` as API
head `026f6bab3b261866aecd1015842dd0f3abb4a7b4`.

## Correction

`scripts/gridex-aud-003-clean-replay.sh` captures startup stdout/stderr in a
mode-600 mktemp file under RUNNER_TEMP (private temporary-directory fallback
for existing local usage). It emits only a generic startup result. The original
CLI failure exit status is retained. The same existing EXIT cleanup owns the
stack, restored migration/seed inputs, image pin and new private log. Raw
startup diagnostics remain private while replay runs and are removed at EXIT.
No workflow, database migration, hosted database or runtime contract was edited
by this bounded correction.

## Executed verification

The new `__tests__/clean-replay-startup-redaction.test.ts` executes the actual
extracted production Bash startup block and EXIT cleanup. Only external
Supabase CLI startup is replaced with a stub emitting synthetic local keys.
The success and exit-37 cases verify hidden keys/path, private capture, file
mode 600, log deletion, stack stop and preserved migration/seed inputs.

- RED: both cases failed on leaked startup output against the original script.
- GREEN: both cases passed after correction with project Node 22.
- `bash -n scripts/gridex-aud-003-clean-replay.sh`: passed.
- scoped `git diff --check`: passed.

Exact targeted test command:

```text
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/clean-replay-startup-redaction.test.ts
```

Skills used: systematic-debugging, test-driven-development (including its
writing-good-tests guidance) and verification-before-completion. Publication
and all broader verification remain root-owned. This local Bash proof does
not claim actual native startup, migration replay, SQL, HTTP or browser success.
