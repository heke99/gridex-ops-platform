# Current state — F3-E final PR325 qualification

Updated: 2026-09-17. Single active item: finish PR325 BGM202/203/204/313,
then NAD/DTM and their consumers from actual merged main. PR324 is already
MERGED as b0b3b395a36168757b0f8b4a765b7f7fadf6cceb; do not republish its ZIP.

PR325 source head70f5632d failed real tests. Exact-source diagnostic35213650194
artifact10492987710 (SHA2561060e04527a1c42db4d8ae379ccf2d91f296f77cf529e60ab41233e1047eb2c7)
records1293pass/3fail: two real ACK reference escape defects and one synthetic
fixture relabelled PRODAT while retaining UTILTS wire. Both defects are fixed;
the positive fixture now has P wire and the contradictory old wire is rejected
explicitly. No source/TGT original or downstream safety check was weakened.

Isolated qualification35214234089 then passed1296/1296 full Vitest tests and
application/script/test types on code74bed19fa9372e81efb6cb24d9f1dc0a7e608925,
treefc13822822a7b905e77b9b14663c70488d75097e. This is not ordinary PR CI.
A final review also closes nonempty headerless source fallback; four cases
reproduce that hole and pass after the fix. Final145 new +439 retained real-source
cases pass locally. All19 consumer cases are retained.

The complete final source/docs head still REQUIRES normal exact-head CI and
review before merge. Read actual PR325 head/checks rather than earlier SHAs.
Transfer/diagnostic helper workflows are excluded. No merge is recorded here yet.
After guarded merge continue NAD/DTM, then register/dependent rules. This is not
all74fields/110D/full grammar or live/formal masterplan certification.

PR310 remains PAUSED at e961135199f292b8210884f07de3b616a670161a; recovery branch
backup/pr310-paused-20260916-e9611351 unchanged. No SQL, types, privileges, original
sources, production DB/storage, external traffic or deployment were changed.
