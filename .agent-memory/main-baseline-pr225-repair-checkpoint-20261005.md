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

## Root-owned #606 SC055 clock-fixture maintenance

The actual published-head quality run `37351096495` at
`1f450e9d640ad0e5df79ac66337a175b07682032` passed 10,977 tests and failed one
SC055 exact `raw_payload` comparison across 845 files. Root's sanitized failure
differs only in the UNB minute: expected `261005:1954`, stored `261005:1953`.
Other reported quality stages passed; all eight SC068 cases passed in that run.
Root alone read its CI log. This maintenance is not a website policy repair.

Root recorded narrow allocation `6001123903` after a fresh full 438-comment
claim check found no active SC055 clock writer. The delegated change is only
`__tests__/ediel-sc-055-wrong-legal-ack-isolation.test.ts` in this #606 worktree
and this checkpoint. Original SC055 ownership remains intact; historical #225,
SQL, source admission, codec behavior and live state are unchanged. Parent root
retains current-main carry, final review, commit/publication and fresh head CI.

Before the write, HEAD was exactly `1f450e9d640ad0e5df79ac66337a175b07682032`,
the worktree was clean and the existing test SHA256 was
`e59ae2a27a6c992879996e7d42a883062761fce24d1ce2c24dd6a00f737dd746`.
Source-only triage compared eleven actual test/caller/codec/historical-SQL blobs
on that head, main `3251d20a8b9fe0294367977dca49de65aabe7513` and #609
`7b3f041afa20b598be663e8c13f5ea2261176c73`: all were byte-identical.
The relevant source lines originate at `930fd9e7be32c90f733764ad3ba4f7edaa4139ed`.
Relevant skill routing: systematic-debugging for the actual CI failure,
differential-review for immutable parity and verification-before-completion for
the bounded proof. No additional native/hosted/full-suite qualification applies
to this local fixture maintenance.

SC047 independently approved the exact proposal before the edit. The repair
adds three lines before the first await to select the existing SOURCE/COMPANY
row, refuse a missing/null/empty string and capture its primitive raw payload.
It changes only the SQL source insert parameter and strict final expected
payload to that same string. The candidate remains an independent clone and
the later receipt/Object.assign cannot change the captured scalar. Every other
assertion and all five existing cases remain intact. There is no global clock
patch, fallback payload, new mirrored test or SQL change.

Actual test SHA256 after the edit:
`e6cc89639339482ac70f62f3a86317c758fa964b8bc653a3f7bc4fa1303c655d`.
The test diff is exactly five additions/two removals: three added guard/capture
lines and two replaced expressions. A read-only inverse-hunk check reconstructs
the exact original hash, proving all other test bytes are preserved.

One bounded run with the existing Node 22 binary and exact existing dependencies:

- Existing SC055 suite: **5/5 PASS**, including the positive case's exact
  **18 original-SQL controls** and unchanged runner-byte hash assertions.
  Actual run started 19:07:47 UTC and took 12.29 seconds; process exit 0.
- App TypeScript with `--noEmit --incremental false -p tsconfig.app.json`: PASS,
  process exit 0 and no diagnostics.
- Tests TypeScript with `--noEmit --incremental false -p tsconfig.tests.json`:
  PASS, process exit 0 and no diagnostics.
- `git diff --check`: PASS. After checkpoint documentation, the only two
  working changes relative to the existing #606 HEAD are the test and this file.

Local logs are `/tmp/gridex-pr606-sc055-seeded-payload-20261005.tests.log`,
`.app-types.log` and `.test-types.log`. The test log SHA256 is
`2bec0643701dfa57165b474b6eb486fc58664489b4d6438c402ec60c410fbdf1`;
both diagnostic-free type logs have the standard empty-file SHA256.
The triage and detailed receipt remain in the completion review prefix as
`ops-pr606-sc055-current-source-triage.md` and `.json`.

No extra test/native/catalog/capture/full-suite run, provider call, dependency
install, branch carry, commit, push or remote action was performed by this
delegate. The finite historical SQL receipt does not establish current native
wrapper/admission, full business or hosted authority. Root must carry actual
current main normally and require fresh CI on the resulting immutable head.

## Root normal current-main composition, 19:16 UTC

The reviewed SC055 hunk is committed as4d81bf35d; normal merge of actual
main4b179ee45dce580142f0684e330675fe9e033d69 produced3c9dfd892abc197204affd67c27b32f1b8958298,
treea382b37a003bb149a6549a8e0a6594b7c6c8196e. All earlier commits/history remain.
The three original production blobs and website suite are exact1f450e9d;
all8,476foreignmainentries and the entire coverage blob are exact4b. Only six
owned paths differ. Admitted SC068 postimage2f326 and all main503 schema/provenance
inputs remain unchanged; no generated output or forward is authored here.

One necessary verification on that changed composition passed109cases/11suites,
including5SC055/18originalSQLcontrols. App and tests TypeScript exit0/no diagnostics;
scoped ESLint exit0 with only the same two pre-existing unused-variable warnings.
Logs are /tmp/gridex-pr606-current-main-composed-{tests,app-types,test-types,lint}-20261005.log.
The machine foreign/source guard is /tmp/gridex-pr606-composed-source-guard-20261005.json.
This footer alone changes the final documentation commit; root now publishes
normally and requires fresh exact-head ordinary CI. Earlier1f npm-test FAILURE
is retained historically and is not relabeled PASS. No full/native/capture rerun
or hosted action was dispatched by this local composition.
