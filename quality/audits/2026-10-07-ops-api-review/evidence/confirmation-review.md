# Agreement confirmation bounded review — 2026-10-07

Scope: Gridex OPS at local HEAD 1aef94be4758260e134bdc195a69312901bf8cb2. Read-only review, synthetic probes. No source remediation or live signing/mail/Storage operations.

## Confirmed fresh P2: secure-link signing can lose automatic agreement confirmation before the outbox exists

Trigger: secure-link signing succeeds in the canonical finalization RPC, but the immediate post-sign receipt delivery fails before sendCompanyEmail (for example, transient archive Storage failure).

Observed: lib/customer-contracts/onlineSigning.ts:663 commits the signing RPC first; archiveSignedCustomerContractPdf at541 runs before the confirmation outbox call603. The catch at678–687 only logs and returns deliveryError. app/sign/contract/[token]/actions.ts:22 discards deliveryError and28 redirects to signed=1. page.tsx:164 tells the customer that the confirmation will be sent to their email address. No durable confirmation retry is created on this failure path. The contract is correctly signed; the defective consequence is an unconditional promise of subsequent email with no persisted email continuation after a prequeue failure.

Business impact: a legally signed agreement can have no agreement confirmation queued following a temporary archive/context error. Email outbox retries cannot help because its row was never created. Browser revisit alone loads the receipt and does not redeliver; manually repeating finalization could recover, but normal UI shows an already-signed result.

Proof: evidence/confirmation-signature.probe.ts invokes the real finalizeOnlineContractSignature and real signContractAction, mocks database and Storage/email ports, and injects archive failure. Two cases assert committed signed receipt, no email queue call and signed success redirect. Positive control asserts successful archive precedes exactly one tenant-scoped confirmation queue with attachment and stable idempotency key. The synthetic RPC represents a committed receipt; actual SQL commit behavior inspected, no genuine database transaction fault executed.

Independent refutation: staff_contract_review searched generic signed triggers and event subscribers. Current schema customer_contracts_signed_operation_v1 (schema.sql:145314) calls gridex_enqueue_signed_contract_operation_v1 (65113), but it only enqueues start_supplier_switch, needs_review or production lifecycle skip. automation.part-3.ts:350 routes that job to processSupplierSwitch, without agreement confirmation. gridex_record_customer_contract_event_v1 in migration20260727165000:285–319 emits contract.event.recorded to webhook, not email. No other caller of deliverSignedContractReceipt exists. The separate website customer_application_continuation flow is durable and is not implicated.

Targeted fix: persist a tenant-scoped receipt-delivery continuation atomically with signed finalization; let its worker archive the immutable PDF and enqueue confirmation/cooling-off using existing stable idempotency keys. Expose pending/failed mail state on the secure-link result. Keep a committed signature successful and keep signing itself independent of delivery failure.

## Validated good behavior and limits

Website API publicCheckoutResult keeps agreement_signed/thank_you_ready separate from confirmation pending/queued/sent/delivered/failed. Three existing public-checkout-result tests passed, including signed agreement with pending email and legal/customer action separation. customerApplicationCommunication.ts:460–538 reuses hash-bound verified archived PDF; missing bound archive fails closed. Its legalMailReady predicate requires signed status, signed_at, PDF attachment and persisted acceptance for each immutable legal version (contractLegalMailEvidence.ts). These guards were inspected; full website worker/real provider delivery was not executed in this bounded review.

Command: /tmp/gridex-api-review-node22/node_modules/.bin/node node_modules/vitest/vitest.mjs run __tests__/audit-temp-confirmation-signature.test.ts __tests__/public-checkout-result.test.ts
Result: 2 files, 6 tests passed, Node22; log evidence/confirmation-signature-tests.log. Temporary test copied to evidence then removed after completion. No live customer data read or email sent. Supabase current deployment trigger existence not rechecked by this agent; root's broader live metadata review has separate limits.
