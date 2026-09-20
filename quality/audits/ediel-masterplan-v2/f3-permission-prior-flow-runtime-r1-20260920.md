# Prior permission-flow correction R1 — R-PF-1

Single completed-review finding: R-PF-1 MEDIUM, candidate own DTM137 later than response/cancellation own DTM137 could qualify as prior evidence. Read the complete independent review report and replayed its normative assertions unchanged before modifying production. Original requirements and the source/tenant proposal remain unchanged. Root explicitly retained the existing receipt/dispatch≤source-receipt checks within this narrowly scoped correction; no new transport chronology policy is introduced.

Runtime commit: `9ba2e38f41776a3a35d7e6ade04aa46c56d37856`. Production delta is four lines in `prodatPriorPermissionFlow.ts`, including three comment lines. Tests append ten controls to the existing prior-flow suite. No existing assertion, fixture, loader, manual consumer, field diagnostic, schema, frozen source, workflow or threshold changes in this round.

## Correction and evidence

After candidate ownership/environment/party/dispatch qualification and exact own-LI selection, compare candidate own message time with source own message time. A strictly later candidate sets `wire_conflict` and cannot enter the matching-candidate set. The existing internal-review path stops all manual effects and retains independently assessed field evidence. A later contradictory exact-LI candidate also keeps the result internal when another candidate matches. Earlier and equal203-minute message timestamps remain eligible. Other-LI candidates do not create a conflict for this occurrence.

This comparison uses each selected UNH's own DTM137/203 in the existing fixedUTC+1 interpretation. It does not substitute DB insertion time or local receipt time for message chronology. The six earlier/equal-minute positive controls deliberately place request dispatch or prior-Z15 receipt after response/cancellation generation but before source receipt. They preserve the existing delayed-transport allowance; no target-receipt≤cancellation-generation constraint was added. Existing source/candidate timestamp availability, validity, historical scope and receipt/dispatch≤source-receipt checks remain unchanged, as root confirmed.

| Evidence | Before correction | After correction |
| --- | --- | --- |
| New ten runtime controls | 7PASS/3RED: all three later-own-date relations reached positive | Included in222/222 focused PASS |
| Z13→Z14 earlier/equal/later | Later own date wrongly reached manual positive | Earlier/equal positive with one event+real draft; later internal, zero event/draft |
| Z18→Z15 earlier/equal/later | Same contradiction | Same preserved positive and blocked negative boundaries |
| priorZ15→Z15C earlier/equal/later | Same contradiction | Same preserved positive and blocked negative boundaries |
| Earlier valid plus later contradictory exact-LI candidate | Internal ambiguity already prevented positive | Remains internal; no silent selection of the earlier candidate |
| Unchanged independent normative reviewer probe | Fresh replay1PASS/2RED matches original | 3/3PASS with original assertions and source/config hashes unchanged |

Fresh runtime RED and reviewer RED were captured before the four-line production change. Original independent `chronology-requirements-red.json/.log`, capture probe and all source/config files are preserved separately. Archived executable source/config copies end in `.txt`; quality test discovery is unchanged. Original earlier runtime evidence remains immutable.

## Scope, review and limitations

Applied receiving-code-review, systematic-debugging, TDD and verification-before-completion to this single finding: reproduced actual consumer behavior, isolated missing cross-message chronology comparison, added the finite three-relation controls, corrected the assessor and replayed unchanged normative tests. No subdelegation. Source qualification and tenant query ownership were already independently approved; they were not reopened or broadened. Self-review confirms comparison is after exact LI and verified candidate scope, before any correlated evidence issuance. Equal minutes use `>` rather than `>=`; the negative remains internal instead of inventing a national40/105/41/42 error.

No live DB/storage/provider/market send or human communication occurred. DB/auth/event persistence remain mocked in tests; the real loader, assessor, field validator, actual manual resolver and ACK builder execute. No current-state or grant producer was added. Existing unlinked/spontaneous Z15, missing historical mapping and unsupported remote representation limitations remain. Counts98/110+10 and PR310 pause are unchanged.

Initial candidate03a7e651 and publisheda8c4 CI are historical after this fix. Independent scoped rereview, exact new Node22 CI, guarded merge and actual-main acceptance remain root gates. Local execution uses Node24.19.0; it is not substituted for exact Node22 CI.

## Final verification

All required gates passed on runtime9ba2e38f; no source or test change followed the full run. Fresh full4797/4797 in308files, focused222/222, unchanged reviewer3/3, strip-only818/818, packagedquality45/45. All three typechecks pass; lint has0errors/100existingwarnings. The complete15-entry ledger comprises13required gates plus implementation-diffcheck and packagedquality. Each entry records exact command, exit, duration and SHA256 raw-log identity.

Full and route-readiness used `NODE_OPTIONS='--max-old-space-size=4096 --require=./scripts/lib/refactor-safe-static-read.cjs'`. All other commands and existing strip-only source loaders remain unchanged. No schema/source/workflow/dependency/gate/budget modification. Service-role baseline2402 remains unchanged; scanner remains2400, as disclosed in the original report.

| Gate | Exact command | Exit |
| --- | --- | --- |
| ediel-eight | `node --experimental-vm-modules --test scripts/test-ediel-rule-pack-source-identity.cjs scripts/test-ediel-prodat-source-locators.cjs scripts/test-ediel-prodat-characteristic-fields.cjs scripts/test-ediel-prodat-reference-fields.cjs scripts/test-ediel-prodat-document-fields.cjs scripts/test-ediel-prodat-party-fields.cjs scripts/test-ediel-prodat-d-z04-reference.cjs scripts/test-ediel-component-escaping.cjs` | 0 |
| full | `npm test -- --reporter=json --outputFile=/workspace/scratch/2a201d6d5897/gridex-next/quality/audits/ediel-masterplan-v2/permission-prior-flow-runtime-r1-20260920/full.json` | 0 |
| implementation-diffcheck | `git diff --check 03a7e651d73317230ba57810d2090e6aae1aacd2 -- lib app __tests__` | 0 |
| integrity | `npm run ediel:masterplan-v2:integrity` | 0 |
| large-files | `npm run quality:large-file-budget` | 0 |
| lint | `npm run lint` | 0 |
| performance | `npm run quality:performance` | 0 |
| quality | `npx vitest run --config quality/vitest.config.ts --reporter=json --outputFile=quality/audits/ediel-masterplan-v2/permission-prior-flow-runtime-r1-20260920/quality.json` | 0 |
| ratchet | `node scripts/check-service-role-tenant-ratchet.cjs` | 0 |
| route-readiness | `npm run gridex:route-readiness-regression` | 0 |
| tenant-integrity | `node scripts/gridex-tenant-integrity-regression.cjs` | 0 |
| tenant-shutdown | `node scripts/gridex-tenant-shutdown-regression.cjs` | 0 |
| typecheck-scripts | `npm run typecheck:scripts` | 0 |
| typecheck-tests | `npm run typecheck:tests` | 0 |
| typecheck | `npm run typecheck` | 0 |

Integrity: all66 original runtime/reviewer scratch files in `prior-hashes.json` remain byte-identical. Reviewer source/config archives are exact copies with non-executable suffixes; original RED and capture receipts are retained. Protected-schema/source/config/script/workflow delta is empty. Only the two owned runtime/test paths changed outside new evidence. The original tracked Task2 report and initial audit/evidence are unchanged; the required scratch Task2 report has this R1 report appended, with its exact previous prefix hash/length recorded in the R1 evidence manifest.

R-PF-1 is implemented and locally verified, pending root-owned independent scoped rereview and fresh exact Node22 CI. No final acceptance/merge/main claim is made.
