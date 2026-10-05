# Task 2b independent document-reference review

Reviewed immutable range `0a52821565dd7f29e3f3b683b726add3f4457bec..07d3b9c5c1ebf5b537e20116e5daa4e801efcf64`, the supplied brief/report/diff, approved reference design and amendment review, bounded-I/O preflight and capture prerequisites. Read-only implementation review; no test execution, runtime edits, commits or delegation. The initial combined package output was truncated; the missing middle was recovered in bounded portions. Task 3/4 implementation is outside scope.

**SPEC: CHANGES REQUIRED. QUALITY: CHANGES REQUIRED for the saved-readset contract below; native qualification remains pending independently.**

## Finding DR-R1 — Saved cutoff payload omits its immutable document identity and receipt visibility evidence (P2)

Location: `supabase/migrations/20260924013820_document_reference_context.sql:178–181`; consumer `lib/ediel/sources/documentReferenceCapture.ts:51–66`.

The cutoff RPC projects an attempt ID, document ID, facts hash, graph and source scope, but omits `a.facts.document`: the actual locked company/contract/type/bucket/path/MIME/expected SHA/generation snapshot captured for that attempt. It also omits attempt/outcome transaction identities and the persisted witness visibility snapshot. The TypeScript reader labels this projection `saved` and returns it separately from fresh captures. A facts hash is not the omitted preimage; in particular unavailable/null-path attempts have no observed SHA in their outcome, so their saved payload contains neither the selected expected document SHA nor its captured row identity. Re-reading the current document or starting a new capture cannot recover the original null-path row state and must not substitute for it.

The approved design explicitly requires an earlier saved readset to preserve its original cutoff, row fields, hash and recorded verification outcome, with distinct DB append transaction and later committed-row visibility evidence. These facts do exist privately, but the sole scoped read interface does not expose enough immutable data for the later saved-readset owner to honor that contract. Direct table access is intentionally denied.

Return the bounded immutable attempt facts (or an explicit complete document-identity projection), attempt/outcome transaction identities, and witness visibility token from this reader. Preserve those fields in `saved`, without replacing them with new capture facts. Add a focused oracle checking a saved unavailable/null-path reference contains the original identity and receipt fields and stays unchanged after later row completion/new observation. This is a Task 2b interface correction; it does not require implementing Task 4 persistence now.

## Confirmed load-bearing behavior

The public action accepts only selected IDs, environment and confirmation, derives the session actor, requires all three canonical permissions and operational company status. SQL repeats current actor/membership/permission checks and derives the tenant customer/site/point/supply/contract and source party/environment graph. Foreign documents cannot produce an attempt; unresolved same-company graph produces unavailable context before Storage access.

An immutable unresolved attempt precedes the Storage read, with separate outcome and later transaction witness. The forward restricts private table access and mutation, materializes only `documents.read` with conflict-do-nothing and no assignments, and does not edit published migrations or generated artifacts. Source-scoped raw context plus the durable incomplete epoch avoid claiming complete history after initial producer interruption and avoid an epoch-wide unrelated-supply activation.

The dedicated bounded reader uses the installed streaming API, actual byte counting and incremental SHA, rejects the overflow chunk before hashing it, checks a monotonic 10-second deadline, races ignored aborts, cancels late streams, and does not retain/copy a PDF. Ordinary downloads are unchanged. Observed overshoot is explicitly an eligibility failure, not a claim that network transport never delivered the overshooting chunk. Fresh reads append fresh observations; every result remains context-only and incomplete. No positive C, correction-cause, reopening or retention authority is introduced.

## Quality and remaining qualification

The report clearly distinguishes local 64/64 unit tests, three TypeScript checks, lint and migration integrity from unexecuted native tests. I did not rerun them. Native PostgreSQL/Storage, authentic generated artifacts and final CI remain parent-owned pending gates; no native PASS is established by this review.

The authored native suite meaningfully covers real synthetic byte readback, exact limit/overflow, tenant/permission failures, attempt/outcome/witness interruption and storage loss/replacement at the three specified boundaries. Its saved-cutoff equality oracle currently checks the incomplete projection and therefore misses DR-R1.

The bounded-I/O preflight additionally requires native/runtime qualification of fetch abort for both header and body stalls. The native file has no such injected stall/abort test: those cases are present only in the mocked stream unit suite, as the report acknowledges. Running the current native suite therefore cannot alone close that particular native qualification requirement. Keep it explicitly pending and qualify it with a controlled synthetic runtime/network seam; this observation is not a claim that abort behavior failed.

No further load-bearing defect was established in this scoped static review. Dense formatting is not raised as an acceptance finding. Task 3/4 must continue to preserve unresolved/rejected/unwitnessed concerns, source-scoped applicability, incomplete history and separation of old saved payload from current bytes.

## Fix round 1 scoped rereview — 638926b4

Reviewed only the supplied fix package for `07d3b9c5c1ebf5b537e20116e5daa4e801efcf64..638926b44c296e6b2728af8393b75a9fa7ca2158`, including its appended implementation report, against DR-R1 and the transport qualification observation. No tests rerun, runtime edits, broad review restart, delegation or commits.

**SPEC: APPROVED for the scoped Task 2b implementation. QUALITY: APPROVED for this fix round, with genuine full PostgreSQL/project Storage and final CI qualification still pending.** These verdicts supersede the initial changes-required verdicts above; they do not establish native delivery acceptance or positive C authority.

**DR-R1: ADDRESSED.** The cutoff RPC now returns `a.facts.document`, the attempt and outcome xids as strings, and the persisted witness visibility snapshot. It reads the immutable attempt preimage, not the current archive row. Existing storage observation, DB record times, hashes, cutoff and current-query visibility token remain distinct. The updated unit oracle preserves the supplied original unavailable/null-path identity. The added native oracle creates that actual state, completes the same archive row with changed generation snapshot, appends a verified observation and verifies that the original cutoff payload retains its original document identity and visibility fields. The SQL oracle is authored and remains unexecuted locally; its result must come from the native gate.

**Native cancellation qualification gap: ADDRESSED at the controlled runtime/transport layer.** Two new tests exercise the actual installed Storage SDK, Node fetch and loopback TCP with header and body stalls. Only client selection is redirected to a dummy-key local client. They check the real operation deadline, actual abort signal, server connection closure and unavailable result after attempted late response. The reported local execution is 2 PASS / 35 deliberately skipped using an explicit scratch transport configuration. This is stronger than the previous mocked stream evidence and appropriately distinct from project Storage/SQL qualification. It does not alter the mandatory native guard, fabricate CLI status, or establish project DB/Storage PASS.

No new load-bearing breakage found in the fix diff. The still-unpublished owned forward and its manifest hash are updated consistently; no published historical migration or generated contract change appears in this round. The remaining full-native expectation is 261 cases across five files, including the new saved-identity oracle and transport cases. Authentic generated artifacts and ordinary CI remain parent-owned gates. Context-only authority, incomplete coverage and the Task 3/4 boundaries remain intact.
