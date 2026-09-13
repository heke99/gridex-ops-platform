# DB1/DB2 index source effects — 2026-09-13

Status: IMPLEMENTED_NOT_NATIVE_VERIFIED.
Base code880eb0d9273e78ef8647e7eaa90d7790506f9268.

## Verified prerequisite

Run34773587669/job103767504504 passed both complete selected continuation and
staged full foundation+timestamp execution with repository originals absent,
including new40 constructor tests and exact owned cleanup. This supersedes the
old staging coverage gap; it does not certify normal CLI/ledger/schema/types.

## Finite index proof

DB1 silently catches failures of15 dedupe index statements. DB2 reconstructs four
index DDL statements directly, but IF NOT EXISTS still proves only a name-based
no-op when a same-name index exists. Their semantics must be checked separately.

The new source-pinned proof compiles all19 exact index declarations on empty
ON COMMIT DROP temporary LIKE tables and compares native PostgreSQL catalog
representations: keys, expressions, predicates, uniqueness, null-distinctness,
collations/operator classes/order, access method and validity/readiness. The
actual table binding must also match. Temporary objects have no lasting catalog
or business-row effects. A separate owned clone loses one unique flag while
retaining the index name and key/predicate; that must be detected, while the
parent catalog stays unchanged.

Eight constructor/privacy/contract tests plus40 existing affected tests passed
locally. The hosted native result is pending. No all-effects acceptance flag,
historical SQL, source/type/schema manifest, app/API or production data changes.
Remaining: complete source-effect accounting, ordinary native/CLI lifecycle and
ledger provenance, accepted schema/type regeneration. No merge/deploy performed.
