# Active work plan

Current main base fda3420e471862b58b55f9beec948ca9efc38f3b includes merged PR336.
18/110 numeric D cells and2/10 parent occurrences accepted in bounded units;92numeric and8parent occurrences remain. Full field229, F3–F7, live TGT and release incomplete.
PR310 remains paused/excluded at e961135199f292b8210884f07de3b616a670161a.
Issue332 is an issue, not a PR. Its three retained failures were reproduced and locally repaired: existing runtime checksum source omitted by inventory; stale Z18/installation source-text checks replaced by actual renderer assertions. No SQL/hash manifests/generated types/thresholds changed. Local23targeted and3116application tests passed. Test typecheck initially failed on two fixture types, then corrected and passed. Node24 local runtime differs from required CI Node22; remote CI is required.
PR335 overlaps336 and contains an unmerged receiving-direction correction that must be reconciled before further D work.

1. Finish issue332 ordinary CI/full certificate and review.
2. Reconcile335 vs336 incoming UD behavior.
3. Remaining D units in333 dependency order.
4. F4–F7 with evidence gates; paused310 dependencies remain blocked.
