# Successful retry binding: authorized syntax-only correction

2026-09-23. Explicitly incomplete; native compilation remains pending.

The user explicitly approved a narrow exception to the published-migration immutability rule for `20260923135706_ediel_utilts_consumption_binding_v1.sql`: parenthesize the CASE operand in the PL/pgSQL IF condition at line 392 and update its exact checksum. This approval does not authorize unrelated migration changes.

Root supplied actual native evidence: OPS `35875416652`, native job `107229927027`, failed while applying the migration, at the validator definition ending at line 401. PostgreSQL reported syntax error at end of input for the ungrouped `IS DISTINCT FROM CASE WHEN ... THEN ... END` expression. The enclosing migration transaction did not COMMIT; tests and type generation were not reached. Log-only artifact `10756148285` ZIP SHA256: `45ed4444c84513bf5f5aadb3a854e6d6b960238d5e19dfbc0daa35f9bb36d221`.

Root also supplied its read-only hosted check: the known Gridex development project returned `migration_applied=false` for this version and `binding_schema_exists=false`; the project inventory contained only that Gridex project. This agent did not perform hosted operations or writes.

- Previous SQL SHA256: `2e961d22370ead922ee02252a4fa95b77ecd33880f37b9d59fbd8e1a2966ca28`.
- Corrected SQL SHA256: `c6376a62644efe24a733a872410d48d6f74372e68d4c0c56db03fd2a6380df7e`.
- Exact SQL delta: insert `(` immediately before `CASE WHEN o->>'readingType'` and `)` immediately after that expression's `END`. All other SQL bytes, guards, ACLs and migration ordering are preserved.
- Manifest delta: replace only this migration's checksum entry with the corrected SHA256.

Executed local byte proof: PASS comparing the working migration against `git show HEAD:<migration>` with precisely that single two-character insertion. Node22 `scripts/check-migration-versions.cjs`: PASS (602 files / 506 version groups). Node22 `scripts/gridex-aud-003-migration-provenance-regression.cjs`: STATIC_PROVENANCE_PASS (509 timestamped files). Staged diff whitespace check: PASS. These checks do not claim PostgreSQL compilation. Root publishes the separate fix, performs same-tree synchronization and runs authentic native replay before implementation resumes.

The unfinished native matrix and the new ownership RED test remain unstaged and excluded from this repair commit. Earlier full5931/363 and typecheck results describe the implementation checkpoint; no rerun or native success is inferred for this syntax repair. The previously recorded hash remains valid historical evidence and is superseded only by this explicitly authorized correction.
