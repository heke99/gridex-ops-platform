# Active state — PR326 review remediation

Updated2026-09-17. Main2d65dc9 contains PR324/325. PR326 is the sole active item;
old published head a7b4ddde has green CI but FOUR substantive review findings.
The four fixes and87 new regression cases are now implemented locally.
Unchanged old source30pass/57fail; corrected87pass. Full Vitest1434/1434,
retained source848/848 and all3TypeScript groups pass. Changed ESLint0errors/
8retained warnings; golden/route/integrity/unchanged large-source budget pass.

Detailed evidence/scope: quality/audits/ediel-masterplan-v2/f3-party-review-remediation.md.
Next: publish the exact correction, run NEW ordinary CI, address substantive
review and merge with guarded exact head. Read live GitHub state; this is a
pre-publication checkpoint and does not claim merge or whole-plan acceptance.
After merge only, DTM/register/dependent work. PR310 remains paused at e9611351.
No production mutation, SQL/generated types/grants or external Ediel messages.
