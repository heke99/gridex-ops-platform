# P8 backfill native qualification packet — 2026-10-01

Native status: **NOT_EXECUTED (0)**. This packet prepares an isolated genuine PostgreSQL proof; the local source/Bash checks below do not certify full Supabase replay, native RLS or concurrency. Docker and psql are absent in the current editing environment. Wiring/executing the prepared CI step remains implementable internal work, not an external business blocker.

Owned paths are the new native config, native test and this unique report. The four previously frozen backfill sources/report and three baseline rollback files remain unchanged. No workflow, historical migration, grants, production guard, schema/type artifact, shared memory, provider or remote ref is changed.

Skill routing: the existing project TDD, systematic-debugging, database/tenant-security and verification-before-completion workflow applies to the bounded SQL and Bash proof. Installed Supabase guidance applies to local provisioning; no hosted plugin operation is needed. Interface, provider and performance changes are outside this packet. Independent review is requested before root wiring.

## Isolation and provenance

Default native execution requires Node 22, CI=true, RUNNER_TEMP and explicit GRIDEX_BACKFILL_NATIVE_ALLOW_NEW_STACK=1. Any GRIDEX_REPLAY_DB_URL is refused. The exact local Docker socket is used for inventory; an existing supabase_db_gridex-ops-platform container or published configured database port 54322 is refused before archive/provisioning. Root must invoke this as a **separate existing upgrade-job step after complete restore/rollback stack teardown**, never inside the active clean-replay stack.

The wrapper archives the entire pinned ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8 repository into a mode-0700 private RUNNER_TEMP directory. It compares all 653 historical SQL bytes against the preserved current files before provisioning, records inventory/archive/original replay SHA-256, and binds the two unchanged full repair scripts to their frozen SHA-256. It sources the actual original clean-replay script in its own Bash subshell, outside if/! suppression, retaining its real stack/checkout EXIT cleanup. No candidate forward is applied. A nested Node-22 Vitest process executes while that full old stack remains alive; the shell's working directory remains the private old checkout at EXIT.

The active replay intentionally holds historical migrations outside its migrations directory. The inner proof checks the preserved archive and original replay source rather than incorrectly counting the temporary CLI marker directory. It also computes the actual canonical old-schema fingerprint c70fa2f017f6ce3af3ff806d948f18b58a3c196e4bf94daa9304629a3926680c, checks literal local postgres database identity, and verifies new billing-profile RPC/columns are absent.

The complete original-scope apply script first runs on the fresh old baseline before synthetic tenants are created. This explicitly settles known-tenant correlation repair over existing baseline seeds; before/after digest hashes are retained in the receipt. Failure there is reported as baseline_complete_apply_prerequisite, not attributed to later fixtures or claimed as a clean/no-effect initial baseline. This preparation is not a hidden partial SQL replacement.

Raw replay, cleanup and inner-run output stays in private logs; none is relayed. The outer test prints only a bounded receipt of fixed boundary/outcome labels, SQLSTATE, sanitized public constraint identifier and hashes, then deletes the private archive, logs and checkout. Original Bash failures retain their exit status; expected low-role/late-fault SQLSTATEs are distinguished from unexpected SQL failures. CI cancellation/runner disposal is still the external process lifetime boundary; no local cancellation drill was executed.

## Actual schema and fixture behavior

Both exact SQL scripts register the same original 18 parent-relation triples. Runtime introspection records every triple's actual table existence, company NOT NULL flag, RLS flag, complete constraints/validation state and enabled trigger definitions in a private catalog receipt. This is an inventory of 18 actual relation surfaces; the packet does **not** claim 18 independent business-semantic acceptance cases.

Read-only preflight against the pinned/current checked-in full schema supports using customer_authorization_documents, customers and draft powers_of_attorney. Documents have nullable company_id and company/customer composite plus simple foreign keys; the checked-in dump has no document power_of_attorney_id foreign key. Runtime catalog evidence and actual inserts remain authoritative. The recorded NOT VALID company-required guards in historical hardening source do not justify assuming a corrupt NULL fixture is insertable: no guard is removed to seed it.

Two actual synthetic companies/customers and two draft POAs are seeded through ordinary production tables/triggers. Document type other and status uploaded are valid ordinary data that avoid the POA-document binding and signed-agreement finalization branches; no fabricated signed mandate, legal bundle or activation is introduced. Four attempted documents cover agreed/null tenant, different-company parents, missing POA parent, and a current non-null tenant mismatching a POA parent.

Every denied seed retains its actual SQLSTATE/constraint and verifies zero persistent effects from the failed insert. Its receipt explicitly says ACTUAL_SEED_GUARD_DENIED_ZERO_EFFECTS_REPAIR_NOT_QUALIFIED. It is never counted as executed repair/manual-graph proof. The required agreed-NULL positive case causes the native proof to fail if production guards make that seed impossible; late-fault/apply/replay do not quietly skip into an overall green qualification.

## Prepared genuine PostgreSQL cases (0 executed)

| Case | Required actual evidence |
| --- | --- |
| Complete dry-run | Execute unchanged psql script, classify all accepted fixtures against both parents; every persistent data digest unchanged. |
| Low-role denial | Execute complete apply SQL under authenticated and anon; exact 42501 and unchanged entire data snapshot. No role/grant changes. |
| Late audit failure | Add an isolated fixture BEFORE INSERT audit trigger, preserving all original audit guards; reject the real agreed document's audit with P0001 and verify transaction-wide rollback; remove only fixture trigger/schema. |
| Complete apply | Exactly one agreed NULL document moves to A and one safe-derivation audit lists both parent relations. Every accepted manual row retains its whole row; no manual company/correlation/audit effect. Every quiet-B scoped digest is unchanged. |
| Complete replay | Execute unchanged full apply again; all whole-data and quiet-tenant digests unchanged, including audit count/content. |

Snapshots use repeatable-read transactions and ordered JSON row digests over every real persistent table in ordinary business/auth/storage schemas, including private and Gridex effect schemas. PostgreSQL internal, information_schema and managed runtime/extension-only namespaces cron, net, realtime, extensions, graphql, graphql_public, vault are explicitly excluded. Every UUID-company-scoped quiet-B table within that same scope is included. They are logical application-data snapshots, not storage object bytes or physical backup/PITR proof. No snapshot table/schema is copied into checked-in files.

After fixture apply, only public.customer_authorization_documents and public.audit_logs may change in that whole application-data snapshot; every other table, including durable queues and private application effects, must retain its digest. Any real background/application effect that violates this assertion fails the proof; it is not excluded after the fact to manufacture green. Correlation behavior on other relation types is already covered by the separate typed nullable PostgreSQL-core suite, not newly claimed as native meter/site acceptance here. Concurrent lock blocking, production-scale timing, same-tenant customer/resource identity and hosted data remediation remain outside this native packet.

## Executed local checks

- Exact new native file under source-check mode: **9/9 PASS**. Real full pinned archive + every historical SQL byte; actual source hash/inventory; context/container/port refusal; actual extracted Bash wrapper with controlled replay/child stubs returning 0, 7 and 9. Synthetic sb_secret_/sb_publishable_ start/child/cleanup witnesses stay private, cleanup receipt is retained during the test, original status is preserved and all temporary files are removed. These are source/Bash checks, never real SQL/native PASS.
- Initial local source/Bash run: 7/9 PASS, 2 failed. It exposed an in-memory archive maxBuffer limit and a test assumption that early cleanup logs always use stack.log. Archive is now written directly to a private file and hashed in bounded chunks; early-source cleanup is correctly recognized inside the private baseline log. This RED/GREEN is harness verification, not a production backfill defect claim.
- Scoped ESLint of the two new TS files: PASS with zero warnings.
- Scoped TypeScript import closure: PASS with strict/ES2022/bundler/Node types and skipLibCheck, no emit. Root all-script/application gates remain separate.
- Existing exact frozen nullable PostgreSQL-core backfill suite: rerun **12/12 PASS**. This remains PGlite core qualification, not complete historical Supabase/native proof.

Local source command:

```sh
GRIDEX_BACKFILL_NATIVE_MODE=source-check node node_modules/vitest/vitest.mjs run --config scripts/canonical-multitenant-backfill-20261001-native.config.ts
```

Prepared CI command, only after every existing local stack is disposed:

```sh
CI=true GRIDEX_BACKFILL_NATIVE_ALLOW_NEW_STACK=1 node node_modules/vitest/vitest.mjs run --config scripts/canonical-multitenant-backfill-20261001-native.config.ts
```

Actual native job/head/tree, real seeded case outcomes and first unexpected error must be added from the future executed run. No latest generated schema/type qualification is inferred from preparing these files.

## Frozen source manifest

| Path | SHA-256 | Git blob |
| --- | --- | --- |
| `scripts/canonical-multitenant-backfill-20261001-native.config.ts` | `d89e33dc22947fde4f5f2d0ca1b0a3ffa98225d0e3ef2a56e15241d524715964` | `143ac2de006dd4d88da7579e89d2f018a39e0b31` |
| `scripts/canonical-multitenant-backfill-20261001-native.test.ts` | `7c536092a9c6ad67a4cb1041e970748436bea29a4c3ef5b76a9f51c511ce0be8` | `9ed92bf97ea13e8429e1ed01ed5e861f38a0973e` |
