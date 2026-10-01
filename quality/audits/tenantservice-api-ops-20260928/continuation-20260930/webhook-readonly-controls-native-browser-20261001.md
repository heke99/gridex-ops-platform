# U09: prepared genuine webhook controls replay

Date: 2026-10-01. This separate packet adds one native fixture/config, one real Next browser spec, one actual PostgreSQL-core precision proof and this report. The independently reviewed production four-file packet remains frozen under `/tmp/gridex-webhook-readonly-controls-production-frozen-20261001.json`. No existing action, shared fixture/config, workflow or frozen page inventory is changed.

**Native executed: 0. Browser executed: 0.** Local Docker/psql and a Chromium runtime are absent. Three browser cases were discovered successfully; discovery and type/lint gates are preparation evidence only. Pending DOM, actual Next action transport and durable native effects remain OPEN until the disposable CI execution and independent postcheck succeed.

## Prepared real effect path

The seed uses actual local GoTrue `auth.admin.createUser` and `signInWithPassword`, active Auth/profile/membership/role rows and real `canonical_authenticated_tenant_context` calls. It creates an independent A writer/reader, a paused C writer, and a foreign B webhook graph. Ordinary membership is `owner`; only the reader lacks `integrations.write`. Real selected-company cookies point at each actor's own company. Synthetic `.invalid` endpoints and payloads contain no actual customer data.

Each separate native context probe signs out only its own newly created session with `{ scope: 'local' }` and requires a successful cleanup receipt. Source review of installed Auth-JS confirmed that default `signOut()` is global; that initial prepared call would have revoked the browser's independent session during the permission-loss phase. The local scope correction preserves the intended live-session/current-permission witness. This is a prepared fixture correction, with no actual Auth execution claimed here.

Before creating its resources, the fixture captures full canonical row SHA-256 fingerprints for twelve existing customer/contract/underlay/pricing/invoice/export/purchase tables and every original Auth user/profile. The fingerprint is computed inside PostgreSQL over the ordered canonical aggregate text before JavaScript parses the returned digest; numeric/bigint precision is preserved. After preparation it verifies these bytes are unchanged while excluding only its genuinely new Auth IDs. The new actors' identity/profile fields, all three owned webhook rows, subscriptions, source events, outbox rows and audits are separately snapshotted. Auth login/session activity is not misrepresented as an unchanged full new-Auth row: stable identity metadata, confirmation, ban/delete state and the whole new profile are compared.

Independent reviewers `ci_evidence` and `portal_address` found that the initial prepared implementation hashed already parsed PostgreSQL JSON in JavaScript. An actual PGlite/PostgreSQL-core suite extracted that owned implementation and reproduced **3 RED / 3 controls PASS**: a bigint change from 9007199254740992 to 9007199254740993, a numeric change below double precision, and the same large-number change inside JSON all retained the old digest. The corrected native helper now produces SHA-256 in PostgreSQL. The final same six meaningful cases execute the exact current SQL generator extracted from the native source: **6/6 PASS**, including insertion-order stability, confirmed-empty digest and missing-relation rejection. This core SQL evidence does not execute Auth, a full native schema or a browser.

Subscriptions are paused and deliveries are failed with retry date 2999. The spec never invokes test-event or resend. Browser traffic to non-loopback hosts is aborted. No fixture provider transport is installed, weakened or invoked.

| Prepared actual case | Required result and independent evidence |
| --- | --- |
| Real current reader and paused writer | Exactly three actual rendered mutation controls disabled, three current read-only notes, current-company hidden fields, foreign resource IDs absent, failed-filter navigation retains controls, zero action requests |
| Writer's real ignore form pending; native current write grant revoked after initial writable page | Actual pending label/disabled/`aria-busy` state while the real request is held; update only that fixture role's write permission effect to `deny`; real canonical current context confirms loss; released action response is an actual RSC `Forbidden`, with unknown-action/module/build failures excluded; restore original allow effect and verify the complete original/owned graph and identity unchanged |
| Fresh authorized writer's real ignore, then real reader replay | Exactly one captured generated Next action request and pending lock; actual success redirect and persisted `skipped` row on reload; same captured path/action/multipart body replayed under genuine reader cookies returns actual RSC `Forbidden`, with no success redirect or unknown-binding acceptance |
| Independent native post-browser phase | Exactly one A delivery changes only status/manual-status/manual-note/update-time; exactly one matching actor/company/entity ignore audit; B and paused C rows identical; all source events/subscriptions/outbox, existing audits, original finance and Auth/profile/owned identity fingerprints unchanged |

The replay uses the real compiler-generated action ID and original exact path; no exported action is substituted by a fake endpoint. The permission-loss phase invokes the native config as a separate Node process, with the same private fixture and current local GoTrue/database. It records no credentials or raw request body in uploaded evidence. Only sanitized Boolean/request-count metadata and screenshots are attached. Exact `Forbidden` in the RSC response is a witness for the existing actual Next **development** server started by the shared default Playwright config. Production normally masks server errors and needs a different witness; production-message behavior is not qualified or claimed by this spec.

The permission-loss phase's native graph assertions occur before any permitted ignore. The restored current grant is necessary before the succeeding ignore test. Browser retries are disabled and tests are serial; the final phase requires exactly one allowed mutation/audit, so an accidental duplicate or unauthorized replay effect cannot be hidden by a loose count.

## Actual loader prerequisite, unresolved until native

The seed executes the unmodified production `listWebhookSubscriptions` and `listWebhookDeliveries` through real local PostgREST and requires each exact owned ID. It must not qualify an empty page as successful read-only controls. The current reconstructed `supabase/schema.sql` lacks `webhook_subscriptions.api_client_id`, and `20260821103000_customer_identity_consistency_and_webhook_readiness.sql` explicitly acknowledges that reconstructed legacy absence. Both existing loader projections refer to that field; subscriptions also embed the API-client relationship. A native seed may therefore fail its exact loader prerequisite. This is a precise prepared execution risk/source discrepancy, not a proven current native failure or cross-tenant exploit.

The fixture does not add columns, relations, grants or fake loader rows to obtain a green browser result. If the actual history replay lacks those relations, the seed must fail and the existing loaders/schema need a separate authorized correction and proof. Read-only production SSR evidence remains bounded to its controlled loader adapter and is not promoted by this preparation.

## Commands and private environment

Required: `CI=true`, `RUNNER_TEMP`, `GRIDEX_NATIVE_STATUS` from the existing local Supabase status JSON, a fresh `GRIDEX_WEBHOOK_UI_FIXTURE_PATH` beneath `RUNNER_TEMP`, and `GRIDEX_WEBHOOK_UI_PASSWORD`. The status must identify `http://127.0.0.1:54321`; SQL is fixed to `127.0.0.1:54322`. All real credentials and fixture snapshots stay private; none are workflow artifacts. Do not set `GRIDEX_E2E_BROWSER_BASE_URL`.

```sh
GRIDEX_WEBHOOK_UI_FIXTURE_PHASE=seed node node_modules/vitest/vitest.mjs run --config scripts/webhook-readonly-controls-20261001-native.config.ts
GRIDEX_WEBHOOK_UI_LOCAL_E2E=1 node node_modules/@playwright/test/cli.js test e2e/browser/webhook-readonly-controls-20261001.spec.mjs --config playwright.config.mjs --project=chromium --retries=0
GRIDEX_WEBHOOK_UI_FIXTURE_PHASE=post-browser node node_modules/vitest/vitest.mjs run --config scripts/webhook-readonly-controls-20261001-native.config.ts
GRIDEX_WEBHOOK_UI_FIXTURE_PHASE=cleanup node node_modules/vitest/vitest.mjs run --config scripts/webhook-readonly-controls-20261001-native.config.ts
```

Use the repository's required Node 22 PATH prefix. The existing browser config starts the actual local Next server with real Supabase public/server env from the existing workflow. The two intermediate `revoke-writer` / `restore-writer` phases are invoked by the browser spec. Cleanup removes only exact owned delivery/subscription/event/outbox IDs; synthetic company/legal history and Auth actors remain until full disposable-stack teardown. No company is cascade-deleted to remove published legal evidence.

Local PostgreSQL-core command:

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules node --test scripts/webhook-readonly-controls-20261001.fingerprint.postgres.test.cjs
```

Local preparation gates: scoped ESLint exit 0; focused native/config TypeScript exit 0; browser/core JavaScript syntax exit 0; browser list discovers **3**, executes **0**; whitespace check exit 0; actual PostgreSQL-core precision proof **6/6 PASS**. The CJS proof is ignored by ordinary repository lint patterns; its explicit `--no-ignore` gate passed after the required standalone CommonJS imports were documented in a file-local import-rule exception. No native mode was invoked here. No provider, invoice, delivery-success, physical document or whole-U09 qualification is inferred.

| Prepared source path | SHA-256 |
| --- | --- |
| `scripts/webhook-readonly-controls-20261001-native.config.ts` | `39e26275468b258c369a0f253ea5f1af2f3791265297f02484b7b7bd4cf9e922` |
| `scripts/webhook-readonly-controls-20261001-native.test.ts` | `79a6e7bec31bd53e8992a19803dcb1f3586728fd5e5a0bfedd11cc856eb2a0c7` |
| `e2e/browser/webhook-readonly-controls-20261001.spec.mjs` | `821e61b0c2263fa4b8416eb1b80e6535c68b4879d1a7dc6da0cafe763f2f5a1a` |
| `scripts/webhook-readonly-controls-20261001.fingerprint.postgres.test.cjs` | `9ca17b664b8e6008233bfafdbc3c59150ad96b6b110d32e421e07432f397b44f` |

This report is the fifth prepared path. Its final hash and exact manifest are supplied separately to root after bounded independent review. Production sources remain frozen separately.

Final independent `portal_address` read-only review of current source and PostgreSQL-core execution: **6/6 PASS**. The reviewer confirmed the actual source SQL generator hashes in PostgreSQL before parsing, the local-only probe sign-out preserves the separate browser session, the loader prerequisite remains fail-closed, and the selected cookie/generated-binding/serial exact-one postcheck are coherent. No further concrete bounded blocker found; no reviewer Auth, full native or browser execution or source edits. The known loader/schema prerequisite remains unexecuted. All source/test hashes above are final for this prepared freeze.
