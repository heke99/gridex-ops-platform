# Positive site continuation — bounded source correction and prepared native proof

Status: source correction independently reviewed; controlled source tests VERIFIED. Native positive chain IMPLEMENTED_NOT_VERIFIED (one prepared case, zero executed locally). No provider call, market activation, deployment or historical API artifact change.

## Concrete defect and correction

The current `processInboundResponse` consumes DB-owned exact Z02 evidence and calls `enqueueSupplierSwitchAutomation`. Its generic `processSupplierSwitch` path previously called `createSupplierSwitchRequest` without `contractId`. The creator binds both `contract_id` and `customer_contract_id` from that parameter; `prepareAndQueueProdatSwitch` requires an exact contract before Z03 generation and rejects a null binding. The website orchestrator's separate existing context does not repair this generic path.

`__tests__/customer-site-positive-contract-binding-20260930.test.ts` runs the actual producer while controlling only outer resource/readiness/create/start/event boundaries. Actual RED: two failures, exit 1; captured creator arguments omitted `contractId`, and a missing-PDF exact readiness outcome did not stop creation under the controlled start boundary. RED receipt: `/tmp/gridex-site-positive-contract-binding-red.log` (scratch, not a native receipt).

The narrow correction in `lib/customer-operations/automation.part-3.ts` checks actual current unified readiness only for a new request, propagates its exact blockers before request creation, requires a nonempty canonical `readinessSnapshot.contract_id`, and passes it to the existing creator. Existing open-request reuse still reaches `startSupplierSwitch` and its current revalidation. Earlier transient duplicate diagnostics remain outside durable lifecycle payloads. No public contract/source release changed.

GREEN: new two cases passed; five relevant controlled/static files passed 21/21. Scoped typecheck and scoped lint passed (the existing unused `duplicate` import warning in part-3 remains; zero lint errors). Independent requirements reviewer read the actual readiness/creator/start chain and independently ran 2/2 PASS, with no concrete bounded blocker. These controlled cases establish producer propagation and denial, not genuine signed-agreement or complete native behavior.

## Prepared genuine native chain

Owned paths:

- `scripts/customer-site-positive-continuation-20260930.native.config.ts`
- `scripts/customer-site-positive-continuation-20260930.native.test.ts`
- `scripts/customer-site-positive-continuation-20261001.fixture.ts` (shared real test-only preparation; no hooks or substituted production owners)

The config requires the existing disposable OPS CI stack, `CI=true`, `GRIDEX_NATIVE_STATUS`, `RUNNER_TEMP`, exact local API `http://127.0.0.1:54321` and its real keys. An unconfigured invocation actually failed closed before fixture execution (`site_positive_disposable_ci_required`, exit 1). This startup rejection is not a native pass. Local Docker/psql are unavailable; zero native cases have executed here.

The one positive case creates only unique synthetic local tenant/customer/site/actor/resources, retains every production database trigger, and:

1. After the actual signed agreement/PDF/POA and held routes exist, calls actual readiness to materialize the authorization chain, then `createCustomerInfoRequest` → `queueCustomerInfoRequestForDispatch` → `prepareAndQueueProdatZ01FromDataRequest` → RenderGateway/finalizer. It requires the genuinely produced outbound Z01 canonical rule pack/route/profile/application/source-operation context, immutable hash, prepared/queued state and null send time; reads the actual returned RFF+LI and verifies the real business-reference index. It inserts only a synthetic received Z02 returning that exact reference/expected variant and a fresh site request snapshot. No originating source, sent flag, business-reference index or successful result is forged. Inserting the real inbound job must generate all four success fields through the actual correlation/payload/freshness/atomic-apply database gates; the fixture never inserts forged success `result` fields. This is qualification of those DB gates and downstream continuation, not full receive/ACK/wire-guide acceptance.
2. Calls actual offer/pricing/legal materialization and internal channel publication RPCs, then the existing explicit invoice-test synthetic-signature helper, which calls actual prepare/finalize signature RPCs and records exact legal acceptances. It generates a real agreement PDF from those immutable legal documents and signature facts, archives it through the actual local Storage helper, downloads and hashes the real bytes, and binds the hash under the signed-contract guard. It is synthetic acceptance, not a real customer's signature or qualification of the entire online-signing delivery flow.
3. Supplies a test-only signed, exact contract/site/point POA with its accepted immutable legal document and signed scopes. Actual readiness materializes/verifies the operational authorization chain; a site-less mandate is not substituted.
4. Owns a unique synthetic electricity grid actor/identifier/area and local company routes. A freshly generated local self-signed public certificate has real parsed validity/fingerprint; its private key is removed immediately and never stored/logged. Local production readiness rows are approved, profiles remain `dry_run`, addresses are `.invalid`, and all network calls except this local Supabase origin are rejected. This proves local route configuration/readiness if executed; it does not qualify a production CA certificate, issuer enrollment or real traffic. Test routes are separately present because actual Z03 preparation currently defaults to `test` while unified customer readiness evaluates `production`; the case does not conceal that distinction.
5. Requires actual unified readiness `ready=true`, exact agreement/PDF/POA/scope and grid/route snapshots, then actual inbound consumer → its returned durable switch-job ID → actual supplier worker → actual Z03 preparation/queue. It asserts the resulting request's exact contract/site/point/POA/authorization links and persisted readiness. Signing also creates its own existing signed-contract job: the fixture retains that row, selects the exact Z02-returned job and holds all remaining own jobs in cleanup; it does not claim one universal job across both producers.
6. Requires the actual requested-switch lifecycle intent, runs the actual notification consumer/template/sender-readiness/communication-log/email-outbox path, then repeats that real consumer. It asserts one request, one switch-start notification intent, one queued email, one queued Z03 outbox, zero provider receipts, zero Z03 sends, zero active supply and unchanged queue effects after retry. No email/Ediel sender or supply activation consumer is invoked.

At suite completion, only remaining fixture jobs/email intents are cancelled and fixture Ediel outboxes are blocked, before later CI workers run. These cleanup writes are not application delivery/completion evidence.

Existing OPS command after local status/key exports, without a new workflow or external fixture:

```sh
npx vitest run --config scripts/customer-site-positive-continuation-20260930.native.config.ts
```

Expected pass markers, only when actually emitted by a successful genuine run:

```text
SITE_POSITIVE_PREREQUISITES_NATIVE_PASS
SITE_POSITIVE_CONTINUATION_NATIVE_PASS
```

## Original requirement boundaries

This addresses the implementable generic site/P6 continuation and supplies a positive real-runtime proof for the site/contract/legal/POA/route/status/notification dependencies relevant to T01/T02/T06/T09/T10/T20/T21/T22/T23/T24/T25/T38/T39/T50 and U04/U06/U18. No whole T/U item is accepted by the bounded unit result or prepared native case. Actual OPS native execution, exact-head artifacts and ordinary CI remain necessary; missing prerequisites alone are not declared final blockers for this local positive route.

The upstream supplier-request/preparation and newly atomic event/notification-intent transaction remain separate boundaries. The positive case's completed queue preparation does not claim atomicity of the entire business operation or a process-kill recovery proof. The current non-UTILTS inbound wrapper reaches `inboundBusinessStateMachineLegacy.ts`. Its formerly swallowed late required-notification failure was reproduced through that real wrapper; the separate candidate atomic source owner is still excluded until its own scoped gates/review/native qualification. This positive prepared-queue case does not certify that new transaction. That internal gap is not an external provider blocker. Existing `activate_customer_supply_v1` atomic welcome remains untouched.

Independent read-only publication/authority/SQL-shape review identified one fixture-only unsupported `communication_routes.environment` column. The narrow correction removes that argument and retains the actual `environment_type` (`bilateral_test`/`production`) value. Other route/profile environment columns remain real. Scoped TypeScript/lint remain required on these final bytes; no native pass is inferred from static review.

A subsequent SELECT-column trace caught the fixture's `ediel_messages.sent_at` reference; the actual timestamp is `message_sent_at`. Only that identifier was corrected. The independent initial SQL-shape review covered 35 INSERTs, not this SELECT; expanded read-only SELECT/UPDATE review is separate and does not imply genuine SQL execution. Native remains zero executed until OPS.

## 2026-10-01 enabled-owner correction and requalification

After the earlier static INSERT/SELECT reviews, an additional enabled-trigger trace found that the original fixture manually inserted a tiny outbound Z01 without canonical rule pack/route/profile/application/source-operation context. The actual `ediel_messages_canonical_contract_biu` trigger would reject it with `canonical_ediel_rule_pack_required`; the former synthetic `sent` status was also not a dispatch witness. Root excluded all five prior positive paths from the bounded publication and preserved their working bytes. The fixture is now refactored into the sixth shared test-only path above and invokes the genuine canonical producer instead. No trigger is disabled and no result/status/reference ownership is bypassed.

Independent read-only reviewer traced the actual producer/finalizer, service-only worker context, signed authorization prerequisites, initial exact site-linked meter identity and real incoming BEFORE hash/context → AFTER append-only source capture. Current Z02 correlation supports its exact linked prepared/queued Z01 without requiring a send timestamp. This is the actual Z02 policy, not authority to accept a switch from an unsent Z03. The reviewer found no new concrete blocker in that bounded trace; route/render/current full native SQL execution remains NOT_EXECUTED. Earlier column reviews qualify only the bytes reviewed; fresh final schema-shape/type/lint receipts are recorded at freeze.

Final six-path requalification: independent read-only review covered all 33 literal public INSERT column lists and 83 explicit SELECT/UPDATE columns across 17 queried tables on the genuine-producer fixture/native bytes; no missing canonical column remained. The inherited `auth.users` fixture shape is separate from generated public types. Scoped TypeScript on the final fixture/native and producer tests PASS; scoped fixture/native ESLint PASS with zero errors. Controlled producer 2/2 remains verified and the latest related unit batch passed 14/14 in four files. Final source freeze is six paths: the existing narrow part-3 producer, its new two-case test, native config, native test, this report and the shared 20261001 fixture. Full native remains zero executed and the former five-path package was excluded from publication until this requalification.
