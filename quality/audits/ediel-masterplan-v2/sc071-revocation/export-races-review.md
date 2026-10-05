# Independent review: proposed SC-071 export/revoke races

2026-10-05. **APPROVE the bounded temporary test proposal statically. Three
new export cases: NOT_RUN. Whole SC-071: UNAPPROVED.** No blocking assertion,
fixture-owner or cleanup defect was found in this scope. This verdict does not
approve producer migration admission, native execution or a coverage change.

Reviewed worktree HEAD: `bb128549cc93272cd94d8351a9f5bbc98adf2029`.
Proposal: `/tmp/ediel-sc071-export-typecheck/ediel-sc-071-projection-revocation-native.test.ts`,
231 lines. Sole SC010 handoff: `824e5f53c9a115e3f423d3e2e5ba13b41001bdb9`
(owner board5992694706, accepted5992836327). Source-owner implementation and
its four sequential native cases were read through immutable `git show`;
their execution is not inferred. No competing producer or DB harness is added.

The frozen SC-071 literal at `docs/ediel/masterplan-v2/registers/acceptance_tests.json:1020`
requires parallel export and rights change, current-version/transaction checks
preventing unauthorized disclosure, and no reuse of an earlier authority
decision after relevant revocation. TEN-10/TEN-12 at `registers/rules.json:258`
and `:288` supply current authority and tenant boundaries, without expanding
this review into approval of those whole rules.

| Proposed assertion boundary | Static assessment |
| --- | --- |
| Helper `:126–154` | Obtains an actual accepted E66 projection with DGI/source/purpose/fields provenance, queues through the actual adapter, verifies captured beneficiary/actor/grant/version/series/scope, then claims the real job and matches its durable lease token. No job, grant version, lease, result or authority flag is seeded. |
| Writer COMMIT `:157–179` | Actual revoke RPC remains uncommitted while actual export execution is observed waiting. After commit: exact blocked response with no page, no completed job/result, grant version advances to revoked, and result read plus both stale/current-revoked queue versions refuse. |
| Writer ROLLBACK `:180–193` | Actual export completes after rollback, one result retains the earlier authorized page, actual result read succeeds, wrong-company read refuses, replay makes no second job/output, original live grant version remains active and immutable scope stays equal. |
| Export first `:200–226` | Actual execute RPC returns inside an open transaction; another transaction sees neither result nor completion. Actual revoke waits until export commit. A single private page remains, current grant is revoked, subsequent real result reads/queues refuse, and worker replay adds no output. |

The actual boundary is the producer's **private internal destination commit**.
In `20261005101500_ediel_beneficiary_export_jobs.sql:120–156` at the handoff,
execute takes the existing graph fence before job `FOR UPDATE`, checks the
real token/deadline, calls the current public projection using the stored
version/scope, and commits result/completion under those same transaction
locks. `:159–174` rechecks full current authority before returning retained
bytes; completed status is not read authority. Composite result ownership is
enforced at `:37–50`, immutable scope at `:52–63`. The snapshot matches those
exact published SQL bytes.

The existing graph SHARE fence is in
`supabase/migrations/20261001004953_ediel_current_company_permission_denies.sql:62–70`;
the actual revoke writer takes conflicting service-table SHARE ROW EXCLUSIVE
locks in `20261001043917_ediel_service_source_network_period_timing.sql:169–179`.
Current public projection and exact live-version refusal are preserved in
`20261001035402_ediel_beneficiary_receipt_read_before_write_replay.sql:18–24`
and `20261001015846_ediel_service_scope_grant_set_and_projection_entry.sql:246–251`.
Thus these proposed cases concern leased export/disclosure, rather than an
unrelated storage race. They do not prove a separate later SMTP/send boundary.

Each child uses service-role execution, ON_ERROR_STOP and the existing lock
helper. Its `:7–8` server deadlines and `:63–91` bounded release/disposal cover
assertion/readiness failures; each test disposes the transaction and drains
the once-created pending request. The export PostgREST thenable is converted
once at proposal `:152`, so cleanup does not retry execution. Child SQL output
is drained privately by the helper; no payload is printed. Fixture companies
are unique per case; issuer/legal authority inputs and SMTP remain declared
finite synthetic ports.

Original E66/series/value/receipt snapshots and provider-call/effect counts
are compared after each race. Legitimate revoke/version/history writes are
excluded from the unchanged-state snapshot, while live grant outcome is
asserted separately. Effect counts do not establish byte identity of every
ACK/outbox/history row. Page equality/provenance here establishes preservation
of the actual earlier authorized projection, not an independent specification
oracle for every reading. These are adapter/RPC concurrency cases, not new
route/auth, whole TEN-12, retention or expired/wrong-token qualifications; the
source owner's sequential/expiry tests remain separately owned.

The published 119-line test is untouched. A read-only diff of its body against
proposal lines1–121 shows only two imports, the producer-scope comment and
returning the already-existing `incoming` object; all three existing case
bodies remain unchanged. Their c08 executed qualification remains bounded to
its original bytes in `native-feedback-review.md`, including the historical
local pre-replay and f75 credential-custody failures. It does not qualify this
proposed six-case file. Sole migration/replay/schema/capture admission remains
coordinator-owned and pending. Adoption must also update the owned workflow's
currently exact-three JUnit receipt (`.github/workflows/ediel-sc071-native.yml:122,134`)
to the actual six non-skipped cases and qualify the new exact source receipt.

| Independently checked bytes | SHA-256 |
| --- | --- |
| Temporary proposal and qualified-layout copy | `33b7d52a6a5b94bc75eb77c5446f93942fbdebf64a678f3684ff3f77208a0dc4` |
| Published SC071 test | `6407877b57576c7b3dac3db2c3847935ef4941b71b5f5efd36c6e4b5f0fb1ef0` |
| Published SC010 adapter and overlay copy | `95b6bae56b2eb60e31ea32f03f4aec097af81cf19b5ab3d848b26e8d8a87820f` |
| Published SC010 SQL and supplied snapshot | `d0e4ec7285796cb4c53786dd7016d6e4ce9dc5aa9be111481481b490a62a0596` |
| Source owner's sequential native test | `1efcb1dda6673437f911f746a0409a43a513a720820e070abebed245072343f9` |
| Existing fixture / lock helper | `136758c6742f4f8896fb5bc81a14eebfaf8902458b0b46f0275af72f8de890b0` / `3e7f373e4124570ba86f06831e85dd60aa4c995221b057244a7ac505c1426621` |
| Unchanged selected native config | `dfd7ae4e5b278d0c86904cda781ae4b8c1232d2aa1033022f4bb075d11853d1b` |

Reviewer commands: bounded `sed`/`nl`/`rg` reads, `git show`, `git rev-parse`,
`sha256sum`, `git diff` of the existing test/config/fixture/helper (empty), and
a Python unified diff (read-only). Corrected-layout type/lint logs at
`/workspace/ediel-session-inventory-20261005/sc071-export-races-prototype-types-qualified-layout.log`
and `sc071-export-races-prototype-lint.log` are independently confirmed empty
(both SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`);
the parent reports the combined compiler/stdin-ESLint command exited0. It was
not rerun by this reviewer. The qualified overlay aliases only the exact new
adapter, preserves normal repository aliases, and symlinks fixture/helper
directories to unchanged repository paths. The earlier flat-layout compiler
failure from two relative imports remains a historical static setup failure,
not a native failure or a producer defect.

Skill routing: existing bounded spec-to-code-compliance delegation and code
review; actual Supabase authority/lock paths were read. No broad audit, new
implementation, shared edit, DB/native rerun, external comment or coverage
promotion. Reviewer writes only this new owned review file.
