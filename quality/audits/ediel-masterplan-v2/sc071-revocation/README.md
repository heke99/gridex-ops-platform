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
review passed; **all six owned cases PASS on449**; the complete experimental run is8PASS/2FAIL. Original flat temporary
layout type failure remains documented. Source-owner four sequential/expiry
cases remain separately owned; the new exact owner correction changes only its two lease-test setups.

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
are not database/native evidence. Independent caller and actual partial evidence reviews are recorded in export-feedback-review.md. The two source-owner lease-expiry cases failed with57014 before their preservation assertions; no expiry/full-ten-case approval is inferred. Raw firstfailure log/JUnit/receipt and qualification are export-native-first-*; artifact11343427856 is retained. The next caller uses exact owner handoff5994292830: all six overlays and identical SQL are extracted from commit9b50b1b9, with product baseline824 and corrected native SHA14611ac1 recorded separately. It adds read-only timeout diagnostics; next native execution is NOT_RUN.
The earlier export-native-invoker.patch is a superseded direct-admission proposal
and is not applied by this workflow.

Experimental post-forward schema is **UNQUALIFIED_FOR_FINAL_CAPTURE**. This
workflow does not establish producer candidate clean/upgrade parity, canonical
admission, generated schema/types or whole-card approval. Retained coordinator
#503 owns those shared final gates; its missing-manifest failure remains visible.
Ordinary candidate checks are mandatory. Finite issuer/legal, SMTP and route
session-selection ports do not establish authentic market qualification.

Corrected actual run37310521982/job111764517709 atf7fc20f7 is now
**independently qualified10 PASS /0 FAIL /0 ERROR /0 SKIP**, exact6+4.
Artifact11345294346 ZIP90787405… has16files; both lease cases reach final
atomicity assertions. export-native-passed-* retain raw corrected bytes and
export-native-pass-qualification.json records custody. Historical4498/2
remains unchanged. SC-071-export-proof.md maps the frozen criterion;
integration-handoff.json supplies exact reserved baselines, one runtime
admission entry and conflict-free source composition preview. Whole cards,
coordinator admission/capture/integrated current-head proof remain pending.
The evidence-only handoff branch creates no second PR, workflow or producer;
PR586 remains frozen at the actual testedf7fc head during required CI.
