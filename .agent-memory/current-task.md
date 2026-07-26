# Current task

Last updated: 2026-07-27T17:20:00+02:00  
Branch: UNVERIFIED (uploaded archive excludes `.git`)  
Last verified commit: null

## Active phase

PHASE-28 — complete contract-flow integrity.

## Active work item

WP-028 — apply and transaction-test the canonical contract-flow integrity
migration in an authorized Supabase environment.

## Completed release scope

- cheap failure-isolated contract list and lazy single-offer diagnostics;
- strict explicit tenant selection and centralized TS/PostgreSQL role aliases;
- atomic contract creation result verification and canonical deletion command;
- legal-identity-only customer matching plus portal identity verification;
- same-customer contract/site/meter/supply/underlay/export/invoice invariants;
- confirmed-only canonical supply activation for every start event;
- blocked monthly underlays for missing meter values;
- exact company/customer/contract/meter/period invoice readiness;
- one monthly canonical `invoice_export_items` path;
- atomic run/item/draft-invoice reservation before provider send;
- idempotent provider updates of the same customer invoice;
- full customer portal invoice contract/export references;
- tenant-scoped lazy end-to-end admin tracing;
- aligned OpenAPI, deployment checks and rollback documentation.

## Verification performed

`npm run typecheck`, `npm run lint -- --quiet`, `npm run api:docs`,
`npm run db:migrations:check`, the 40-test contract suite and the 18-test
fixed-area suite pass. The focused customer/supply/billing suite passes 49/54;
five old readiness fixtures lack exact identity fields and now correctly
block. The new migration requires PostgreSQL application.

## Exact next action

Apply pending forward migrations in staging, ending with
`20260727010000_contract_flow_integrity_completion.sql`. Run the read-only
checks in `docs/contract-flow-integrity-2026-07-27.md`, then transaction-test
two-tenant creation, matching, activation, underlay, export, webhook and portal
visibility.

## Blockers

No local Supabase CLI, PostgreSQL/Docker runtime, provider credentials or
authorized remote database is available. Git provenance is unavailable.

## Do not repeat

Do not weaken exact readiness to satisfy legacy fixtures. Resume from database
apply verification and provider sandbox/production parity.
