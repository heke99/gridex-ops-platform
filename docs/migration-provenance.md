# Gridex OPS migration provenance contract

This contract defines the machine-verifiable empty-database replay model for Gridex OPS. It does not authorize rewriting already-applied migrations or manually editing `supabase_migrations.schema_migrations`.

## Canonical replay model

A fresh replay is reconstructed from four evidence classes, in this order:

1. checksum-pinned legacy foundation inputs in `scripts/gridex-aud-003-foundation-order.json`;
2. checksum-pinned derived bootstrap substitutions declared in the legacy-foundation manifests;
3. every remaining checksum-pinned timestamped repository migration in deterministic full-filename order, except an artifact explicitly classified in `scripts/gridex-aud-003-noncanonical-artifacts.json`;
4. the observed compact `gridex-ops-dev` ledger, recreated locally only through Supabase CLI-owned no-op marker migrations.

Derived bootstrap substitutions and noncanonical exclusions are different concepts. A derived bootstrap is executable canonical reconstruction whose source is checksum-pinned. A noncanonical artifact remains preserved in Git as historical evidence but is excluded from canonical replay only when its exact content hash and deployed-lineage evidence prove that it was not part of the canonical deployed schema.

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

A timestamped repository file may be excluded from replay only when all of the following are true:

- its exact path is listed in `scripts/gridex-aud-003-noncanonical-artifacts.json`;
- its SHA-256 matches both that classification and the immutable migration-history manifest;
- the classification status is `merged_repository_artifact_not_deployed`;
- a concrete reason and evidence list are present;
- it is not simultaneously a foundation input or bootstrap source substitution.

Any content drift, missing evidence, broad date-based exclusion, or undeclared skip fails CI.

## Ledger discipline

- Never manually insert/update/delete `supabase_migrations.schema_migrations`.
- Never mark an unapplied migration as applied to make replay green.
- Never rewrite an already-applied canonical migration in place.
- Never add phantom current-schema columns solely to satisfy a stale historical artifact.
- Supabase CLI owns local marker-ledger writes during replay.

## Verification gates

`node scripts/gridex-aud-003-migration-provenance-regression.cjs` statically verifies provenance manifests, hashes, foundation order, interleaved substitutions, noncanonical classifications, ledger ordering, replay safety and critical smoke gates.

`bash scripts/gridex-aud-003-clean-replay.sh` starts an empty local Supabase stack, executes the verified reconstruction, recreates the observed dev ledger through Supabase CLI markers, validates critical objects and requires an exact schema fingerprint.

`GRIDEX-REM-002` is VERIFIED only when both the static provenance gate and the clean empty-database replay pass on the same commit.
