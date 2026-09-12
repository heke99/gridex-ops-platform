# Paused partner-price candidate

Saved at the user's request on 2026-09-12. This is work in progress, NOT an applied application change or a completed API release.

Base: `52b2de4d81cae370bf250e5a80f12c300bbddd16`, tree `76e633e2c7189807ae8b7de297a6d2e6e2343234`.

`2026-09-12-partner-price-wip.patch` preserves exactly three existing source/contract file changes and the new 63-case test file. No migration, secret, customer data or unrelated local edits is included. `2026-09-12-partner-price-wip.json` pins the patch and resulting file SHA256 values.

The candidate adds a required idempotency key, claim/replay/completion handling, fail-closed handling for uncertain quote outcomes, and strict input validation. The new required header is a compatibility change: contract/version release, dependent clients, native store/concurrency/recovery behavior and independent review remain unverified. Do not call this API complete.

Local verification before preservation: 213 test files / 2,143 tests passed, including the 63 candidate tests. Tests use fake persistence/provider boundaries; they do not prove native database acceptance or production behavior.

## Restore deliberately when API work resumes

Use a separate worktree based on the recorded commit or inspect intervening changes first. Never apply blindly to a moved branch.

```bash
git apply --check quality/paused/2026-09-12-partner-price-wip.patch
git apply quality/paused/2026-09-12-partner-price-wip.patch
npm test -- --maxWorkers=2
npm run typecheck:tests
```

Verify the resulting file hashes against the JSON receipt, then finish contract/recovery/native review before release. No workflow automatically applies this patch.
