# PR369 — insertion context and stable cutoff implementation

Status: IMPLEMENTED_NOT_VERIFIED_ON_FINAL_PR. Parent c6e624e23b7894568b0435919d3abc3cd9659c3c; fetch the actual child before final CI/review. Accepted main remains a0e7ebdd8f08b62e70246684f8baf6e7cb0234f9 / PR368, receipt5766791083, corrected baseline5300/330 and78 PR368 cases.

## Scope and source/oracle decisions

Retain e035-received-context-plan-20260921.md, reviews5767675347/5767711631, corrected-test source/design resolution5768354034 and final outcome-oracle resolution5768382713. This is row-lifetime insertion evidence and retry cutoff integrity, NOT a durable deleted-source ledger, accepted source/tenant disposition, complete object discovery, timeline/completeness/supersession, expected structure or E61/E62.

One real CLI-created forward migration replaces only the existing gridex_validate_ediel_message_contract body. A ShareRowExclusiveLock and reserved-namespace collision preflight precede replacement. Database-generated receivedProdatContext contains nine supported fields for qualifying new inbound EDIFACT PRODAT rows. Caller reserved content is removed; null source/time never receives invented provenance. UPDATE cannot introduce/change/remove context, alter protected source identity/type/bytes/hash or change receipt instant. Existing operational company/environment/link/status and unrelated snapshot keys remain editable; original context does not follow that reassignment. Old hash-guard precedence and existing contracts remain.

The actual PRODAT writer omits message_received_at on existing-row updates, keeping inserts and other families unchanged. Exact new storage errors use the established controlled conflict with original cause. The actual linked-source reader selects only the reserved JSON leaf, verifies all returned contexts before emitting any source data, and preserves microsecond-safe receipt equality/capture cutoff. Legacy absence retains diagnostic candidates with receiptContext=unavailable; present malformed or conflicting context returns generic read_failed with no IDs/data. Valid recorded context is still acceptance=not_checked, authorityStatus=not_established, selection=not_performed. No national decision or persistence arguments change.

## Genuine test-first evidence and corrections

Actual c6 ordinary OPS35662646146/job106541203028:5353 total,5307PASS/46FAIL,333 files330PASS/3FAIL. Writer15=6PASS9FAIL; reader32=1PASS31FAIL; complete outcomes6=6FAIL. All5300 prior tests pass. The earlier5316/37 transcription in5768458420 is withdrawn by direct-log correction5768542611. Correct final oracle review is5768382713, not the nonexistent copied5768548254 reference.

Actual c6 replay artifact10667871458 has107678bytes, SHA25681835feb2df1baa64d9f69984fbe6469b7ff65a478fb14f11ddeef05a76d9f9f; logd0035510c5b6d3002051b71113bbc538b850ae918038b130bc5fcf4453fab194. All62 prior SQL pass; all84 new SQL execute,14PASS70FAIL. Earlier83 inventory is historical, before the additive null-source spoof control. No old assertion was weakened.

## Native generation and upgrade verification

Unmerged preparation6400ccc253408e83357c54c63d52c926d3e6308b, run35664024836/job106545606850 completed SUCCESS. Supabase CLI2.101.0 created20260921224255_ediel_inbound_prodat_receive_context.sql. Node22.23.2 and PostgreSQL17.11 client. The preparation changed only allowlisted delivery files and uploaded immutable Git blobs; no ref update or deployment. Temporary workflow, generator and template inputs are NOT included in this delivery.

Root downloaded artifact10668686301:3136127bytes,20entries, ZIP SHA256e6ea0ad916576eb5ea55c827951e873226d8d44bc4e53ced9f15ef0ffe4e3a3e matches metadata. Root independently checked every delivery blob/digest, actual62+84 distinct SQL rows, all3 upgrade probes, and53/53 targeted TS cases (15+32+6). Full ordinary final-head CI is still required; targeted generation results are not that certificate.

The upgrade harness executes the ACTUAL migration SQL in rollback-only localhost transactions, restoring the exact PR367 function inside the transaction to create historic object/null collisions. It verifies exact23514 rejection, committed-function restoration, the actual granted ShareRowExclusiveLock and a second connection's RowExclusiveLock timeout55P03. All probes roll back. The first preparation had already passed84+62 but failed locating SQL because replay temporarily installs ledger-marker files. The corrected harness reads HEAD migration bytes and verifies manifest checksums; only the exact scratch branch can supply its not-yet-committed generated file. No trigger disabling or historical-file edit, and no production SQL/TS change was needed for this harness correction.

Both genuine type generations equal committed bytes. Both schema generations match, and the full schema delta is exactly the intended function body; all object counts, grants, RLS, triggers and non-function fingerprint sections remain unchanged. Detailed hashes are in e035-received-context-native-receipt-20260922.json. Local tools inspected downloaded bytes and compiled the Python harness only; no local repository-wide test run is claimed.

## Final gate and continuation

Next: unchanged exact-head ordinary CI, independent completed TASK/SPEC, QUALITY, TENANT-BOUNDARY, WHOLE-PR review, expected-head guarded merge, fresh actual-main73/OPS and inspected artifact/row/JUnit/commit evidence. Save final acceptance on this PR; no receipt-only PR loop. Original source/test plans remain history; this audit supersedes their pending/count labels, not their normative boundaries.

Relevant skills retained: bounded plan execution, TDD, systematic debugging, spec-to-code/differential review, PostgreSQL migration hygiene, requesting/receiving independent review and verification-before-completion. No UI/framework/dependency/security-policy or unrelated broad audit changes. D110/110+parents10/10 retained. FullE035/F3/masterplan incomplete; durable receipts/object discovery/disposition and temporal authority remain before E61/E62. PR310 stays paused e961135199f292b8210884f07de3b616a670161a, untouched. No direct live DB/provider/market/settings or explicit deployment actions.
