# Independent #503 source, capture and selected-native qualification

Read-only bounded review, 2026-10-05. Exact published candidate: **`5be3a902a61309e295d1f3b82f5ceb0996edb1dd`**, tree **`5c3e101cd3744b2479d9948c31183929755d83fb`**. Exact adopted producer: **`9b50b1b9a5aae19e9cabead09c92af4e0443c44c`**. Reviewer wrote only this new owned packet report; no producer, SQL, native test, capture, download, workflow, shared file, coverage, import or GitHub mutation was executed. Existing owner-downloaded artifacts were inspected directly.

**Verdict: seven source pins and exactly two admissions CONFIRMED; authentic composed-head capture QUALIFIED AS OWNER IMPORT INPUT; complete frozen SC010 behavioral clauses WITNESSED on the explicitly bounded BASE-plus-forward native stack. No additional SC010 literal oracle gap or confirmed producer/capture defect was found. Whole SC010 remains NOT_APPROVED pending the retained #503 composed-candidate integration gates.** Capture SUCCESS and a selected native SUCCESS are different proofs and do not supply those gates.

## One adopted producer and exact admissions

Independently hashed Git object bytes at both9b50 and5be3, rather than relying on the parent's `root-503-published-producer-import-review.json`. All seven entries agree with that receipt:

| Owned path | Exact SHA-256 at both commits |
| --- | --- |
| `lib/ediel/services/beneficiaryExport.ts` | `95b6bae56b2eb60e31ea32f03f4aec097af81cf19b5ab3d848b26e8d8a87820f` |
| `app/api/ediel/beneficiary/series/[seriesId]/exports/route.ts` | `6b484c34b4e7dfa9923f16e105839a73be8d9a8c19491ddad7b219db6588e1ed` |
| `app/api/ediel/beneficiary/exports/process/route.ts` | `543fb0a036d9ba81d51fd6769e95c5278a354961c5f1d82bcc69cc026aa15e49` |
| `app/api/ediel/beneficiary/exports/[jobId]/route.ts` | `13ac70a6d9496cb9f37eb5df8ed7b8f13d587aa7f11eb0f664558cee3ba278af` |
| `scripts/ediel-sc-010-beneficiary-export-native.test.ts` | `14611ac1edc3a4c0795e2fe4888e52524f033d98606d436becba1bdaf6809c66` |
| `quality/audits/ediel-masterplan-v2/sc010-sc071/sc010-export-native.config.ts` | `d8d4c4fd5e8a014dad5b70d1cb2e09108ea0d35ede7f55b11b4b748f4eb7c145` |
| `supabase/migrations/20261005101500_ediel_beneficiary_export_jobs.sql` | `d0e4ec7285796cb4c53786dd7016d6e4ce9dc5aa9be111481481b490a62a0596` |

`git merge-base --is-ancestor` independently succeeds for producer9b50 → candidate5be3 and for recorded main basis `3dff03dd8bb8c251b1613d35ce6fc7e66e6ee686` →5be3. This is one adopted producer, not a separate duplicate implementation requiring a second product merge.

Against that main basis, parsed `scripts/migration-history-manifest.runtime.additions.json` adds exactly:

- `20261005043923_ediel_unattributed_technical_intake.sql` → `a2d0aa2a62f48ee800b4df393d328acb1a1928d91ee96d9c16b94e5174463e27`.
- `20261005101500_ediel_beneficiary_export_jobs.sql` → `d0e4ec7285796cb4c53786dd7016d6e4ce9dc5aa9be111481481b490a62a0596`.

Both entries match their actual candidate migration bytes. No existing admission changes or removals were found. Root canonical include contains the actual SC010 native file; the effective retained SC071 file is `33b7d52a6a5b94bc75eb77c5446f93942fbdebf64a678f3684ff3f77208a0dc4`. Foreign intake/SC071 whole-card ownership remains unchanged.

## Authentic composed-head capture custody

Independent GitHub read-only metadata reports capture run **37319901610**, job **111796010070**, **completed/SUCCESS**. Artifact **11351030885** is named `staff-schema-capture-5be3a902a61309e295d1f3b82f5ceb0996edb1dd`, belongs to this exact head/branch, is unexpired, and has size **1631915 bytes**. Remote digest is **`37a62b7ae4a3e061863226ec07e5030e5df2346fd5b458ce4821b3c726f799ee`**. The existing local ZIP `/workspace/attachments/079d7083-9896-42c2-9427-32047b38f3f8/root503-5be3a9-authentic-schema-capture.zip` independently has that size and that SHA-256. Remote digest and local hash were checked separately and agree. All four ZIP members pass CRC.

| Captured member | Bytes | Independently computed SHA-256 |
| --- | ---: | --- |
| `database.types.ts` | 3680729 | `88cf7de264a01c68ba51d6b57f69aac451068cabc0f20f88362d748793ce7b5e` |
| `schema.sql` | 11282566 | `0d733d1ebe663805028817315f66e0e4f6c6740f832a988133c12596e2bd0857` |
| `schema.fingerprint.json` | 3687 | `fee88a983a91dd6e222d14dec461332521ad99065c773412e701d8039c7912bc` |
| `capture-receipt.json` | 4039 | `b6feb36446d02d772dc939446b997732d6138bd9b1d78121aaee809471070df8` |

The actual receipt names checkout5be3/tree5c3e, run37319901610/attempt1, capture time14:03:49.619118 UTC, CLI2.101.0, PostgreSQL server17.6 and matching pg_dump17.11. Latest replay input is the exact export migration/d0e4. All three recorded artifact hashes independently match member bytes; all eight recorded replay/manifest/type-override/snapshot/config input hashes independently match the candidate Git objects. The source workflow checks out the PR head (`.github/workflows/staff-api-schema-capture.yml:38`), sources the unchanged canonical local replay (`:76`), generates actual local types and schema (`:86–88`), and records the latest replay migration (`:116`). Raw replay/status output stays on the disposable runner. This is composed5be3 capture, not an overlay on the older native BASE7b.

The captured catalog fingerprint is **`9e2db4c7fc4f3a4e3d96e60019bad403400dd44913f0241f07fb7d1be7881b74`**. Its algorithm is `sha256/canonical-json/v1`; recomputing the canonical section-object hash independently gives the same value. The receipt, actual fingerprint member and actual successful job-log output agree. All56 schema names agree between receipt and fingerprint, including new `gridex_ediel_exports` and `gridex_unattributed_intake`. This checks manifest consistency; it is not an independent re-introspection of the stopped database. The replay guard's `9a0ecad…` is a different, deliberately bounded fingerprint over13 named public tables and two readiness functions (`scripts/gridex-aud-003-schema-fingerprint.sql:1–24`), not this full56-schema snapshot fingerprint.

The generated SQL contains the real jobs/results tables (member `schema.sql:95686,95726`), enabled/forced RLS, both new schemas, four export RPCs and two intake RPCs. Each export RPC appears exactly once in both the schema and generated public function types. All six export function bodies—four public RPCs plus both private immutable-scope/result trigger functions—match the admitted source after trimming only surrounding body whitespace. Captured public RPCs remain SECURITY DEFINER with empty search_path; their captured ACLs revoke PUBLIC and grant service_role. Source guards are not inferred from symbol presence alone: execute still takes graph-before-job locks and calls the retained projection with the **captured expected grant version** (`migration:124–139`); deny commits only blocked metadata; result/completion lease fences remain (`:140–155`); read re-evaluates current projection before selecting/comparing a retained page (`:163–172`). Their corresponding captured definitions are at member `schema.sql:42723,43566,44843,44946`.

At immutable5be3 the committed pre-import types/schema/fingerprint still hash `4f5713d6…`, `54a78fe9…`, `b04d8430…`; each differs from the authenticated new member. The actual capture artifact is now a qualified import input. A changed generated-file path or capture SUCCESS alone does not establish that the root coordinator has subsequently imported it, updated true origin/manifests, or passed post-import comparison. Reviewer does not import these bytes.

## Actual #503-head selected native receipt and exact effects

Independent remote metadata reports native run **37319901423**, job **111796006235**, **SUCCESS**, artifact **11350935305**, head5be3. Existing local ZIP `/workspace/attachments/856160a9-c176-4809-aff4-d7a8c08d3668/root503-5be3a9-sc071-native-feedback.zip` has **493793 bytes**, all16 members CRC-valid, SHA-256 **`e246071c54de663b0564e50ddec2c8b8088dcadf5201d45b21e44bf5be5bb302`**, agreeing with the independently fetched remote digest. Actual `receipt.json` hash is **`a52b6b8653a0d36b47fc396f742a8126e7ba737091acb8ef00e0326884788639`**. Actual JUnit hash is **`b3f38d840c590f6cc6bbdaf8845e99ab314c5f850d69fb1a57c355695b4c02f5`**; parsed JUnit has exactly10 unique file/name pairs, four SC010 and six retained SC071, **0 failure/error/skip**. Component/native exit codes are both0; final stage is `native_complete`.

The receipt expressly names workflow checkout5be3/tree5c3e but runtime **BASE `7b9218da2c7f71f4373bcc9189715c0043a8cb31` / tree `f03ec10bec420c9013848be526595c5fbb0242b7`**, plus exact producer/native9b50 overlays and forwardd0e4. The complete7559-entry BASE hash member, effective/post-native input members and both48-entry official-ledger members are byte-identical to the prior independently qualified f7 artifact. Effective/post-native hash maps also agree with the actual receipt and all eight relevant5be3 Git object bytes. All five actual candidate caller/config/patch/source hash entries match5be3. The existing caller still deliberately creates the pinned BASE worktree and applies the pinned forward (`ediel-sc071-native.yml:83–106,129–153`). A5be workflow label does not convert that runtime into a composed5be canonical replay.

Readiness actually reaches all four installed RPCs over HTTP, returning403/code42501 with the expected authorization/not-found reasons. The read-only timeout member reports anon3s, authenticated8s, authenticator8s; no timeout change is claimed. The raw member `native.log` hashes **`1308a416c7166a578b2e0420e2467402371b3f70722e7eaf1d33106e45a98e52`**. No new runtime was executed here. Parent's qualification file independently hashes **`504c9e18fd9a032d5f15015d08c65290e039ecc008c25bbf5c05104b427cebf2`** and agrees with this bounded custody review.

The receipt's `registered_sc071_source=6407877b…` is the preserved historical registration label from the caller descriptor. Actual candidate-source and effective/post-native entries are33b7, which were independently checked. The label cannot be cited as executed640 bytes; it does not invalidate the separately pinned and observed33b7 proof. Whole SC071 review remains with its sole owner.

## Complete frozen SC010 effect matrix and final ports

Re-read frozen `acceptance_tests.json:137–150`, native146 source, admitted/captured RPC bodies and `sc010-whole-card-integration-review-input.md` (actual SHA-256 **`06a69d44ac6f3ccf1876535d9410737d630a1e68d769d37c65464bbf786ca34c`**). The full literal is active grant at enqueue, real revocation before read/send, leased export execution, grant/version reconsideration and denied distribution, with no output authorized solely by old cache values. The internal authenticated export sink satisfies this scope; an external SMTP delivery is not a missing SC010 effect.

| Frozen or directly relevant effect | Actual behavioral witness and qualification |
| --- | --- |
| Given active grant at enqueue, revoked before execution; when taking a lease | Actual authenticated enqueue202 and idempotency, real retained administration revoke, durable authority snapshot change, actual process route → claim/execute. Native first case `:58–71` is an actual JUnit PASS. |
| Reconsider grant/version and stop unauthorized export | First case claims1/completes0/blocks1; actual durable job is blocked with no completion or lease token; no result/new projection receipt/provider-source change. Queue at both captured and attempted incremented versions is403; read is403/private,no-store with the generic denial body (`:72–82`). Exact captured-version/current-projection bodies above confirm the real consumer, not a mock-produced SQL effect. Prior12-group SQL additionally witnesses active-version drift without using status revocation as the competing denial. |
| Positive control genuinely exports authorized internal values | Second case's actual worker completes once; authenticated read returns actual DGI reading rows and source/purpose/field provenance; result/receipt counts are1, repeated worker claims0, source snapshots unchanged (`:85–99`). |
| Prohibited old cached values must not authorize output | After that positive result exists, actual revoke precedes read; read403 returns no page, while cached internal result and legitimate revoke/source/receipt snapshots remain unchanged (`:100–104`). Retained cache presence is the negative control, not authority. |
| Lease/write time boundary is atomic | Both genuine PostgreSQL destination/jobs lock waits are observed while lease is live; database expiry occurs; actual RPC returns no data and the specific `ediel_export_lease_not_current`, not an infrastructure timeout; result/receipt/source snapshots and original leased status/token remain (`:107–153`). Both actual cases PASS, so the final rollback assertions are reached. |

Thus **every frozen SC010 given/when/expected/prohibited behavioral clause is met on the explicitly selected runtime**, with genuine SQL/PostgREST/production routes and finite source/session/upstream/SMTP fixture ports. This is not a whole TEN10/TEN12 ownership transfer, genuine external legal approval, SMTP delivery, or a one-hour physical purge guarantee. Earlier12-group SQL50-component custody and the initial4498/2 failure remain separate historical receipts; no new capture or native result rewrites them. The input's additional current5be component/SQL-in-quality assertion is parent-reported here, not independently re-executed or upgraded into an overall green quality job.

Remaining concrete final #503 ports are:

1. Owner imports this authenticated composed capture with truthful producer/run/origin and checksum/type/fingerprint metadata; qualify the imported final candidate, rather than assuming import from this artifact.
2. The existing **composed-candidate** canonical clean/native chain, including registered SC010/SC071 and the joined source, completes with attributable final JUnit and no relevant failures/skips. The selected BASE-plus-forward result cannot supply this port.
3. Current candidate genuine upgrade/independent-clean parity and committed schema/type/fingerprint comparators pass after import, and required application/type/lint/tag/security/CI gates pass on the exact final integration head. At this review snapshot OPS37319901443 reported verify/quality/upgrade FAILURE and clean in_progress; this records job state only, not a new diagnosed cause. Capture did not run native/browser/type comparison/upgrade parity: its actual receipt expressly says NOT_RUN for all four (`capture workflow:132–135`).
4. Retained root completes whole current integration review and then the authorized sole SC010 acceptance-row promotion/actual-main accounting. Current NOT_EXECUTED rows are preserved; whole SC071 stays with its owner. No second harness, producer, native-scanner wrapper, capture or result-reader change is called for by this review.

No confirmed source/capture defect or extra frozen-literal assertion gap is identified at these exact inputs. **SC010 whole/current-head approval remains withheld solely at the explicit integration/gate boundary above, not because the selected behavioral contract is missing.**
