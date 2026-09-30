# Actual candidate CI evidence: 4b7888a, 2026-09-30

## Provenance and overall result

Read-only observation of the existing #422 runs; no rerun, workflow/ref change
or publication was performed by this reviewer.

- Repository: heke99/gridex-ops-platform.
- Published head: `4b7888a461ad03580b6e11ae91217b64cd05fa21`, parent `0d81465617d11f099502832385d976fdedf3cc6d`.
- Actual checkout from OPS verify, clean, upgrade, quality, smoke and browser
  logs: `7c98504db2d656e7211a5b721ca8731e0e25be69`.
- GitHub Git commit API proves checkout tree
  `06630a04ba3800e5e1ae53bffa1bacdd47950de1`, equal to published head's tree.
  Merge parents are ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8 and this head.
- Frozen local commit `97c81f8f66a2725b4fe4570c461d47850a73b124` has the same tree.
- Actual clean runner uses Node22, Supabase CLI2.101.0 and PostgreSQL17.
  Both setup-cli input and installed CLI diagnostic confirm 2.101.0.
- Every candidate workflow is now terminal.

This run proves canonical clean replay and produces authentic pre-fixture
schema/types. It does not prove the complete native fixture corridor or
backup/restore. Pending working-tree additions after this freeze have no
qualification from this run.

## Job results

| Run/job | Actual result | Evidence and acceptance |
| --- | --- | --- |
| OPS36783103604 verify110117956369 | FAIL | Expected generated-types tail drift to 20260930212832_invoice_provider_request_immutability.sql; later verify gates skipped. |
| OPS quality110117956734 | FAIL | npm run lint: scripts/tenantservice/ops-ui-context-inventory.mjs:88:8 @next/next/no-assign-module-variable; 1 error, 101 warnings. Later quality gates skipped. |
| OPS clean110117956898 | FAIL after replay PASS | Replay completes and genuine schema/types captured; first Vitest native package fails in cleanup, 6/6 webhook tests red. Later native/HTTP/UI corridor not reached. |
| OPS upgrade110117956774 | FAIL after upgrade PASS | All13 forward migrations and old-data checks pass; actual pg_restore fails because runner cannot SET ROLE supabase_admin. No restored parity or full restore acceptance. |
| Browser36783103430 public110117955548 | PASS | 4/4 public landing/login/accessibility checks; same checkout. Staging/browser/k6/ZAP/certificate paths skipped. |
| Full-E2E36783103547 smoke110117956351 | FAIL | 14/15 checks pass; only generated-types tail drift fails. Application typecheck passes. |
| Full-E2E coverage110117956701 | PASS | Coverage gate passes; not native/runtime proof. |
| Full-E2E PR certificate110118975285 | FAIL | Smoke prerequisite failed; later full/nightly/runtime/real-customer staging skipped. |

Tenant integrity36783103532 and Ediel masterplan36783103405 are terminal
success at this head (metadata observed). Production crawler36783103652
is skipped.

## Clean replay and first native error

Actual replay completion at 22:04:15.514:

```text
[GRIDEX-REM-002 replay] PASS: empty local Supabase -> verified reconstructed foundation
-> canonical checksum-pinned history -> CLI-owned observed dev ledger
```

Actual schema snapshot files are written at 22:04:17.578, with canonical
fingerprint shown below. CLI generates rem002-database.types.ts and the
workflow applies its existing nullability override before later fixtures.
The precise final types-capture completion event is
`2026-09-30T22:04:25.4572704Z Applied Supabase types nullability overrides: rem002-database.types.ts`.
The raw generator connects at `22:04:17.8738529Z` and its CLI diagnostic ends
at `22:04:25.3778543Z`; the replay completion time is not the types capture
time. ZIP DOS timestamps are types `22:04:24` and schema/fingerprint
`22:04:16`, with two-second resolution and no timezone extra. Actual log
completion gives the precise finalized-capture provenance used for adoption.

Before the webhook Vitest package, the sequential ON_ERROR_STOP SQL corridor
completes: manual inbound graph and nested source/concurrency regressions,
canonical provision hash, PR164 remediation, portal revocation, event-v2 and
legacy contact command. Actual explicit markers include E035 source SQL
62/62,84/84,105checks,71checks,8checks and its source concurrency markers,
PORTAL_REVOCATION_NATIVE_PASS, EVENT_V2_NATIVE_PASS and P2_CONTACT_NATIVE_PASS.
These are scoped SQL proofs, not later PostgREST/HTTP/UI completion.

The first Vitest package scripts/webhook-fair-claim-continuation-native.test.ts
has 6/6 failures. The exact primary failure is:

```text
ERROR: Published legal text versions cannot be deleted.
Archive by publishing a new version instead.
CONTEXT: PL/pgSQL function gridex_prevent_published_legal_text_mutation() line5 at RAISE
SQL statement "DELETE FROM ONLY public.legal_text_versions WHERE ... company_id"
Object.cleanup scripts/webhook-fair-claim-continuation-native.test.ts:49:20
```

The fixture removes queue/subscription/turn rows, then deletes its companies
at line53. Company deletion cascades into immutable published legal objects.
Six fair-claim assertion markers are printed before finally cleanup; every
test then fails. None of those six tests is accepted as a genuine fair PASS.
Expected denied-role/invalid-input/synthetic late-fault errors in the log are
intentional negatives and distinct from the cleanup failure.

Downstream source-owner PostgREST, notification/profile/address/portal/site/
capability/support/billing native packages, current-actor HTTP cases and
authenticated interactive customer/settings/case browsers are NOT_REACHED.
No screenshot is present in this artifact.

Root assigned the cleanup correction to its owner: retain immutable fixture
companies/legal objects until disposable stack teardown, while removing only
owned due queue/turn work. No guard bypass is accepted.

Quick source review for the same company-cascade pattern found no analogous
explicit company-delete cleanup in the downstream native corridor. Existing
later fixtures retain disposable rows or use rollback; this is a bounded source
check, not execution of those later fixtures.

## Upgrade and actual restore error

Observed in actual upgrade job:

```text
TENANTSERVICE_UPGRADE_PLAN_VALIDATED baseline_migrations=653 forward_migrations=13
TENANTSERVICE_UPGRADE_PINNED_OLD_SCHEMA_REPLAY_PASS
TENANTSERVICE_UPGRADE_EXISTING_OLD_ROWS_SEEDED_PASS
[all13 forward migrations applied]
TENANTSERVICE_UPGRADE_LEGACY_BILLING_COUNTRY_CHANNEL_CONTACT_SEPARATION_PASS
TENANTSERVICE_UPGRADE_EXPLICIT_EQUAL_COPIES_AND_RELATIONSHIPS_PASS
TENANTSERVICE_UPGRADE_HISTORICAL_LIFECYCLE_PREREQUISITES_PASS
TENANTSERVICE_UPGRADE_ISSUED_BYTES_RETAINED_PASS
TENANTSERVICE_RESTORE_EMPTY_TEMPLATE0_DATABASE_PASS
TENANTSERVICE_RESTORE_PG_RESTORE_FAILED
TENANTSERVICE_PROOF_FIRST_ERROR restore.log: must be able to SET ROLE "supabase_admin"
```

The failure is from actual pg_dump archive restoration into the empty
template0 database. Owner/default/ACL/data/catalog parity and restored positive/
negative authority proofs are NOT_REACHED. The full restore PASS marker is
absent. Raw restore diagnostics remain in the private wrapper log; only the
sanitized first error is emitted.

## Artifact receipts and adoption paths

Actually downloaded both OPS ZIPs and validated their SHA256 against GitHub
metadata. Every member contains zero sb_secret/sb_publishable key patterns;
actual clean and upgrade job logs also contain zero such patterns. Only the
three generated files were extracted locally; raw replay/fixture log was not.

| Artifact | Actual ZIP SHA256 | Actual members |
| --- | --- | --- |
| Clean11128845353, size1020231 | be13dbfabee525633814cd126cdc33bb7908b01c7ca07192384ee0079fc8d1ab | rem002-clean-replay.log, types file, schema.sql, fingerprint.json |
| Upgrade11128832610, size867 | ee7cb658b10c42852ffa2cbf6b0f042499beb803715a012a9e845abab4313d89 | tenantservice-upgrade-restore.log only |

Clean generated file hashes:

| Member | Bytes | File SHA256 |
| --- | --- | --- |
| rem002-database.types.ts | 3379927 | 5b6a4cf56216475e76504eb0dd177efe8990f2c9cb82f2e3637820d8c9f4c8b7 |
| rem002-schema-snapshot/schema.sql | 5939429 | 306aeee268c26cfc99360a480d5be8e70f04ea316cc47bbe3bbc4a09bc40a287 |
| rem002-schema-snapshot/schema.fingerprint.json | 1895 | 681c720858d697029a15df8913b83d8f1f16dfd4a1baf56e4488fbcfd8fa5a23 |

Snapshot fingerprint algorithm sha256/canonical-json/v1, schemas public and
gridex_received_sources, canonical sha256
`7e20b06d800e2e220953d852664690db7e73c1c2a80e4a2de91e26a1d8bf57d4`.
This snapshot's schema scope must not be described as a full Auth/private/
storage restore catalog proof.

Root adoption input paths:

- /workspace/scratch/b08749f7eca6/ci-evidence/candidate4b-generated/rem002-database.types.ts
- /workspace/scratch/b08749f7eca6/ci-evidence/candidate4b-generated/rem002-schema-snapshot/schema.sql
- /workspace/scratch/b08749f7eca6/ci-evidence/candidate4b-generated/rem002-schema-snapshot/schema.fingerprint.json

These authentic bytes describe the exact published4b tree before later native
fixtures. Adoption belongs to root. Additional pending forward migrations
require a later authentic generation for final type/schema parity.

Other artifact metadata observed, not downloaded in this receipt:

| Artifact | Metadata SHA256 |
| --- | --- |
| Browser11128940095 | 54d299d66f52b45b78c36ccc1832dfcc93da3a6e994e41f57f713f5e6346a737 |
| Coverage11128827564 | 0c929ce37f359bdd123650436d666e26e59926817125bc6bfedf71922a711960 |
| PR certificate11128462979 | b030593114260f96483dda0b8aef7bb6d1aa668f9aa37e52b60f8be1b662830e |
| Smoke11128244300 | d669e06012edadb91b712cf072822570bf1183cb2b0e74be1e484ebb0d4c77f8 |

No proof from this run is attributed to pending support/provider/fair-queue/
real-HTTP UI modifications that were not in the published tree.
