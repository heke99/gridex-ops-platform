# Recovery checkpoint A — 2026-09-18

The TGT adapter/serializer and two comparators have been reconstructed and passed fresh tests. See `quality/audits/ediel-masterplan-v2/pr328-recovery-20260918.md`. Full draft facts, inventory/error boundaries, admin/autopilot and safe object application remain. Not merge ready.

---

# Single active task — complete PRODAT register delivery

Status: PARTIAL, NOT_MERGE_READY.
Branch: `codex/ediel-v2-prodat-register-rules-20260917`.
Checkpoint base: `28b2a9ad1d745acaa4ea7fe15af7608da95e7884`.

Original PRODAT26.A revision3 PDF was retrieved from the public Ediel portal and matched the locked SHA256 83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95. The first/additional-register source table is recorded in f3-register-source-map.md/json. Local final checks passed: 146 new register cases; full Vitest 1960/1960 in217 files; 848/848 retained source cases; application, test and script TypeScript; unchanged original package integrity. These are local checks, not ordinary GitHub CI or independent review. No complete GOV-02/P-05/F3 certificate is claimed.

Implemented partial scope: distinct314/258, preserved raw and effective register data, object-isolated first-register authority, register overlays composed with the existing matrix/D engine, generic and profile builders, compatibility/staging preservation and one TGT comparison path. See the audit for exact boundaries, fail-first evidence, the retained Z06 subtype-fixture correction and CAV reader compatibility correction.

## Immediate next atomic action
Write failing actual-path tests for TGT source-column grouping and TGT message rendering, then use the existing shared register serializer. Do not create a parallel rules engine.

## Remaining ordered gates
1. Complete the actual TGT source-column grouping and TGT message builder with the shared object/register serializer.
2. Complete the second expected-context/PRODAT comparison path and strict register identity, including source annotations.
3. Preserve trusted per-object dependent facts through engine snapshots/preflight and block unknown register conditions before sending; close dependent-only topology gaps.
4. Complete inventory edge cases and actual object-scoped multi-object customer application. The current multi-object approval guard blocks unsafe single-customer application. Qualify remaining 213 numeric syntax from the primary source.
5. Run unchanged ordinary CI on the final published head, resolve substantive review findings, and perform a guarded merge only after the whole register unit is complete.

PR327 remains MERGED as 51c73950515d771d2c2edcb97fde28ab087437a3; its tested head28b0e6ccb0473ee97fe021dc28aab462debc3a97 and prior ordinary-CI/review receipt remain authoritative. Do not restart or overwrite it. PR310 remains PAUSED at e961135199f292b8210884f07de3b616a670161a and is excluded. No SQL, schema, generated database types, grants, production data/storage, explicit deployment or market messages were changed.

The remaining110 original D-condition unit starts only after the complete register unit is reviewed and merged.
