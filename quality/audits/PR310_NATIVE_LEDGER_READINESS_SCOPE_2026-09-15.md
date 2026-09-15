# PR310 native ledger identities and readiness scope — 2026-09-15

Decision: genuine CLI-generated migration identities are compatible with the source-authored API runtime gate. Actual deployment-governance readiness remains false until deployment-specific evidence is reconciled. That is an explicit separate operational state, not by itself a reconstructed-schema defect or a newly imposed production-commissioning gate for this PR.

## Current reconstruction contract

The active continuation in `.agent-memory/current-state.md:81–97` calls for actual144 foundation/514 historical source execution, forward-source admission, ledger-dependent T257/T262/T275/T351 behavior qualification **without synthetic historical ledger aliases**, independent source/schema dispositions, final live-owned checks, real generated types and same-head CI/E2E/review. It expressly reports no production work. The checkpoint likewise asks for native144+514+4, actor/schema acceptance, genuine types/manifest and final CI. The historical `quality/audits/ALIGNMENT_CONTINUATION_2026-09-11.md:209–210` distinguishes the static production-readiness inventory check from generated live-manifest SQL, which was not executed.

No inspected continuation requirement demands commissioning a production deployment or rewriting canonical_migration_manifest to make the actual governance views true as a prerequisite to reconstruction acceptance. Therefore do not invent such a gate, run the historical live reconciliation script, or create historical aliases in schema_migrations. Existing per-Runner exact source/retained-program/actual-ledger statement evidence is the appropriate native-history authority; a summary provenance mapping may aggregate it but must not substitute for its checks. Whole-source effect acceptance, actor behavior, final live capabilities and schema dispositions remain separately required. This audit grants none of those acceptances.

## Actual application consumers

A repository search of app and lib for canonical_migration_manifest, canonical_migration_readiness_v, gridex_migration_governance_v3 and platform_schema_state found no runtime query consumer. `lib/platform/schemaReadiness.ts:3–6` explicitly separates live capability traffic gating from migration-history auditing. Its sole database readiness relation is `platform_runtime_readiness` at10 and103–110. Evaluation at75–89 requires is_ready=true, exact required schema_version, a valid SHA256-format fingerprint and an empty blocker array. It does not require migration_version to equal a historical ledger identity; the selected migration_version is returned only as diagnostic metadata at164. Fingerprint validity is not whole-schema equality.

The direct assertPlatformSchemaReady callers found are billing/metering matching and normalization, monthly billing automation, provider webhook/event handling, invoice readiness/export/underlay, manual inbound mail ingestion/polling, manual email outbox, integration API authentication, and daily/end-to-end reconciliation cron routes. They all reach this capability gate. No separate historical-ledger equality check was found in these readiness consumers. This is a bounded consumer trace, not execution of every endpoint or a claim that every domain readiness function succeeds.

`20260813230000_runtime_readiness_dependency_resilience_v1.sql:4–46` creates a persisted runtime-readiness table (despite an older static test's loose “view” wording). Its refresh function uses actual max(schema_migrations.version) when no migration version is supplied, validates the14-digit format, and obtains ready/blockers/fingerprint/capabilities from gridex_runtime_schema_capabilities_v3. Its authored call at119 passes historical20260813230000 as metadata; it neither asserts nor creates that ledger row. The real function thus supports an actual generated CLI timestamp. Full reconstruction must verify the final runtime row/capability behavior; neither the historical metadata nor this source inspection proves final readiness true.

## Governance behavior and operational incompatibility

`20260803093200_gridex_migration_governance_v3.sql:1–62` explicitly describes deployment governance separately from runtime. It requires verified checksums/effects, exact applied_ledger_version plus applied_ledger_name mappings, and no unmapped or duplicate ledger mappings. T275 retains those semantics and its comment at174–175 says canonical_migration_readiness_v is not the external API runtime gate. T275 also inserts six historical portfolio manifest mappings; the newly generated CLI identities do not satisfy those authored mappings. Keeping the actual view false is honest and expected absent deployment reconciliation.

The historical operational `scripts/post-apply-runtime-readiness-v4.sql:10–19` explicitly requires historical ledger version20260803212754/namecanonical_migration_readiness_reconciliation_v4, and its postflight at106–137 requires real governance readiness and seven specified historical mappings. It cannot be run unchanged against the new native ledger. `scripts/post-deployment-verification-2026-08-02.sql` exposes governance/manifest/state as operator evidence. `scripts/reconcile-live-platform-schema-2026-08-03.sql` contains production-specific attestation and duplicate-credential repair assumptions. Those are deployment procedures, not selected reconstructed migration sources or application request paths; do not invoke them to force a green reconstruction result.

`check-production-migration-readiness.cjs` checks source inventory/checksums/documented collisions and the existence of the controlled reconciliation script. It does not query a database or establish actual governance readiness. `generate-canonical-migration-inventory.cjs:89,115` warns not to populate the live manifest before clean reconstruction and live schema-effect verification. Its generated template is not an executed deployment receipt.

## What the native behavior fixture proves

`canonical_native_ledger_readiness.py` pins the four exact source units. Positive governance fixture rows map only to the real cloned CLI ledger, with a ledger-statements-serialization checksum explicitly labelled as fixture evidence. It uses savepoints and an outer rollback, verifies catalog/data and ledger restoration, disposes the clone, and leaves the parent manifest unchanged. Its receipt explicitly reports deploymentReady=false and historicalLedgerAliasesCreated=false. This qualifies actual source function behavior, failure modes and rollback isolation, not actual deployment attestation or historical-source checksum identity.

No additional mapping implementation is necessary merely to reconcile naming in the application gate. If a future deployment is commissioned from this reconstruction, a separate controlled procedure must consume the retained source/phase and real Runner statement evidence and attest actual verified schema effects. It must preserve source checksums separately from generated-program/ledger checksums and never fabricate ledger rows. Existing manifest applied_ledger_version/name fields already permit a true differing identity, but their partial unique index allows only one mapping per actual ledger version. Grouped foundations and split source phases consequently need an explicit many-to-many provenance representation in retained verification evidence; blindly inserting one ledger mapping per historical file would be invalid. That future procedure is outside the current authorization and was not implemented.

## Inspected source pins

| Path | SHA256 |
| --- | --- |
| `lib/platform/schemaReadiness.ts` | `8e2f23936d3207bdbc968d63dd29e404c7e070efb90cddbf886246d9987fb38e` |
| `scripts/canonical_native_ledger_readiness.py` | `fed2c7f6d49b88b961b2e98fe12b1b54fd2c8deef1c3caff15314d2b30ba2e50` |
| `supabase/migrations/20260803093000_platform_schema_runtime_columns_v3.sql` | `0795a6c34195efe355e4e0a15c1946eba1c5259a7afb51c8d670191a2dd77730` |
| `supabase/migrations/20260803093200_gridex_migration_governance_v3.sql` | `104554751e3418b051647150170f80884fb537747a4c399737f83852bcd16089` |
| `supabase/migrations/20260803212754_canonical_migration_readiness_reconciliation_v4.sql` | `08b8722e962ee019c9d190dcb3c4f3efe4cd956cdf88a0d432a0989f70635117` |
| `supabase/migrations/20260813230000_runtime_readiness_dependency_resilience_v1.sql` | `63b6099df1e28139d0a3e82011f582fa11c9e46d20db1aa3a2d43932050e8a0e` |
| `scripts/post-apply-runtime-readiness-v4.sql` | `9eb9c134ad10616a53e598426f6ac4d9a7d495029c5f48bec326c1b5158a6801` |
| `scripts/post-deployment-verification-2026-08-02.sql` | `b30bb04d6a30c873e451ed567aad08870e52b6f5c6024426bcb0fababadfd5c0` |
| `scripts/reconcile-live-platform-schema-2026-08-03.sql` | `59ca1be72a19637a2c2c5f03d22ca2f56d25c659afcf54691089b9d3362c44d6` |
| `scripts/generate-canonical-migration-inventory.cjs` | `491bedfef4b60d130da12d10637a05e86f34e02afc42247f8613761e4f43859d` |
| `scripts/check-production-migration-readiness.cjs` | `1c3f7e0df80f5712720756296005ef414e8405b0512e3a78f615c26fd5b5b74b` |
| `scripts/check-platform-runtime-readiness-v3.cjs` | `c76f7379752c625ee8d52a888f0e39f5dab3fb2c985ba71fdebc06d95bfa1a10` |

Read-only audit; no SQL, migration, manifest, ledger, reference, runtime application, acceptance flag or production state changed. Native SQL completion and final acceptance are monitored by the parent task.
