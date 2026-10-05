# Current-main PR #225 facility-alias repair — 2026-10-05

Status: independently reviewed GO; local verification complete; root publication
and fresh published-head CI pending.

## Ownership and baseline

- Root owns publication, remote comments and merges. Scoped authorization:
  #225 comment `5999489634`; no edits to historical #225.
- Worktree: `/workspace/gridex-main-baseline-pr225-repair-20261005`.
- Branch: `codex/main-baseline-pr225-repair-20261005`.
- Fresh main/base: `25c0a12f78e650d456a62c789be8f814b595783e`.
- Historical #225 head: `0da02472501602e9b266506d301129a06153218d`.
- Exclusive production scope: `lib/website/applicationReview.ts`,
  `lib/website/customerApplicationCore.ts`,
  `lib/website/customerApplicationOnboarding.ts`.
- New regression: `__tests__/main-baseline-pr225-facility-aliases.test.ts`.
- This checkpoint is the only memory write. No shared memory, SQL, migration,
  register, capture, coverage, package, dependency, host or remote mutation.

Read current AGENTS and required memory before implementation, checked actual
website intake caller, schema, business-key identity, resolver, canonical
onboarding adapter and readback. Live source and executed evidence supersede
stale historical shared-memory claims. Installed Next route guide was read;
no Next API change is involved.

## Coordination and skill routing

Fresh #225 was OPEN/DRAFT with no prior comments. The 52-open-PR file inventory
contained these three paths only in #225. Seven large PRs (#600, #578, #503,
#482, #422, #418, paused #310) had truncated 100-file lists; full REST pagination
confirmed none overlaps these paths. Root recorded the scoped replacement claim.

Relevant skills: prior systematic-debugging, TDD, fp-check, code-review,
differential-review, verification-before-completion and isolated-worktree
workflow, applied to a bounded remediation rather than a new whole-system audit.
Supabase skill was read for the external RPC boundary; changelog and current RPC
documentation inspected. No client API, auth/RLS or database schema change;
minor PostgreSQL/index upgrades are outside this normalization scope.
Independent review will activate receiving-code-review if feedback arrives.
No new delegation, UI, performance, dependency, hook, capture, SQL or architecture
work is required. Root coordinates all other active agents.

## Confirmed findings and minimal remediation

P2: valid accepted facility aliases under `metering_point` were already used by
`applicationBusinessKeyHash`, but readiness and onboarding could lose that same
identity. Actual behavior on pristine main:

- Readiness missed nested `site_facility_id`, `siteFacilityId`, `anlage_id` and
  `anlaggningId`; a facility-plus-meter input became `needs_address_resolution`.
- The normalizer left `site` undefined for meter-only facility input, even though
  accepted nested fields supplied the identity. The historical #225 patch also
  omitted this site-existence condition; importing it alone would be incomplete.
- The actual resolver saved `input_snapshot.facilityId: null` for nested-only
  canonical facility aliases.
- The real website onboarding builder/canonical RPC adapter omitted a site's
  facility ID and passed whitespace/lowercase metering IDs through unchanged.
- The accepted top-level `siteFacilityId` readiness alias was also missed.

The fix adds matching facility paths, creates a facility-only site when a real
nested facility alias is present, forwards canonical nested aliases to resolver,
and uses existing facility/meter normalizers at the onboarding command boundary.
Explicit site facility precedence remains intact. Billing address is not promoted
into an installation address; no source of verification or send authority is
manufactured. Existing `anlage_id` dual legacy fallback remains supported.

## Test-first evidence and exact limitations

Initial setup/fixture probes failed due to a missing `server-only` marker,
required settlement fields and canonical offer reference. Those were corrected
before qualifying any product finding; they are not claimed as behavioral RED.
`server-only` is an inert runtime marker in this test; business helpers are real.

First qualified RED ran the actual unchanged source: 18 failed / 10 passed in
28 cases. A separate pristine detached worktree at the same base reran the final
29-case suite: 19 failed / 10 passed, with only intended behavior assertions
failing, including the accepted top-level camel alias. The canonical positive
onboarding flow, tenant denial, RPC denial and existing guards passed before
the repair.

The final new suite executes the real raw normalizer, raw field validator,
schema, business-key hash, readiness, energy resolver, canonical event writer,
website onboarding builder and canonical RPC adapter. Only the external Data
API/RPC transport is replaced with a finite local port. Commands and readbacks
assert company filters, normalized identities and unchanged pending/incomplete
meter verification. Resolver tests assert actual saved input snapshots and no
automation grant. Controls cover missing meter, unverified owner, POA/terms,
specific-date requirement, protected identity, canonical precedence, billing-only
input, foreign-customer binding, RPC permission failure and canonical success.

This does not prove native PostgreSQL transactions/RLS, hosted persistence,
verified live geodata, quote binding, full website checkout/legal signature,
outbound supplier switch or production/customer acceptance. No approval,
coverage or traffic status is promoted.

## Verification

Existing Node 22 binary:
`/tmp/gridex-sc047-npm-cache/_npx/d18f28baf1132559/node_modules/node/node_modules/node-linux-x64/bin/node`.
Dependencies reused through an ignored symlink from
`/workspace/gridex-sc047-native-20261005/node_modules`; exact lockfile SHA256 on
both trees: `93ab57ed8646227fbfd7e45b3df908c3a6411729d0170c3fcca2c02b54f48627`.
No dependency installation occurred.

- `node node_modules/vitest/vitest.mjs run` with the new suite plus
  `canonical-onboarding`, `website-application-payload-field-contract`,
  `website-application-settlement-contract`, `website-settlement-model`,
  `energy-resolution-capabilities`, `ediel-onboarding-application-receipt`,
  `customer-onboarding-constraint-regression`, `public-payload-resolution-id`
  and `customer-merge-application-resume`: **104 tests / 10 files PASS**.
- App TypeScript (`node --max-old-space-size=4096 node_modules/typescript/bin/tsc
  --noEmit --incremental false -p tsconfig.app.json`): PASS.
- Final tests TypeScript (same command with `tsconfig.tests.json`): PASS.
- Scoped ESLint: zero errors; two pre-existing unused-variable warnings
  (`verificationDetail`, `stage`) are outside the fix.
- `git diff --check`: PASS.
- `scripts/gridex-customer-application-review-regression.cjs`: PASS.
- `scripts/gridex-canonical-onboarding-regression.cjs`: PASS with existing
  FullE2E `NODE_OPTIONS=--require=./scripts/lib/refactor-safe-static-read.cjs`.
  Direct invocation without that preload fails identically on pristine base
  and current source because it only reads the split admin actions facade.
- Optional `scripts/gridex-website-facility-intake-regression.cjs`: initial
  candidate had one source-text failure on a line break in the first assignment.
  Pristine source passed. After independent GO, root authorized preserving the
  first expression on its original declaration line; this formatting-only edit
  leaves all tested alias fallbacks unchanged. Final direct invocation: PASS
  (all six checks), without modifying the harness. The optional script is not
  invoked by current package, GitHub workflows or golden-path aggregate.
- Independent SC047 review: GO; reviewer independently reran **104 tests / 10
  files PASS** and found no confirmed in-scope regression or tenant escape.
- After the sole review-stage formatting edit: actual alias suite **29/29
  PASS**, optional facility-intake static PASS, customer-application-review
  static PASS, canonical-onboarding static with existing preload PASS, and
  `git diff --check` PASS. App/test types and scoped lint above ran on identical
  semantics; no further business logic or test change occurred after review.

Root authorized committing exactly the three production paths, new behavior
suite and this checkpoint locally; no push or remote mutation. Next action:
provide the local commit hash to root for narrow replacement publication and
fresh CI. Root closes old #225 only after qualified merge, retaining its branch.
