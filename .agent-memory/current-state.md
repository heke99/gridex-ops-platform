# Current state — partial register implementation

PR327 remains MERGED as 51c73950515d771d2c2edcb97fde28ab087437a3; its tested head28b0e6ccb0473ee97fe021dc28aab462debc3a97 and prior ordinary-CI/review receipt remain authoritative. Do not restart or overwrite it. PR310 remains PAUSED at e961135199f292b8210884f07de3b616a670161a and is excluded. No SQL, schema, generated database types, grants, production data/storage, explicit deployment or market messages were changed.

Original PRODAT26.A revision3 PDF was retrieved from the public Ediel portal and matched the locked SHA256 83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95. The first/additional-register source table is recorded in f3-register-source-map.md/json. Local final checks passed: 146 new register cases; full Vitest 1960/1960 in217 files; 848/848 retained source cases; application, test and script TypeScript; unchanged original package integrity. These are local checks, not ordinary GitHub CI or independent review. No complete GOV-02/P-05/F3 certificate is claimed.

Implemented partial scope: distinct314/258, preserved raw and effective register data, object-isolated first-register authority, register overlays composed with the existing matrix/D engine, generic and profile builders, compatibility/staging preservation and one TGT comparison path. See the audit for exact boundaries, fail-first evidence, the retained Z06 subtype-fixture correction and CAV reader compatibility correction.

The prior planning-only checkpoint is superseded by this partial implementation. Runtime and tests now exist, but final ordinary CI, independent review and merge are NOT complete. Work continues from the single active task, not from the old source-mapping starting point.

Evidence: `quality/audits/ediel-masterplan-v2/f3-register-progress.md` and `quality/audits/ediel-masterplan-v2/f3-register-checkpoint.json`.
