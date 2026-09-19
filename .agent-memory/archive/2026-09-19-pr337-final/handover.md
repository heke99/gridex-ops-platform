# Continuation

Current main base fda3420e471862b58b55f9beec948ca9efc38f3b includes merged PR336.
18/110 numeric D cells and2/10 parent occurrences accepted in bounded units;92numeric and8parent occurrences remain. Full field229, F3–F7, live TGT and release incomplete.
PR310 remains paused/excluded at e961135199f292b8210884f07de3b616a670161a.
Issue332 is an issue, not a PR. Its three retained failures were reproduced and locally repaired: existing runtime checksum source omitted by inventory; stale Z18/installation source-text checks replaced by actual renderer assertions. No SQL/hash manifests/generated types/thresholds changed. Local23targeted and3116application tests passed. Test typecheck initially failed on two fixture types, then corrected and passed. Node24 local runtime differs from required CI Node22; remote CI is required.
PR335 overlaps336 and contains an unmerged receiving-direction correction that must be reconciled before further D work.

Read live refs/PRs before applying anything. Do not reapply older archives. After332 reconcile335 incoming UD correction, then remaining D units and later phases.

PR335 reviewed against main: its original inbound defect is already avoided by main parse-only handling. Leave unmerged; no source-qualified remaining bug established. Issue332 full run exposed relative Node preload cwd in new fixture; fixed without disabling preload. New head requires fresh CI/full run.
