# PR372 bounded source-only native/schema evidence review — 2026-09-24

SPEC: Accepted for the exercised Task2a sealed-source-only capture/RBAC evidence boundary. Source-only delivery acceptance remains PROVISIONAL until the reconciled final published head has all required same-head CI green.

QUALITY: Approved for authentic generated-contract reconciliation. No material unexpected schema difference identified; no new runtime fix round requested. This does not accept full Task2, document capture/retention, process-history composition, positive C, UTILTS or full E035.

## Evidence integrity and execution

Reviewed the supplied artifact for published `6091edc7f4717aec3e17dda72c2529b247c7e91f` (OPS35942242226/native107452448227; artifact10785596678), without a whole-branch review restart or fresh tests. Independently recomputed archive SHA256 `4c7c088ef2cac2de06fcd8953f50e964dbd2dbc7a89ee9c8cdc52fbc9fcc89af`. Every ZIP member matches its extracted file byte-for-byte. Actual generated schema.sql and fingerprint JSON each match the repository copies byte-for-byte; generated types also match supabase/database.types.ts.

- schema.sql file SHA256: `32dc7f22741aec1c6951f40d4e0906b15de1ae2e0ac6319223ba7b756adb1c12`.
- schema.fingerprint.json file SHA256: `674e8d70cc96c3f0229b673687290134771e51a7d993e30743364789774c1c6d`.
- Database fingerprint inside the generated JSON and logged by the generator: `f6632eb629f156641dfa502a96543466d5df4e41bd00c00539dac7bf16c44d24`.
- Generated types logged hash: `30c9f682c20f5e1d9ff203a445e24785d1058d3997f233d75e05b3eebee756e7`.

The actual replay log records application of all four published forwards, native 224/224 across four files (correction-context 52), case-view 1/1, protected browser 2/2 and postbrowser 1/1. It then passes type matching, tenant isolation invariants and the parity selftest, including detection of all listed injected drift classes. Schema generation completes and emits the authentic files above. The terminal schema check fails against the old committed schema and fingerprint `37f50624ab029aba0a7dbdf1a79ba18ce7010142937b85d5a79916fb66e534b4`; that is the expected reconciliation mismatch, not a successful final gate. No claim of final-head CI success follows from this stopped run. Run/head/artifact association uses the supplied parent provenance; this review independently checked the local artifact content and hash, not remote CI metadata.

## Bounded schema comparison

Inspected the complete changed-object inventory and associated SQL against the four published forwards:

- `20260923231731`: two private correction concern/witness tables, their constraints, indexes, forced/enabled RLS and immutable triggers; private receipt/capture/witness/observation/exact-scope functions; private neutral Z05 decoder and the existing closure projection's delegation to it; two service-only public RPC wrappers and corresponding ACLs.
- `20260924001447`: capture owner uses canonical `communication.send`.
- `20260924003708`: inserts the two existing permission registry rows only. This data-only change appropriately contributes no schema object delta.
- `20260924003724`: only the existing resolver's direct-permission branch gains selected-company/membership/status/active/effect restrictions.

Mechanically compared the generated SQL function bodies with the effective last definition in these forwards: all ten affected bodies are byte-identical, including both changed pre-existing functions and all eight additions. The generated ACLs keep private helpers unexposed and capture/witness RPC execution service-only. No unrelated function, policy, enum, schema or relation is added or modified in the schema.sql delta. There is no fixture schema leakage.

Fingerprint counts are consistent with these objects: +22 columns, +15 constraints, +8 functions, +6 indexes, +2 relations and +4 triggers. Function/relation grant fingerprint changes accompany the new objects; policies, enums, extensions, schema grants and schemas remain unchanged. The legacy-global-grant fixture cleanup is row-scoped by its generated ID/actor/null-company/send identity, confirms the row is absent and compares the complete global-grant snapshot afterward. Native completion followed by tenant-invariant PASS supports that cleanup; it creates no schema mutation.

Prior accepted native/static reviews remain the evidence owners for the wider source-only assertions. This reconciliation neither supersedes their scope limits nor promotes future document-reference preparation into runtime implementation. Publish the exact generated files and obtain the ordinary required CI on that exact final head before delivery acceptance.

Read-only inspection except this requested scratch report. No runtime/schema/repository/memory/plan edits, commits, test execution or subdelegation.

## Final same-head native receipt addendum

SPEC: Final native source-only Task2a checkpoint ACCEPTED. QUALITY: Final native/generated-contract evidence APPROVED. This supersedes the preceding native/schema reconciliation hold, while delivery/start-next-task still requires the parent to establish success of every ordinary required final-head gate, including the separately pending quality build.

Supplied final provenance: published `8fde5f2644a87351a5dbe42d8a694d33a606ba8d`, tree prefix `f23f346b`, OPS35942941358/native107454629303, artifact10785568965. Independently recomputed final archive SHA256 `95bdfdd9e3bba4569751b787e7d6f4eab058926a4dd02c2d6c671b5a76aaf6ff`. All four ZIP members match their extracted files byte-for-byte. Final actual generated database types, schema SQL and fingerprint JSON each match the current repository copies exactly.

Final actual replay log confirms native 224/224 across four files, case-view 1/1, protected browser 2/2 and postbrowser 1/1, generated-types hash `30c9f682c20f5e1d9ff203a445e24785d1058d3997f233d75e05b3eebee756e7`, tenant isolation invariant PASS and parity selftest PASS. The log ends with successful schema snapshot verification at fingerprint `f6632eb629f156641dfa502a96543466d5df4e41bd00c00539dac7bf16c44d24`. The earlier stale-schema mismatch is now genuinely resolved on the final native receipt; it has not been relabeled retroactively.

This was receipt-only review, not a fresh implementation review or execution. Remote run/head association and ordinary-job status remain supplied parent provenance. No whole Task2/document/process/UTILTS/full-E035 claim or Task2b runtime authorization follows. No runtime, test, repository, memory or plan mutation, commit, or delegation was performed; only this report addendum was written.

Parent final gate update received after this addendum: quality107454629457 SUCCESS (reported full6038/374 and compiled build/bundle PASS), verify107454629433 SUCCESS, all other applicable workflows SUCCESS on `8fde5f26`, crawler SKIPPED. These ordinary-gate results were not independently reread in this receipt-only review. With the parent verifying those same-head results, no remaining hold is identified by this review for accepting the bounded source-only Task2a checkpoint. Report frozen.
