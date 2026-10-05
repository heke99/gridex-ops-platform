# PR367 — observed RED and bounded review resolutions

Status: TEST_FIRST, no production implementation yet. Baseline0ad1b83ae25e80e240da8df0f481286c46a27364; acceptedmain7409e28c. Resolve actual childhead for new test execution.

## Actual ordinary RED, independently read

OPS35623709051 replay106412748475 completed the existing reconstruction and tenant tests, then executed all62 new storage assertions. Real database results:35PASS/27FAIL with PRODAT_SOURCE_BEHAVIOR_FAILURE (not fixture setup). Original-source hash, supplied hash, mutations and retained bytes fail. Artifact10650755735 downloaded:106874bytes,ZIP SHA2565dc566e370beb858ab6d8a5efdbce0d51c1e42afc98ec56ded2b04552b9cd07a matchesmetadata. Its log SHA256142cb91534c04fa1e2b6b211f477fa7562632597727620b6db8d996d18f4ff97 was parsed for all62rows. This is RED evidence only.

Samehead quality106412748639:5218total/5209PASS9FAIL,326files325PASS1FAIL. All5203pre-existing testsPASS. Of the9failures, FOUR are actual writer/safe-updater conflict/environment failures. FIVE processor cases fail earlier because the new external DB mock omitted .single at createParseResult; those are setup errors, not behavioralRED. This test-only child adds the missing real API mock operation, without changing production or weakening assertions. Original15cases retained. New4controls strengthen originalcause and exact-message/legacy fallback boundaries: current declaration inventory19cases. Fresh execution remains required.

## Review5763651427 resolutions

Original cause code/message is now explicitly asserted in the existing conflict case, with another details/hint control. Translation must compare the original error's code and message exactly, not concatenated details/hint nor substring matching.

Root chooses the review's bounded legacy-compatibility option: this delivery does not change existing company-scoped interchange fallback identity, nor make environment immutable. Same-company cross-environment identical-byte reuse stays legacy behavior and now has two explicit controls. Current trusted mailbox environment is forwarded without inventing a default. A later expected-structure loader must independently enforce environment/actor/object/time scope; this fallback and sealed bytes are NOT sufficient authority. No new same-company cross-environment permission is created by this delta, and no cross-company lookup is introduced. A broader identity change is not silently bundled into the source-seal repair.

Request independent SOURCE/DESIGN/ORACLE resolution of these finite choices, inspect fresh test execution, then implement the approved forward-trigger/body change and exact source-conflict propagation only. The62SQL tests and allold expectations remain unchanged. No E61/E62, receivedstructureauthority, universalwritertransaction, F3/masterplan or live-readiness acceptance. PR310paused e9611351 untouched.
