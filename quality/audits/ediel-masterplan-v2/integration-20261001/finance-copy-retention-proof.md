# DB05 / E035 actual finance-copy classes

This implements sixteen independent actual stored body classes. It does not approve DB05, any legal retention duration, a production purge, or the masterplan.

| Native class | Actual source and retained identity |
|---|---|
| billing_underlay_source_body | gridex_billing_source.underlay_bindings.source_basis; original source_basis_hash, exact kWh, underlay/company/finalized identity retained |
| billing_underlay_payload_body | billing_underlays.payload / pricing_snapshot; all period, contract, point, supply, money, price and source identifiers retained |
| invoice_calculation_body | customer_invoices.raw_payload / metadata / calculation_snapshot / portfolio_settlement_snapshot; money, status, identity and original calculation/settlement hashes retained |
| invoice_line_body | customer_invoice_lines.description / metadata; invoice/customer/quantity/prices/taxes retained |
| invoice_export_item_body | invoice_export_items request/response/error/status payloads and metadata; financial amounts, idempotency, provider/underlay/run/customer identity retained |
| invoice_export_run_body | invoice_export_runs.readiness_snapshot / metadata; original native billing month and run identity/counts/amounts retained |
| invoice_provider_event_body | invoice_provider_events.payload; actual matched export item, provider event/idempotency identity retained |
| invoice_purchase_event_body | invoice_purchase_events.payload; linked item, purchase/fee/deposit/recourse scalars retained |
| invoice_document_provider_body | invoice_documents.provider_payload; provider document and Storage path identity retained; physical PDF bytes are a separate class |
| invoice_dead_letter_body | invoice_dead_letters.payload / error_message; linked attempt/item/run and status retained |
| invoice_export_attempt_body | invoice_export_attempts.response_excerpt; original request hash, attempt/idempotency/time/outcome retained |
| billing_export_item_body | billing_export_run_items payload, invoice/site address, preparation and adapter snapshots; parent/source IDs and native period retained |
| partner_export_body | partner_exports payload / response_payload / partner_response_log; source and provider identity/status retained |
| settlement_calculation_body | portfolio_monthly_settlements.calculation_snapshot; exact period, revision, original producer hash, money/status/actors/clocks retained |
| settlement_audit_body | portfolio_settlement_audit_log.old_values / new_values / reason; immutable audit identity, period parent, actor/action and original calculation hash retained |
| settlement_invoice_binding_body | portfolio_settlement_invoice_bindings.settlement_snapshot; native underlay/invoice/settlement, original hash/idempotency/bind identity retained |

The migration resolves the actual source period through native underlay/invoice/item/run/settlement relationships. Missing qualified billing bindings and missing native periods remain held. Known foreign embedded customer/contract/message/company references are rejected; free text/aggregate copies conservatively include the actual company's entire customer, supply, invoice, export and unfinished-attempt graph. Policy JSON cannot supply a closure flag or override that graph. The SHA-256 of the entire actual row, body and current graph bind separate policy/review decisions. Original producer hashes retain their original codec and are not rewritten as the new copy hash.

Each class requires its own explicit class grant plus operation grant, actual current actor/company membership and current DENY checks. An authenticated read-only actor can inspect metadata and original decision bytes but cannot mutate. Separate actual current review, original document/HMAC with current issuer qualification, exact native period, finite retainUntil and separate finite journalRetainUntil/purpose are required. No durations, default policy, global allow or automatic cascade are provided. All source periods and included operational scopes must be closed before redaction. Current grant/reviewer/issuer revocation and graph changes hold the operation.

A native tombstone authorizes exactly the OLD-row SHA and NEW-row marker transition; only body columns change. Existing immutable guard bindings preserve their original owner/security/config and all other rejection logic. The existing settlement audit function keeps its OID/owner/ACL and skips only that qualified OLD/NEW redaction, avoiding a new copy of the removed OLD body; ordinary financial audit remains enabled. Late audit failure rolls back the tombstone, body write and event. The separate class event and original hash/identity/purpose receipt remain. Replay returns the same immutable tombstone before attempting to requalify destroyed bytes; it does not restore the bytes.

Fresh native invoice/export writes and portfolio correction/bind/attach consumers check actual consumed sources, with existing accepted replay branches preserved. The two narrow TS consumers gate actual invoice preparation and approval/provider entry. An independent new underlay remains usable; an older unrelated customer tombstone does not prohibit it. Availability predicates grant no source, legal, market or provider authority.

## Actual evidence and limits

- Read-only authentic Supabase CI350 schema artifact: `authentic-replay-35016282-clean/rem002-schema-snapshot/schema.sql`, SHA256 `6cf9ee2d85a68066df9718f6e9a3b272ac16571f4757640a4b95c19f640294fe`. All sixteen actual table families and **35 body columns** match native jsonb/text. Native parent selectors, underlay date columns and invoice run month columns were checked from that generated DDL. This is actual ancestor schema evidence, not final candidate replay.
- `__tests__/ediel-finance-retention-http.test.ts`: **6/6 PASS**, scoped actor/company, hostile overrides, read-only denied mutations, invalid bytes, native hold and completeness/selector validation.
- `scripts/ediel-finance-copy-retention-sql-regression.mjs`: actual new migration/functions execute in PGlite. All sixteen exact class source/period resolutions, separate policies/reviews, qualified redactions and immutable metadata preservation PASS. No issuer, missing billing source, same reviewer, current class DENY, late audit rollback zero effects, private app-role forging, replay/no restoration and independent/new versus consumed-source controls PASS. Schema/Auth bridge/qualified normalized-meter billing provenance/financial fixture source/issuer are explicitly **synthetic boundaries**, not full Supabase, native owner replay or legal approval.
- Scoped app/native dependency TypeScript: PASS; ESLint: 0; diff check: PASS.
- `scripts/ediel-finance-copy-retention-native.test.ts`: **three ordinary native scenarios constructed, UNRUN locally**. They inspect all installed table columns/ACLs and use the real manual financial draft→calculate→review→approve→lock producer, actual company-bound delegated grant owner, real GoTrue clients and scoped HTTP for two independently redacted settlement snapshot/audit classes, unchanged hashes/scalars/no recopy, current reviewer DENY, hostile scope and native final-write rollback. Signed contract/PDF/POA helper stops before the first market original. Only test-local public internal pricing inputs, temporary grant-issuer competence and legal HMAC issuer configuration are synthetic. No private accepted/ready/source/retention rows are seeded.
- Ordinary native config root must include `scripts/ediel-finance-copy-retention-native.test.ts`; local Docker/psql unavailable. Final exact-head clean+upgrade/schema/types/fingerprint, native/HTTP, browser, build and CI receipts remain pending.

## Explicit remaining copy scopes

Physical `customer_invoice_documents`, `invoice_documents.storage_path` and invoice PDF paths require separate exact source-bucket/path/hash Storage delete admission, authenticated JWT deletion, actual bytes-before verification, HTTP 404 readback and native finish/replay. JSON redaction does **not** claim their bytes were deleted. That internal implementation follows in a separate packet. Finance decision-original document bytes (`gridex_ediel_retention.finance_decisions`) also require the separate decision-evidence class owner; Transport owns an additive forward after this packet, without cascade.

Other standalone source/journal data (normalized-meter history, private correction-journal reference-only rows, settlement estimates and immutable spot-price/provider source evidence) is inventoried separately; this catalog does not authorize a blanket table purge. No actual external legal policy or real customer/source/issuer approval is claimed by a synthetic probe.

New forward `20261001070000_ediel_finance_copy_class_retention.sql` depends on the actual installed process-node decoder/native Auth bridge and Transport's explicit class/session whitelist extension at 20261001064500. Historical migrations, generated artifacts, operational tenant guards and grants remain unchanged.
