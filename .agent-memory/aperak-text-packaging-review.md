# Independent packaging-only review — APERAK archives

Date: 2026-09-20. Exact candidate `de385ceef28d3764d04ab142432a1193d763bf46`, tree `8c293a75cf362d02c1b2eae5c2322beafca33a5b`. Reviewed delta from approved R1 candidate `591131280604a569d26a88fca5dc29792c082c8f`.

**Verdict: APPROVE.** The archive discovery defect is addressed without changing runtime, durable tests, quality discovery or CI gates. No blocking or new nonblocking finding. Prior R1 runtime TASK/SPEC, QUALITY and WHOLE-BRANCH approvals stand. Root still owns fresh exact-candidate CI and release/main verification.

## Scope and checks

Read the complete packaging changes, appended task report, relocation map, current manifest, gate receipts, saved CI-failure provenance and exact failure excerpt. Reused code-review/differential-review/verification guidance from the completed runtime reviews. No delegation, live calls, implementation edits, commits or original-receipt rewrites. This review is limited to packaging/provenance and does not repeat the runtime audit.

The saved CI receipt substantiates the stated root cause: under published5bd0e060, job106064154601/run35505371794 discovered the two archived replay tests through `quality/**/*.test.ts`. All59 individual assertions passed, but both archive `afterAll` writers raised ENOENT for their historical scratch observation paths; two of four suites failed. The correction does not create those old directories, rerun the old writers, swallow errors or change test discovery.

Independently verified all three relocations against the exact59113128 Git blobs:

| Archive | New suffix | Bytes | Result |
| --- | --- | --- | --- |
| `complete-controls.test.ts` | `.test.ts.txt` |2157 | Byte-identical; original path absent. |
| `related-owner.test.ts` | `.test.ts.txt` |1429 | Byte-identical; original path absent. |
| `vitest-with-setup.config.mjs` | `.config.mjs.txt` |277 | Byte-identical; original path absent. |

All files remain under `quality/audits/ediel-masterplan-v2/aperak-text-runtime-fix1-20260920`. Git independently recognizes each as a100% rename. Their assertions, output paths and source content are preserved for deliberate replay into a separate scratch workspace. The archived sources are now text artifacts, so they no longer match the unchanged quality test glob or participate as active lint/typecheck source.

`git diff 59113128 de385cee -- lib __tests__ quality/vitest.config.ts .github/workflows scripts package.json package-lock.json vitest.config.ts` is empty. Working files in protected paths also equalde385cee at review close. The28 durable structural regressions and all original runtime tests are unchanged. The only discovered quality test paths are `quality/test_functional.test.ts` and `quality/test_regression.test.ts`.

## Independent verification

Executed the exact affected command from the repository root:

```sh
npx vitest run --config quality/vitest.config.ts
```

Fresh result: **exit0,45/45 tests in2 files**. Output is in `/workspace/scratch/2a201d6d5897/aperak-text-packaging-review-20260920/quality-suite.log`, SHA256 `8a419d896b92ec503c8c5cb4f7bfe464770e6bca579be299a979f24c99daab24`. This independently corroborates the candidate's45/45 receipt. No optional full application rerun was performed; runtime and `__tests__` are byte-identical to the R1-approved/full-tested code.

| Provenance check | Result |
| --- | --- |
| Three relocation hashes and byte counts | All match exact prior blobs and current files; both relocation tables agree. |
| Historical fix receipt manifest after path mapping |38/38 current files match historical hashes. |
| Historical fix-evidence manifest | Original SHA256 retained; no historical path claim rewritten. |
| Packaging receipts |11/11 match current-manifest hashes. |
| Gate records | Six entries agree between gates/current-manifest, all recorded exit0; types/lint remain author receipts, not unnecessarily rerun. |
| Immutable snapshot |115 whole files unchanged; the authorized appended report has the recorded current hash. |
| Original report prefix | Exact13,946-byte9aad6a4f prefix retained. |
| R1 report prefix | Exact25,031-byte59113128 prefix retained. |
| Current appended report | Hash matches current manifest. |
| Saved CI log and durable excerpt | Saved hash/byte count match; excerpt exactly equals saved lines775–849 and its hash. |

The current report truthfully resolves R1-N1:116/116 refers to the historical pre-append snapshot, while the current state is115 unchanged complete files plus an exact preserved report prefix. The provenance file explicitly identifies the root-saved connector-decoded log bytes (including saved newline), without claiming identity with an unavailable original remote transport stream. Raw-log EOF observations stay disclosed and historical receipts stay untouched.

New reviewer `verification.json` contains independent checks and `receipt-hashes.json` hashes the fresh outputs. Packaging diff SHA256: `36753887db8b293226a8ce9bfadb6f2dc9e65ac9a53d2058a629759250b8a5e1` (`review-59113128..de385cee.diff`).

## Limits and next action

This approves the narrow archive packaging fix and preserves the prior runtime approval. The exact quality gate was rerun locally; parent-owned fresh Node22 CI remains necessary for the published candidate. No live protocol acceptance, whole-masterplan conformance, new producer authority or historical count increment is claimed. Root can proceed with the planned exact-candidate CI and guarded release sequence.
