# Open blockers — register delivery

The original PDF is available and hash-verified; source availability is not a blocker. PR327 publication/review blockers are closed.

1. Complete the actual TGT source-column grouping and TGT message builder with the shared object/register serializer.
2. Complete the second expected-context/PRODAT comparison path and strict register identity, including source annotations.
3. Preserve trusted per-object dependent facts through engine snapshots/preflight and block unknown register conditions before sending; close dependent-only topology gaps.
4. Complete inventory edge cases and actual object-scoped multi-object customer application. The current multi-object approval guard blocks unsafe single-customer application. Qualify remaining 213 numeric syntax from the primary source.
5. Run unchanged ordinary CI on the final published head, resolve substantive review findings, and perform a guarded merge only after the whole register unit is complete.

PR327 remains MERGED as 51c73950515d771d2c2edcb97fde28ab087437a3; its tested head28b0e6ccb0473ee97fe021dc28aab462debc3a97 and prior ordinary-CI/review receipt remain authoritative. Do not restart or overwrite it. PR310 remains PAUSED at e961135199f292b8210884f07de3b616a670161a and is excluded. No SQL, schema, generated database types, grants, production data/storage, explicit deployment or market messages were changed.

Local passing tests do not certify the uncompleted paths, all110D conditions, fullF3, live/TGT approval or pausedPR310. No new non-production GitHub authorization is required.
