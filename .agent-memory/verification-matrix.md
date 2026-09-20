# Verification matrix — PR356 continuation

| Check | Observed result | Scope |
|---|---|---|
| Branch GET | ac53b020e430a2ffa87c09579180355055793393 | Initial live resume checkpoint |
| Main GET | 561c53ad9ba413eeb4f37ab1b029b1a5ba26d320 | Actual base at resume |
| Compare main..ac53 | 3 ahead, 0 behind,66changedfiles | Complete branch, not HEAD~1 |
| PR310 GET | Open/draft/notmerged, e961135199f292b8210884f07de3b616a670161a | Paused; no write |
| PR356 create/readback | Open/draft, ac53 head/main561c53ad | Not approved or merged |
| Author15-gate ledger | All exit0, runtime153b7d5a,Node24.19.0 | Inspected historical receipts; no local rerun |
| Ediel CI35522698816 | SUCCESS | Initial exact ac53 |
| Browser CI35522698821 | SUCCESS | Initial exact ac53 |
| Full CI35522698818 | SUCCESS | Initial exact ac53; detailed certificate not yet inspected |
| OPS CI35522698819 | IN_PROGRESS | Initial snapshot; re-read required |
| Independent runtime review | PENDING | Four verdicts required; no self-approval |
| Final-head Node22CI / merge / actual-main | NOT_VERIFIED | Must not infer from initial-head or Node24 receipts |

Original complete matrix is preserved byte-for-byte at `archive/gas-identity-ac53b020/verification-matrix.md`. Updating memory does not constitute a test execution. The new docs-only commit must itself be read back and compared with ac53 before treating it as the published candidate.
