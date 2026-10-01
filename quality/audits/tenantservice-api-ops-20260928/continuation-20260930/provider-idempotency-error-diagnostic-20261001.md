# Provider-event and write-idempotency diagnostic boundaries

Date: 2026-10-01. Root authorized this separate successor after eighth candidate tree `077bcab` was immutable. The earlier provider atomic command, tenant-fair claims, correlation packages and their receipts remain unchanged. This packet advances two concrete T51/P7 diagnostic boundaries; it accepts neither requirement in full.

## Actual failures and correction

The actual exported `processPendingInvoiceProviderEvents` previously classified any five uppercase/digit characters as a database code and any sufficiently short `provider_*` message as a safe reason. A free synthetic customer code `KARIN` became `provider_event_database_KARIN`; a free provider-prefixed customer/credential canary became the event's failed `failure_reason` and returned reason. If the secondary current-token failure write also failed, the same free provider message reached its console log. This is an executed local diagnostic-projection failure, not evidence of a hosted disclosure or provider traffic.

The actual exported `failIntegrationWriteIdempotency` also copied an unrestricted database `code` into its returned-error and thrown-error console corridors. Both emitted a synthetic customer/credential canary even though the current company/record/status predicates and false result remained correct.

The initial eight-case scratch run produced **5 genuine RED / 3 controls PASS** at **07:14:41 Europe/Berlin (+02:00)**. The final nine-case suite was then run against byte-exact actual pre-edit modules from tree `7235e532de9afa4282cdfdcfd71246d206fe4fb8`, with only those two module aliases redirected into scratch: **the same 5 RED / 4 controls PASS**, at **07:25:54 Europe/Berlin (+02:00)**. Those pre-edit bytes also exactly match immutable eighth tree `077bcab`. No production rollback or canned old output was used; overlapping baseline runs are not added as unique cases.

The provider normalizer now uses the frozen strict technical namespace while retaining its existing genuine SQLSTATE `provider_event_database_*` form. PostgREST and transport codes use `provider_event_persistence_failed`; a five-letter transport code does not establish a SQLSTATE category. Only the two exact internal JavaScript failure messages, `provider_event_identity_incomplete` and `provider_event_atomic_result_invalid`, pass through. A general `provider_*` spelling establishes no safe classification.

The private write-idempotency code helper now accepts only an exact code from the frozen technical namespace. The claim path still requires the exact string `23505`: padded ` 23505 ` is not promoted into a collision/readback. The additional actual claim control verifies one insert attempt and the existing controlled store-unavailable result. Existing canonical hashes, key validation, completed/failed/replay behavior and company predicates are unchanged.

## Verification

Final new suite: **9/9 PASS**. Related union: **51/51 PASS across four files** at **07:25:31 process-local Europe/Berlin (+02:00)**, duration 4.92 seconds. Scoped TypeScript, ESLint with zero permitted warnings and scoped whitespace check exit 0.

The union executes the new nine cases, existing provider atomic-adapter seven cases, existing usage/idempotency ten cases and current website-checkout twenty-five cases. It preserves known SQLSTATE categories, the exact invalid-command reason, mapper/captured payload delegation and continued progress for the next claimed event. New controls also assert unchanged provider payloads, current event/company/processing-token/status predicates, the failed idempotency row's business payload, and successful/false writer outcomes. The known `23505` namespace remains authoritative only as the existing database conflict category; this proof adds no caller authority.

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run --config=/tmp/provider-idempotency-error-diagnostic-20261001/related.config.ts
NODE_OPTIONS=--max-old-space-size=1536 /tmp/ediel-toolchain/node_modules/node/bin/node node_modules/typescript/bin/tsc --project /tmp/provider-idempotency-error-diagnostic-20261001.tsconfig.json
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js lib/billing/providerEventProcessor.ts lib/integrations/writeIdempotency.ts __tests__/provider-idempotency-error-diagnostic-20261001.test.ts --max-warnings=0
git diff --check -- lib/billing/providerEventProcessor.ts lib/integrations/writeIdempotency.ts __tests__/provider-idempotency-error-diagnostic-20261001.test.ts
```

The temporary related config extends current root Vitest, includes exactly those four files and disables file parallelism. The scoped type config extends root, disables plugins/incremental and includes the actual new suite plus transitive source. The standard new-suite command is `node node_modules/vitest/vitest.mjs run __tests__/provider-idempotency-error-diagnostic-20261001.test.ts`; the existing seven provider cases also retain their dedicated `scripts/provider-order-continuation-20260930.config.ts` command.

## Preserved behavior and limits

Only imports/private diagnostic classification change. Provider claim tokens, atomic SQL delegation, item/financial/document payloads, current company/status predicates, failure-write ordering and next-event continuation remain unchanged. Idempotency's actual insertion, hash, row state, business error-code payload, completion and failure behavior remain unchanged. No previous event, invoice, document, request or diagnostic row is rewritten. Whole-file differential review bounds the change to those private regions; the already frozen technical helper remains SHA `604fb35cdf12fc69e15733b350a6f7d6c5310e8f48dfcf11ace1a49158436530`.

The suite uses declared outer memory Supabase RPC/persistence adapters and a positive outer worker-readiness adapter. The actual exported workers, existing mapper, per-event catch/continuation, token-bound failure query and idempotency helper execute. It does not execute native SQL/RLS/session authority, hosted API/Auth, browser, provider transport or external enrollment policy: all such execution counts are **0**. The immutable graph guarantees of the atomic provider command keep their separate existing native/core receipts; this packet supplies no new financial or document-byte receipt. Unknown callback business metadata, other log callers and top-level generic telemetry fields remain separate internal inventory boundaries.

## Frozen manifest

| Path | SHA-256 |
| --- | --- |
| `lib/billing/providerEventProcessor.ts` | `cea1f4915cd4c91ede506712a5d1baca2ce3d1be40a9b5f9dd7a1053c9936568` |
| `lib/integrations/writeIdempotency.ts` | `9ea216cd056503af1229578a18480fb01b037c7e161ac5c7c34970b72e15c3fc` |
| `__tests__/provider-idempotency-error-diagnostic-20261001.test.ts` | `1176cdd651bb71e00a97383bdadb3663e65795542247a72c49323fabbefff9e7` |

This report is the fourth file; its hash is sent separately. Pre-edit processor SHA is `ea9afdf0f517a806dd8e30f54e9d78a2de8620e72531e507fb4252150fa5cbcb`; pre-edit idempotency SHA is `cd74b05711598d98c5a84d54b1d288c425552dfa44fcf88b661cfea468ef5985`. Source/test bytes are frozen for bounded independent review. Root alone owns index/ref/publication and whole-head acceptance.
