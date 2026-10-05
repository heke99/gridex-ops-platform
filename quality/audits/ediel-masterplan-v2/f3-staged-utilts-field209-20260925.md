# F3 bounded continuation — guide/function and field 209

Base: PR #372 draft head `b9a1dc16074f23e400c74492e7561f1b688ec3e9`; separate branch `codex/ediel-v2-f3-composition-20260925`. PR #310 excluded. No hosted execution.

## Observed difference and correction

Masterplan §4.2, ST-U01/ST-U02 and U p.107 require guide before functional assessment per IDE. The real E66 monthly original in `ediel-e66-monthly-billing-resolution.test.ts`, with LOC+239 removed and a QTY+220 reading/energy mismatch, gave `guide_rejected` / `negative_aperak` but also produced functional E19 in `validation.issues` and `ackPlan.utiltsErrDetails`. The inbound processor saves the validation/ACK plan in the message report; persistence uses the transaction disposition, and the ACK writer emits the guide-negative APERAK. Thus the unwanted functional diagnosis is observable, while the disposition and response family were already correct for this case. The initial attempt to remove a registration timestamp did not establish a guide error and was replaced by the confirmed fixture.

The canonical facade now removes functional error findings attributed to a guide-rejected IDE after its profile, quantity and effective-date passes, and rebuilds classification, dispositions and ACK plan. It keeps referenced functional findings for other IDEs. When every IDE has a guide error it also drops an unreferenced functional finding; in mixed messages an unreferenced functional finding remains available to non-guide siblings. The pure functional computations still execute in the legacy kernel before guide validation; this batch corrects the final observable diagnosis, not the literal execution order. A separate staged evaluation review remains for F3C-05, including mixed unreferenced findings and native persisted effects. No billing or transport code changed.

The retained effective-date unit previously asserted E19 on a minimal original missing mandatory guide fields. It now uses the existing complete monthly synthetic original with a real 1000-versus-500 mismatch and asserts the absence of guide errors before checking the September/October cutoff. This preserves the cutoff question.

## F3C-02 field 209

Original P26.A r3 p.47 C212/7140 n..25, agency 9/89 and object-local identity: `canonicalPolicyFieldValidator` → `fieldMatrix`/`prodatRegisterFieldState`/`prodatRegisterGroups` → canonical register evidence. An actual canonical caller test accepts a 25-character agency-9 object and rejects the separate 26-character agency-89 object without transferring the rejection. This is a covered boundary, not a newly found runtime defect. The final national APERAK, object/LI reference and business-write boundary remain separate F3C-04 evidence. F3C-02's 314/258/213 composition and remaining field families have not been fully adjudicated here.

## Next finite question

Trace 314's global LIN count and 258's object-local register sequence, then own QTY31/213 through canonical runtime decision and final inbound response. Use an original with one malformed object and one valid sibling; determine exact ACK reference and absence of writes for the malformed object before changing code. F3C-06 grammar, F3C-07 finding ledger, F1/F2 and F4–F6 remain unreviewed in this batch. External G03/G04/G05 and PR #310 parity are deferred and do not block code inspection.

## Local verification

- The focused E66 test failed on the original implementation with a saved functional E19 while its disposition was `guide_rejected`/`negative_aperak`; it passed after correction. The first candidate with missing registration time did not create a guide error and was discarded.
- Focused E66, cutoff, disposition and field209 tests passed after the correction. The full Vitest pass excluding two Node-version-sensitive subprocess wrappers was 378 files / 6,084 tests. App and test typechecks, scoped ESLint, specification-integrity checker and `git diff --check` passed.
- A preliminary unfiltered full pass on local Node 24 had three failures: the old guide-invalid cutoff fixture (subsequently repaired and focused-green) and two unchanged subprocess wrappers that parse Node 22's `# tests` TAP summary, while local Node 24 prints a different reporter format. The two underlying scripts reported passing cases. The ordinary CI Node 22 full pass is the publication gate, not inferred from this local exclusion.
