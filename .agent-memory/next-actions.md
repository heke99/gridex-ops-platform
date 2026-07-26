# Next actions

1. Apply all pending forward migrations in staging, ending with
   `20260727010000_contract_flow_integrity_completion.sql`.
2. Run the read-only production checks documented in
   `docs/contract-flow-integrity-2026-07-27.md`.
3. Prove rollback, idempotent replay and cross-tenant denial for creation,
   deletion, onboarding, activation and invoice export graph reservation.
4. Exercise missing and complete meter-value months and compare the exact
   supply/customer/contract/meter/period readiness evidence.
5. Run a signed Capway/Aptic sandbox acknowledgement and duplicate/out-of-order
   webhook against the same `customer_invoices` row.
6. Update the five legacy readiness fixtures with complete canonical identities
   without weakening production checks.
7. Deploy runtime and API docs, then verify live parity and portal invoice
   visibility for the correct customer/contract only.
