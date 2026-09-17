# Active work — PR327 DTM review remediation

PR327 is the single active item, on `codex/ediel-v2-prodat-date-fields-20260917`.
Current main is `31b4dbeb764874e252e8b6b510bf1fa78832f148` after merged PR326.
Published review base `bb3e8301fd3d48161fd45c5431471e87caa6e54e` has all four
ordinary CI workflows green but two substantive review findings; that head must
not be merged merely because CI passed.

Both findings are reproduced and corrected locally: subtype-specific date
exclusions now apply per object in the common matrix, and explicit null dates
remain cleared through alias/snapshot resolution and real builders. The new
113 review cases reproduced 45 passes / 68 failures on the unchanged review
base. All 113 now pass; the containing boundary suite passes 143 / 143, including
30 earlier tests. Full local Vitest passes 1,814 / 1,814 in 213 files; retained
source cases pass 848 / 848. Full new-head CI and substantive rereview are still
required. See the task-specific date review audit for exact evidence and limits.

Next: publish this correction without overwriting a changed PR head, run every
ordinary CI/release gate, resolve substantive review, then merge the exact tested
head. Only after that merge start register/dependent rules from new main.
PR310 stays paused at e9611351. No SQL, generated types, grants, production
mutation or external Ediel messages are part of this correction.
