# Task 2b reference-only context implementation checkpoint

BASE `0a52821565dd7f29e3f3b683b726add3f4457bec`, accepted source runtime `8fde5f26`. Status: **IMPLEMENTED, LOCAL CHECKS PASS, NATIVE QUALIFICATION PENDING**. Ready for independent scoped SPEC/QUALITY review; not delivery acceptance, positive C authority, complete history, deployment or merge.

## Owned behavior

New `captureDocumentReferenceAction` accepts only company/environment/sealed-source/document IDs and explicit confirmation. It derives the actor from the authenticated guard, requires allOf `communication.send`, `documents.read`, `customers.read`, and checks operational-company state. The existing source action remains unchanged.

CLI-created forward `20260924013820_document_reference_context.sql` materializes only the established `documents.read` registry row with conflict-do-nothing and zero assignments. It adds private forced-RLS immutable attempt/outcome/witness and producer-epoch tables. No published migration or generated type/schema artifact was edited. The CLI created the file successfully; its subsequent analytics traffic was rejected by automatic approval review. No retry or telemetry bypass occurred.

SQL independently rechecks active actor membership, effective triple permissions and operational company; authentic sealed source capture plus separate source witness; document and contract company; source object/agency/legal sender/receiver and environment; actual customer/site/point/grid-owner/tenant-identity/supply/contract links; and locked signed-PDF identity. Canonical `customer_contract_id` is required on the supply; conflicting non-null legacy `contract_id` is rejected. Site/point aliases must agree. A same-company unresolved graph gets an immutable unresolved attempt and unavailable outcome without Storage I/O. Foreign-document/actor/environment failures create no document attempt and disclose no foreign document metadata.

Each capture commits a new unresolved attempt before Storage I/O. The new bounded document helper uses the installed `.download(path, {}, {signal, cache:'no-store'}).asStream()` path; existing general downloads stay unchanged. It hashes incrementally, accepts at most 2,097,152 actual bytes through EOF, and aborts/cancels on the first overflowing chunk before hashing or retaining that chunk. The unavailable observation records the actual observed overshoot count; the eligibility cap is not a promise that the transport never delivers a final overflowing chunk. A fixed 10,000 ms operation deadline covers fetch and body, with a deadline race and monotonic deadline checks; late responses are discarded/cancelled. No PDF Buffer or duplicate PDF is retained.

Outcomes append separately with server-observed storage start/completion, actual byte count/hash, DB record time/xid and immutable predecessor association. SQL rechecks the graph at append; changed linkage downgrades to unavailable while preserving an actually observed hash. A later transaction witnesses only committed receipt visibility. It makes no assertion that the PDF existed at DB commit, continuously between observations, or historically from signing.

The source-scoped cutoff RPC returns raw sealed scope even with zero attempts, the durable incomplete producer epoch, bounded attempt/outcome/witness facts and MVCC visibility token. Thus an interruption before initial attempt commit cannot silently turn an affected source into complete history. Epoch activation does not select unrelated ordinary supplies. `readDocumentReferenceContext` keeps the materialized saved payload separate from new byte readback attempts and reports `document_reference_unavailable` on loss/incomplete witnessing or bounded truncation. Every result has `authority:none` and `coverage:incomplete`. Saved payloads are not rewritten; reconstructing another cutoff query has its own visibility token. Task 4 still owns persistent combined readsets and actual UTILTS hold consumption.

## Executed verification

All Node commands used `npx --yes node@22.23.2`.

| Check | Result |
|---|---|
| Initial bounded-reader test-first RED | 8 failures: new helper absent |
| Initial capture/action test-first invocation | Suite-load failure because new modules were absent; **not** a behavioral RED claim |
| Behavioral capture regression mutation | Replacing recorded receipt with unconfirmed produced 3 expected failed assertions / 11 passes; production restored in `finally` |
| Final focused GREEN | 64/64 tests in 5 files |
| `tsc --noEmit -p tsconfig.app.json` | PASS |
| `tsc --noEmit -p tsconfig.tests.json` | PASS after fixture nullability correction |
| `tsc --noEmit -p tsconfig.scripts.json` | PASS after explicit test-adapter cast correction |
| Scoped ESLint | PASS |
| `node scripts/check-migration-versions.cjs` | PASS: 612 files / 516 version groups |
| `git diff --check` | PASS |
| Genuine native PostgreSQL / Storage | **NOT EXECUTED**: local `psql` and Docker unavailable; mandatory parent CI gate |
| Generated schema/types and final ordinary CI | Parent-owned, pending authentic native artifacts |

Focused command: `npx --yes node@22.23.2 node_modules/vitest/vitest.mjs run __tests__/document-reference-bounded.test.ts __tests__/document-reference-capture.test.ts __tests__/ediel-correction-context-capture.test.ts __tests__/ediel-correction-context-hold.test.ts __tests__/customer-legal-document-package.test.ts`.

Scoped lint covers the document helper, new service/action/unit/native test files and native config. Existing npm `http-proxy` and experimental `EnvHttpProxyAgent` warnings were emitted. No full-suite or native PASS is inferred from focused mocks or static checks.

## Native evidence authored, not executed

Mandatory native config now includes `scripts/ediel-document-reference-native.test.ts`. It uses the real inbound sealed-source insertion/registration/witness, real SQL RPCs, canonical tenant graph and synthetic bytes in the isolated local private Storage bucket. Tests assert singleton active catalog keys and real effective actor permissions without fixture registry insertion; first-application/repeat registry execution preserves grants/metadata. Storage tests cover exact 2 MiB, +1 and bucket-valid 10 MiB; exact readback/hash; upsert false and row lock; null path; mismatch/loss; delete and replacement before outcome append, before witness and after witness; saved payload versus fresh unavailable observation. The online/admin cases preserve their actual snapshot schema names as synthetic context labels, not proof of having executed either signing producer.

Additional native cases cover missing individual permissions, foreign actor/document/environment, revoked isolated actor, customer/site/point/supply/party graph conflicts, direct access/mutation denial, different-transaction append/witness, interruption before initial attempt/outcome/witness and source-scoped durable incomplete coverage. Fault injection intercepts the narrow failing RPC only; successful surrounding operations remain real. Unit tests separately exercise ignored-cancellation fetch/body stalls, late result discard and action routing; these are **not** native storage/network proof.

Cleanup removes only owned synthetic direct grants and local Storage objects; legitimate synthetic administrators remain enabled. Immutable synthetic metadata/receipts remain in the disposable replay until teardown. No hosted database/storage write, market send, deployment, branch reset, push or subdelegation occurred.

## Limits and next gate

Reference identity never authenticates correction cause, signing origin, legal sender or positive process basis. Unknown historical retention remains incomplete. No new byte retention class exists. SQL/storage behavior and replay ordering must receive genuine CI qualification; the native suite was written/typechecked, not executed RED/GREEN. All future consumers must preserve source-scoped activation, raw/unwitnessed concerns and fresh revalidation; the pure correction hold was not changed. Parent owns independent reviews, publication, native artifacts and Task 3/4 integration.

Skills: approved-plan execution, TDD/test-quality guidance, Supabase/Postgres authorization/RLS guidance, installed Next server-action documentation and verification-before-completion. This bounded task did not require subdelegation, worktree changes, broad audit, UI work, optimization, dependency changes or reusable skill authoring.

## Fix round 1 — DR-R1 and actual transport stall qualification

FIX_BASE `07d3b9c5c1ebf5b537e20116e5daa4e801efcf64`. Addressed the independent review's DR-R1 projection defect in the still-unpublished owned forward: saved attempts now include their complete immutable captured document identity (including original null path, expected SHA and generation snapshot), attempt xid, outcome xid and persisted witness visibility snapshot. Existing record times, hashes, observations, cutoff and current-query visibility token remain distinct. This reads the original attempt facts, never current document metadata. The unit saved-payload oracle now carries an unavailable/null-path identity and receipt fields; the new native oracle completes that same row and appends a later verified observation, then checks that all original identity and receipt fields remain unchanged at the saved cutoff. Native SQL oracle authored before the projection change, but not executed locally; no SQL RED/GREEN claim.

Added two controlled loopback HTTP cases to the mandatory native file. They retain the actual installed Supabase Storage SDK and actual Node fetch/TCP implementation, use a dummy local-only client key, stall either response headers or the response body, and assert the fixed deadline, abort signal, server-side connection closure and rejection of a late response. Only selection of the Storage client is redirected; no Response, stream, timer or fetch result is mocked. No real Supabase credentials are sent to the loopback server. Native guard/config remains unchanged; no fabricated CLI status was used.

Round verification:

- Related focused suite: **64/64 in 5 files PASS**, using the same exact focused command above.
- Controlled transport-only run: **2 PASS / 35 deliberately skipped**, actual Node 22.23.2 + SDK + loopback network, 20.04 seconds test time. Command: `npx --yes node@22.23.2 node_modules/vitest/vitest.mjs run --config /workspace/scratch/4b1d39503015/task2b-transport.config.mjs -t 'native SDK aborts'`. The explicit scratch config selects only the existing native file and ordinary test environment setup, with no native status or DB connection; the production helper's actual Storage-client selection is routed to the dummy loopback SDK client in these two cases only. This is transport/runtime evidence, **not** real project Storage or PostgreSQL qualification.
- Scripts and tests TypeScript checks: PASS. Production TypeScript was not changed in this round; previous app typecheck remains the latest app result.
- Scoped ESLint on changed unit/native tests: PASS.
- Migration integrity: PASS, 612 files / 516 version groups. `git diff --check`: PASS.
- Full native PostgreSQL/project Storage, authentic generated artifacts and ordinary CI: **still unexecuted/pending parent CI**. In particular the new null-path SQL saved-cutoff oracle has not run.

Expected native count, authored rather than execution evidence: prior document suite **34** = 15 singleton cases + parameter groups 2 (origin), 3 (size), 3 (missing permission), 5 (graph), 6 (boundary × loss). This round adds 1 saved-identity case and 2 transport cases, giving **37 document cases**; local transport discovery also reported 37 total with 35 skipped. With retained **224**, mandatory native expectation is **261 cases across 5 files**. No broader test exclusions, runtime behavior changes, parent memory/audit edits or generated contract changes were made.
