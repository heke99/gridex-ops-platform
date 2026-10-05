# SC-071 native revocation evidence

PR574's projection/revocation component merged at
`7b9218da2c7f71f4373bcc9189715c0043a8cb31`. Exact c08a2354 passed
all nine required checks and **3 native cases, zero failures/errors/skips**
in run37295735640. Artifact11338083870, ZIP digest, all16 recorded inputs,
JUnit and canonical replay were independently qualified. The local stack
and first CI credential-refusal failures remain recorded. Actual raw redacted
evidence: native-executed.log, native-executed-junit.xml and
native-executed-source-receipt.json. Final merge-tree/coverage verification is
in verification-receipt.json and merge-main-tagged-coverage.log.

**Whole SC071 and SC010 remain unapproved.** The three component cases do not
establish the frozen SC071 requirement to run actual export and rights change
in parallel. The sole SC010 producer stays with
[PR570](https://github.com/heke99/gridex-ops-platform/pull/570), immutable
source824e5f53c9a115e3f423d3e2e5ba13b41001bdb9; handoff5992694706 accepted5992836327.
No second exporter, lease worker, native fixture, lock helper or redactor exists.

The follow-up `export-races.patch` provides three independently reviewed actual
export/revoke cases in addition to the original three. Registered source6407877
remains unchanged; the effective six-case source is33b7d52a, explicitly
applied only to the disposable runtime checkout. Types/lint and bounded static
review passed; **the new native cases are NOT_RUN**. Original flat temporary
layout type failure remains documented. Source-owner four sequential/expiry
cases remain separately owned and byte-identical.

The owner's bounded native-feedback proposal5993124044 is accepted5993523187.
The same sole `.github/workflows/ediel-sc071-native.yml` now:

1. Completes the unchanged canonical replay on explicitly pinned main BASE7b9218da,
   with source tree/hash, fingerprint and48-entry ledger evidence attributed
   only to BASE. BASE remains the CLI CWD through the original EXIT cleanup.
2. Verifies six immutable824 producer inputs, the owned patch/config and sole
   migrationd0e4ec. That migration is applied from RUNNER_TEMP directly to the
   same disposable database after BASE replay; it is never added to replay
   migrations or the official ledger.
3. Reloads real PostgREST schema and witnesses all four actual RPCs, then invokes
   exactly six SC071 and four SC010 cases using existing native owners. Discovery,
   unique file/name, zero errors/failures/skips, effective-input hashes and
   unchanged official ledger are all required for a qualified result.
4. Preserves both success and failure evidence through the existing canonical
   redactor, CLI SECRET_KEY format input and unchanged leftover-token refusal.

Exact inputs: export-feedback-inputs.json. Actionlint, shell/Python syntax,
selected types/lint and seven finite qualifier controls PASS; these controls
are not database/native evidence. Independent caller review precedes execution.
The earlier export-native-invoker.patch is a superseded direct-admission proposal
and is not applied by this workflow.

Experimental post-forward schema is **UNQUALIFIED_FOR_FINAL_CAPTURE**. This
workflow does not establish producer candidate clean/upgrade parity, canonical
admission, generated schema/types or whole-card approval. Retained coordinator
#503 owns those shared final gates; its missing-manifest failure remains visible.
Ordinary candidate checks are mandatory. Finite issuer/legal, SMTP and route
session-selection ports do not establish authentic market qualification.
