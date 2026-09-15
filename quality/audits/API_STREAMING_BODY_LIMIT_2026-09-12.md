# Task 3 — bounded streaming JSON request bodies

Date: 2026-09-12
Baseline: `4178602790cc732bf57886cb391dd84c2464e120`
Status: implemented; dependency-free runtime checks pass; hosted Vitest pending

## Scope and skill routing

Activated `executing-plans` for the supplied Task 3 brief,
`systematic-debugging` for the confirmed full-body-read defect,
`test-driven-development` for the bounded-stream regression,
`spec-to-code-compliance` for the explicit byte/JSON/error contracts, and
`verification-before-completion` for fresh evidence. The task was already in an
isolated recovery worktree. The parent explicitly prohibited child agents, so no
subagent workflow was used. Database/Supabase, migrations, replay, notifications,
UI, performance optimization, deployment, reusable skills and production actions
were outside this bounded task.

## Confirmed defect and root cause

Both JSON readers checked `Content-Length`, then called `request.text()`, then
checked the byte length. A request without a truthful oversized
`Content-Length` was therefore fully buffered before rejection. The baseline
reproduction supplied 100 chunks of 1,024 bytes with a 2,048-byte cap. Actual
`readJsonWithLimit` returned `payload_too_large` only after 101 pulls and never
canceled the stream.

Root cause: the enforcement point followed the unbounded buffering operation.

## Implementation

- Added `lib/http/boundedRequestBody.ts`, a dependency-free shared reader.
- Rejects negative, fractional, non-finite and unsafe-integer limits before
  reading; zero remains a valid exact cap.
- Rejects oversized declared lengths before reading and initiates body
  cancellation.
- Counts actual `Uint8Array.byteLength` per received chunk. When the next chunk
  crosses the cap it initiates reader cancellation and returns immediately,
  without reading or retaining the remainder and without waiting for cancel to
  finish.
- Uses streaming `TextDecoder` calls so split multibyte UTF-8 sequences are
  preserved. Retained decoded content is bounded by the accepted byte cap.
- Lets stream failures propagate from the shared reader.
- Rewired both wrappers without `request.text()` or a second full-body byte
  count.
- Preserved wrapper contracts: `readJsonWithLimit` maps read/parse failures to
  `invalid_json` and an empty body to `{}`; `readJsonObject` preserves raw read
  failures, rejects empty bodies, and requires a non-array object.
- Preserved the distinct defaults: 262,144 bytes for `readJsonWithLimit` and
  256,000 bytes for `readJsonObject`.

Focused Vitest coverage is in `__tests__/request-payload-limit.test.ts`: real
Request streams cover unknown and lying lengths, declared precheck, exact-cap
UTF-8 split across byte chunks, cancellation without draining, stream failure,
invalid limits, empty/whitespace and invalid JSON semantics, array/object
constraints, and distinct default caps.

## RED / GREEN evidence

### RED — baseline implementation

Command: dependency-free Node 24 inline assertion importing the actual baseline
`lib/http/payloadLimit.ts`, with a real Request stream of 100 × 1,024-byte chunks
and a 2,048-byte cap.

Observed: exit 1. `readJsonWithLimit` returned the expected
`payload_too_large`, but the bounded-read assertion failed:

```text
AssertionError [ERR_ASSERTION]: expected bounded reads, got 101
```

The cancellation assertion was not reached; baseline cancellation count was
zero as established in the task brief.

### GREEN — actual shared helper

Command: dependency-free Node 24 inline assertions importing the actual
`lib/http/boundedRequestBody.ts` with `--experimental-strip-types`.

Observed: exit 0:

```text
PASS bounded request helper: oversize cancellation, declared/actual lengths, exact UTF-8 cap, read errors, invalid limits
```

Both unknown-length and falsely declared two-byte streams stopped at exactly
three pulls for a two-chunk cap and recorded one cancellation. Declared
oversize performed zero pulls and one cancellation. Exact-cap split UTF-8,
original error identity and invalid-limit rejection also passed.

### GREEN — actual wrapper contracts

Command: dependency-free Node 24 inline assertions dynamically importing the
actual `payloadLimit.ts` and `strictRequest.ts`. Node module hooks resolved the
extensionless shared helper and replaced only unavailable Supabase/idempotency
imports; neither stub was invoked by the readers.

Observed: exit 0:

```text
PASS actual JSON wrappers: contracts, errors, strict object constraint, distinct defaults, invalid limits
```

### Static checks

`node --experimental-strip-types --check` passed for the shared helper, both
modified wrappers and the focused test file. `git diff --check` passed for the
modified tracked wrapper files; direct whitespace inspection covered the new
helper and test file.

## Checks not run

Vitest, repository typecheck and broader suites were not run locally. The prior
`npm ci` failed with `ENOSPC` and the incomplete `node_modules` was removed;
this task did not reinstall dependencies. The new focused Vitest file therefore
requires the hosted quality lane. Node 24 is an available proof runtime, while
the repository declares Node `>=22 <23`; these dependency-free checks are not a
substitute for the supported hosted lane.

No database, migration, external service, notification, replay, workflow,
memory, commit, push or production action was performed.

## Independent review and root verification
Spec and quality APPROVED with no confirmed findings. Independent helper/wrapper tests include nonsettling cancellation. Root actualhelper real Request probe PASS:3pulls/cancel on100chunkstream with2048bytecap. SupportedNode22/Vitest remains pending hosted CI. This bounds the two JSONreaders; existing upstream canonicalpartner rewriting still buffersJSON beforethem, and webhookrawbody paths needseparate review. No wholepoint84closure.
