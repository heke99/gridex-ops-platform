# Gridex OPS migration provenance contract

This contract defines the machine-verifiable empty-database replay model for Gridex OPS. It does not authorize rewriting already-applied migrations or manually editing `supabase_migrations.schema_migrations`.

## Canonical replay model

A fresh replay is reconstructed from four evidence classes, in this order:

1. checksum-pinned legacy foundation inputs in `scripts/gridex-aud-003-foundation-order.json`;
2. checksum-pinned derived bootstrap substitutions declared in the legacy-foundation manifests;
3. every remaining checksum-pinned timestamped repository migration in deterministic full-filename order, except an artifact explicitly classified in `scripts/gridex-aud-003-noncanonical-artifacts.json`;
4. the observed compact `gridex-ops-dev` ledger, recreated locally only through Supabase CLI-owned no-op marker migrations.

Derived bootstrap substitutions and noncanonical exclusions are different concepts. A derived bootstrap is executable canonical reconstruction whose source is checksum-pinned; selection alone does not prove that all source effects were preserved. Excluded artifacts remain immutable in Git and require one of the distinct evidence contracts below.

The observed dev ledger begins at `20260531075508` (`fix_customer_internal_notes_customer_fk`). The ledger is compact relative to repository history and therefore cannot by itself reconstruct an empty database.

## GRIDEX-REM-002 canonical decision

### Migration

`supabase/migrations/20260530123000_gridcore_active_ediel_scope_rules_and_aibi_imports.sql`

### Expected prerequisite

The file reads `public.ediel_message_rules.application_reference` while seeding Ediel scope/rules. For the migration to be internally valid, an earlier canonical migration would have needed to add `application_reference` to `public.ediel_message_rules`.

### Repository evidence

No known predecessor that creates or alters `ediel_message_rules` adds that column. The DB1/repair foundations create the rules table without it. `20260530110000_gridcore_ediel_multitenant_foundation.sql` adds `environment`, `version`, `association_code` and `rule_payload`, but not `application_reference`. The failing file itself also never adds the referenced column. Other historical uses of `application_reference` belong to Ediel messages, intents, route/actor settings or adjacent models.

### Git history evidence

The failing migration entered Git in merge commit `0bb5b4fd6584ef759eeb07649c9c156dc0cda031` on 2026-05-30. The later unversioned `ediel_rules.sql` also does not create `application_reference` on `ediel_message_rules`. Repository-wide historical inspection found no prerequisite migration that supplies the missing rules-column.

### Live schema evidence

On 2026-08-08 the connected `gridex-ops-dev` schema showed no `application_reference` column on `public.ediel_message_rules`. It also did not contain several other transient columns attempted by the failing file (`role_code`, `enabled`, `current_version`, `allowed_versions`, `default_ack_policy`, `transaction_scope_policy`). The deployed rules model instead contains the DB1/foundation shape plus later canonical version/ack fields.

### Live ledger evidence

The live Supabase migration ledger contains no row for `20260530110000`, `20260530123000` or `20260530152700`. No live-ledger migration mentions `ediel_message_rules`. The tracked AI/BI migration at `20260625125336` is ALTER-only, proving that relevant base state was inherited from pre-ledger/legacy deployment history rather than this timestamp file being a canonical tracked migration.

### Runtime dependency

`lib/ediel/types.ts` defines `EdielMessageRuleRow` without `application_reference`, while `EdielMessageRow` explicitly contains `application_reference`. `lib/ediel/platformRules.ts` reads `ediel_message_rules` into `EdielMessageRuleRow` and has no runtime dependency on a rules-level application reference.

### Conclusion

Classification **B** is supported: `20260530123000_gridcore_active_ediel_scope_rules_and_aibi_imports.sql` is a merged pre-ledger repository artifact that never matched the deployed canonical `ediel_message_rules` lineage. It is preserved immutably in Git but excluded from canonical empty-database replay through an exact hash-bound classification.

### Confidence

High. The conclusion is supported independently by repository DDL, Git history, current live schema, current live migration ledger and runtime model evidence. No evidence was found for a missing prerequisite column migration.

## Noncanonical-artifact safety rules

A repository SQL file may be excluded from replay only when all of the following are true:

- its exact path is listed in `scripts/gridex-aud-003-noncanonical-artifacts.json`;
- its SHA-256 matches both that classification and the immutable migration-history manifest;
- the classification status satisfies one of the three contracts below;
- a concrete reason and evidence list are present;
- it is not simultaneously a foundation input or bootstrap source substitution.

Any content drift, missing evidence, broad date-based exclusion, or undeclared skip fails CI.

`merged_repository_artifact_not_deployed` requires deployed-lineage evidence that
the exact artifact was not part of the canonical deployed schema.

`historical_read_only_diagnostic` applies only to the two exact path/hash pairs
reviewed in `quality/audits/LEGACY_REPLAY_CLASSIFICATION_2026-09-05.md` and pinned
independently in the selector and provenance validator. Their complete statements
perform read-only inspection with built-in expressions and have no schema or data
effects to reconstruct. This status makes no claim about historical deployment.
Changing even one byte or adding another path requires renewed content review
and a code change; refreshing JSON checksums cannot authorize an exclusion.
This finite reviewed-content contract is not a general SQL safety parser.

`historical_operational_data_repair` currently covers only the exact reviewed
DB2B administrator/membership repair. Its complete source and the listed trigger
body source dependencies are independently checksum-pinned in the selector and
provenance validator. It contains operational identity/audit data repairs, not
schema definitions or generic role seeds, and is not executed during canonical
reconstruction. The status makes no deployment-history claim. Schema-bearing
dependency migrations remain independently accountable; this exclusion does not
approve the broader DB2 customer reconciliation or any other data repair.

Before any database start or migration-file relocation, the replay requires
`scripts/gridex-replay-input-accounting.py --require-full-effects` to accept every
input. Unclassified files and substitutions with unresolved effects fail this
gate. An accepted input plan still requires successful execution, generated-type
verification and full two-way parity; it cannot establish production convergence.

## Ledger discipline

- Never manually insert/update/delete `supabase_migrations.schema_migrations`.
- Never mark an unapplied migration as applied to make replay green.
- Never rewrite an already-applied canonical migration in place.
- Never add phantom current-schema columns solely to satisfy a stale historical artifact.
- Supabase CLI owns local marker-ledger writes during replay.

## Verification gates

`node scripts/gridex-aud-003-migration-provenance-regression.cjs` statically verifies provenance manifests, hashes, foundation order, interleaved substitutions, noncanonical classifications, ledger ordering, replay safety and critical smoke gates.

The former native invocation, `bash scripts/gridex-aud-003-clean-replay.sh`, is **blocked as of Task8**. Its prior CLI startup and official-ledger reconstruction behavior is historical, not a supported current execution path. The owned compatible entry below provides diagnostic replay with **NO ledger provenance**; native CLI ownership, genesis, private logging and official-ledger acceptance remain unresolved gates.

`GRIDEX-REM-002` is VERIFIED only when both the static provenance gate and the clean empty-database replay pass on the same commit.


### Owned compatible replay boundaries (Task14, 2026-09-11)

The selected foundation contains 98 inputs. First56 is unchanged: historical
fixture cuts30/31/32/33, P38, G42/R43, A44–Q52 and R2/E2/S2/W53–56.
Complete pinned H2 occupies57; the unchanged old57–97 suffix occupies58–98.
H2 is the 96-line original `20260525_debug_batch_2h_dedupe_user_roles_and_unique_guard.sql`,
SHA256 `98522e209332c44c804d7acccf831f25fb13b75b048fbe3613c8d69fcb373a9b`.
Every selected source executes once. No historical source, checksum or timestamp
was changed. Foundation path digest is
`271142f607da58484518cc870366802aa36fb3f3b6b9688c40188cf180d6ce08`.

Run `python3 scripts/canonical-auth-provisioning-replay.py --owned-compatible`
with one of these scopes:

| Scope flag | Execution boundary | Reference |
| --- | --- | --- |
| `--foundation-prefix-proof` | Historical first52, stopping after whole A–Q | Separate legacy first43/final52 catalogs |
| `--repair-prefix-proof` | First52 then whole R2/E2/S2/W through56 | Separate repair base52/final56 catalogs |
| `--dedupe-prefix-proof` | First56 then native whole H2 through57 | Separate independently constructed base56/final57 catalog and index oracle |
| No prefix flag | All98 then unchanged timestamp history, subject to full admission | All independent bounded references, then later full-replay gates |

Combined, abbreviated and unknown flags and arbitrary cutoffs are rejected.
All named scopes exit before artifact, type or ledger output. Full mode requires
`--require-full-effects` before owned startup or staging and remains blocked by54
unresolved inputs: global596=538 full/23 substituted/31 unclassified/4 excluded;
focused342=295/20/23/4, with43 focused unresolved. Selection is not hosted acceptance.

The parent creates a network-disabled PostgreSQL17 container and retains its exact
owned handle. Origin-verified shared loaders bind the legacy, repair and H2 helpers
to the same exact class and live owner. Independent references are constructed
before HOLD staging and never overwrite one another. H2's final oracle uses the
accepted reference construction plus only its two pinned index declarations;
actual target output never supplies the expected catalog. It includes full portable
catalogs and explicit index validity/readiness/uniqueness, predicates, opclasses and
NULL properties. References never substitute for actual selected-source execution.

The real shell retains originals in private HOLD700 and uses a parent-owned
socket600. All98 physical identities, checksums and source/oracle dependencies are
validated before bootstrap SQL, including in historical52/56 scopes. Reads after
staging use retained bytes without original-path fallback. Bootstrap, first43,
whole legacy44–52, repair53–56 and native H2 at57 execute in the same actual
`gridex_auth_legacy_replay` database. Legacy and repair retain their accepted
transactions and historical rollback/inspection proofs.

H2 retains its own BEGIN, two sequential deletes, two indexes, COMMIT and final
diagnostic, unchanged and without an outer single-transaction option. Its COMMIT
is not rollback-safe. The synchronous parent boundary requires accepted56,
exact base catalog and empty user_roles across **all** rows. It holds complete
public/Auth/storage row and explicit sequence last_value/log_cnt/is_called
preimages privately across COMMIT, then checks exact final catalog/indexes and
unchanged preexisting rows/sequences before allowing continuation.

New dedupe57/full lifecycles quarantine any failed target, deny subsequent
context/validation/foundation/SQL operations, and destroy exactly the owned replay
database before failure returns. If database disposal cannot be verified, cleanup falls back to the
exact name-and-label-owned container; unresolved disposal failure retains terminal
denial and reports a sanitized failure. References and unrelated canaries are not
selected for database disposal. Failed handles cannot start another attempt; fresh
owned construction rebuilds the complete accepted prefix. The parent also checks
child exit and exact originals/seed bytes, modes and timestamps after restoration.
Full accounting publication occurs only after complete child and restoration
success. Existing workflow owner/name/label cleanup covers controller death.

Commands1–18 retain their exact tuples and complete accepted SQL lanes. Command19
runs the full standalone H2 native/reduced/NULL/sequence/dependent/privacy/death
proof plus actual57 shell/HOLD integration and terminal-failure cases. The default
runner is `all19`; explicit `all18` and `all17` preserve historical prefixes.
Hosted `original16`, `legacy17`, `repair18` and `dedupe19` partitions cover all19
exactly once; the existing private H2 job runs command19 with its20-minute timeout
and always-cleanup gate. Task14 requires independent review and same-head hosted
all19, actual52/56/57, quality and Ediel before acceptance; constructors alone do
not establish SQL success.

This mode carries **NO ledger provenance**. It neither creates official Supabase
ledger rows nor equates compatible Auth/storage with a native provider catalog.
Native CLI and generic external URLs remain rejected. Full native replay, types,
later-chain security, provider parity, remaining source restoration and production
delivery remain separate open gates. Never refresh artifacts from a named proof.
