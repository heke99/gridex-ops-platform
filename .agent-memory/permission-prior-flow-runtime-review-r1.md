# Independent scoped R1 review — prior permission chronology

Candidate `0294d44f877cc9b39d3f29ebb57f7f6eb480537b`; runtime `9ba2e38f41776a3a35d7e6ade04aa46c56d37856`. Scoped range `03a7e651..0294d44f`. This rereview addresses the sole completed-review finding R-PF-1 and checks the correction delta and packaging for new defects. The prior complete review and its bounded tenant approval remain the baseline; unrelated unchanged paths were not reopened.

| Review | Verdict |
| --- | --- |
| TASK/SPEC | APPROVE — R-PF-1 addressed |
| QUALITY | APPROVE |
| TENANT | APPROVE for the bounded static correction; prior limitations unchanged |
| WHOLE-BRANCH | APPROVE, combining the initial complete review with this scoped correction review |

**R-PF-1 is closed. No new findings established in the fix delta or packaging.** Exact new Node22 CI, guarded merge and actual-main acceptance remain root-owned gates; this report does not certify those executions.

## Correction assessment

Read the appended Task2 report, tracked R1 audit/evidence manifest and scoped review package, then inspected the actual production/test diff. Production changes are one comparison plus three comment lines in `prodatPriorPermissionFlow.ts:81–84`. The comparison runs after candidate ownership/environment/party/status/dispatch qualification and exact own LI selection. If the candidate's own DTM137 is later than the source's own DTM137, it sets `wire_conflict` and excludes that occurrence from matching authority. Existing aggregate internal-review handling then prevents the permission event/positive result/draft.

Both dates already pass the existing historical-scope validation before this comparison, including finite parsed timestamps through temporal record checks. Earlier dates remain eligible; strict `>` preserves equal203-minute dates. Unrelated LI candidates do not create a new conflict. A later contradictory exact-LI candidate cannot be silently ignored in favor of an earlier match. Existing candidate ambiguity, tuple comparisons, source/evidence sealing, field diagnostics and manual guards are unchanged.

No receipt-versus-generation policy was added. Existing receipt/dispatch≤source-receipt checks remain byte-for-byte unchanged, as explicitly retained by root. The six new earlier/equal controls deliberately include dispatch or target receipt after response/cancellation generation and before source receipt; the correction therefore distinguishes own-wire chronology from delayed transport. It introduces no national40/105/41/42 inference.

Ten appended controls cover earlier/equal/later own dates for Z13→Z14, Z18→Z15 and priorZ15→Z15C through the actual manual resolver and real ACK builder, plus an earlier match beside a later contradictory exact-LI candidate. Later-date cases assert internal review with retained field assessment and zero event/draft; positive controls retain one event and draft. No previous assertion or fixture was changed.

## Fresh independent verification

Replayed the original normative reviewer probe **without changing its source, assertions or configuration** on exact candidate0294d44f:

```sh
node node_modules/vitest/vitest.mjs run --config /workspace/scratch/2a201d6d5897/prior-runtime-review-independent/vitest.requirements.config.mjs --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/prior-runtime-review-independent/chronology-requirements-r1-reviewer-green.json
```

Result: **3/3 PASS,0failed, exit0**. Fresh output was written under a unique name; original capture and1PASS/2RED receipts are unchanged. DB/auth/event persistence remain mocked; actual resolver, loader, assessor, validator and builder execute. No live effects occurred.

| Preserved/new evidence | SHA256 |
| --- | --- |
| Original chronology-requirements.test.ts | 9665578d980a40144574402d69dd71ecbde16982f4a117d2e118e566ad2cf842 |
| Original vitest.requirements.config.mjs | d13cb2d7b3a61db818570293cf2878060f64db0c0c952d4d6e67f2094e20f417 |
| Fresh chronology-requirements-r1-reviewer-green.json | 5781d48ed6dbd948208445f1f8cdebf140fe86f8d17d2b15c9ba766b77b07433 |
| Fresh chronology-requirements-r1-reviewer-green.log | 11ecedf365455a2982ddbdfac5fff6a74dcbd5db1c37ffeaa54676ed01eb3792 |

All files in the table reside in `/workspace/scratch/2a201d6d5897/prior-runtime-review-independent/`. The report's command omits shell log redirection for readability; actual execution redirected output to the unique `.log` above.

## Packaging and receipt verification

Fresh independent checks establish:

- 8/8 manifest input hashes and52/52 artifact hashes match actual bytes.
- All66 entries in the prior-file hash ledger remain unchanged, including original reviewer source/config/RED receipts.
- All15 final-gate log hashes match; all recorded exits are0. The ledger comprises13required gates plus diffcheck and packaged quality.
- The previous scratch Task2 report's17090-byte prefix still matches SHA256 `c82e80c36c55832ed555c1bf7c4b22a425709e70c04ee6e3b6a3b04b66893b19`; R1 is appended separately.
- `git diff --name-only 9ba2e38f..0294d44f -- app lib __tests__` is empty. Final report packaging did not change the runtime or tests covered by the full receipt.
- Protected schema/scripts/workflow/config/dependency diff is empty. The only executable delta is the four-line assessor addition and nineteen appended test-source lines. Runtime/test diffcheck passes.

Parsed author execution receipts independently: full4797/4797, focused222/222, quality45/45, author unchanged-reviewer replay3/3; pre-fix reviewer replay1PASS/2RED. New-control RED contains7PASS/3RED with the other84 tests skipped, accurately distinguishing selected execution from discovery. The audit reports818 strip-only tests and all required gates passing. These are reviewed author receipts, not broad suites re-executed by this reviewer. No optional broad rerun was performed.

Root-owned memory/checkpoint updates and the preserved initial review are distinguished from implementation. They record the initial candidate/CI and correction status rather than substituting initial CI for corrected-candidate acceptance. Source artifacts, initial reports and prior evidence remain preserved; archived probe/config copies use non-executable `.txt` suffixes.

## Scope and remaining limitations

Continued the same local code-review, differential/spec comparison, false-positive and verification workflow, with the already-read mandatory Supabase/tenant guidance. No new database/query/ownership behavior is introduced; the prior TENANT approval remains valid within its static scope. No additional skill fan-out, browser/E2E, cloud calls, production edits, schema changes, memory edits or commits were performed.

Initial review limitations remain: no live RLS/configuration/delivery or production exploit verification; no permission-state/grant authority; unlinked/spontaneousZ15, missing historical mapping and unsupported remote representation remain internal processing holds. Other unchanged direct/canonical/system paths and full F3/masterplan completion are outside this unit. PR310 remains paused/excluded and acceptance counts98/110+10 unchanged. Local evidence uses Node24; corrected exact Node22 CI and main acceptance are separate root gates.

The single requested correction is sufficiently evidenced. No further implementation change is requested by this scoped rereview.
