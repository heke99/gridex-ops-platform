# F3C-05: UTILTS phase field 502 agency 260

Base: draft PR #377, published head `5e08fd027dcbd4defb678698d03aca3317d1d8e0`, separate stacked branch. PR #372/#310 remain untouched; no merge or hosted execution.

Source: retained UTILTS 25-A-3 annex C `UG-122-21`, MKS/C332/3055 for field 502, requires `260`. The adjacent `UG-122-20` code row (E02/E03/E04) is already enforced by the field matrix and the canonical MKS header projection from PR #377. Existing `parseMks` retains only phase code; neither the matrix nor facade consumed agency 3055. The actual canonical runtime decision consumes the facade result for response planning.

RED: complete monthly E66 with a real 1000/500 E19 mismatch and valid `MKS+23+E02::260` gave E19 as control. Changing only agency to `999` still gave `functional_rejected` and ERR, with no 502 application error. Missing agency was also unqualified. The focused test failed at final classification before implementation.

Fix: inspect the third component of the existing tokenized MKS/C332 only after an allowed phase code is present. A missing agency yields ERC41, an agency other than `260` ERC42, both field 502. The existing header guide suppression then rebuilds final transaction disposition and ACK. A complete bad-agency E66 now yields negative APERAK/FTX502 and no UTILTS_ERR plan. The control with `260` keeps the real E19. If the phase code itself is invalid, its existing single field 502 error remains the qualified finding.

Local verification: focused RED 1/6 failed before implementation; GREEN 24 UTILTS files 273/273, app/test typechecks, scoped ESLint and diff check PASS. No native saved multi-IDE ACK or storage proof from these unit tests. The legacy functional computation still executes earlier; this change corrects final observable result, not literal staged execution or all guide fields.

Next: check PR #377 and this batch on their own exact heads; inspect another source-qualified header or mixed unreferenced functional outcome, then native persisted disposition/ACK/storage. F3C-04 Z04 mixed-object persistence, F3C-06 grammar, F3C-07 ledger and broader F1/F2/F4-F6 remain outside this narrow batch. Staging, TGT/AGT, counterparties and market sends are deferred.

Skill routing: continued repository `using-superpowers`, `spec-to-code-compliance` source/owner/consumer tracing, `systematic-debugging`, `test-driven-development` and `verification-before-completion`. The `fp-check` security workflow is not triggered by this business-rule defect; the complete-message RED is the direct behavior check. No parallel agent or unrelated database/UI/performance audit skill applies.
