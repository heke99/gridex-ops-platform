# Active decisions

## ADR-001 — One progress system

Status: VERIFIED

`.agent-memory` owns active progress. `docs/ai-context` remains domain and
historical documentation. `docs/ai-context/11_CURRENT_TASK.md` is superseded.

## ADR-002 — Single API-key tenant identity

Status: VERIFIED

The integration API key resolves tenant/company/client/scopes. No additional
required tenant environment variables are allowed.

## ADR-003 — Granular energy readiness

Status: VERIFIED

Pricing/quote readiness must not depend on PRODAT/switch dispatch readiness.
Facility lookup, switch creation and switch dispatch remain separate.

## ADR-004 — Supply activation transaction

Status: IMPLEMENTED_STATIC_VERIFIED

Only versioned `activate_customer_supply_v1` may complete a confirmed supplier
switch into an active supply/contract. Domain event and durable outboxes commit
in the same transaction; runtime must not recreate sequential completion writes.

## ADR-005 — Public resource IDs

Status: VERIFIED

Documented UUIDs are opaque tenant-bound public resource identifiers, never
authorization. Internal pricing/publication/identity/provider IDs are excluded
through explicit DTO allowlists.

## ADR-006 — One forward live repair point

Status: IMPLEMENTED_STATIC_VERIFIED

The noncanonical historical chain must not be replayed or mass-marked as
applied. Production convergence uses the single fail-closed
`20260728170000_live_schema_code_canonical_sync.sql` repair. Only that version
may be registered after green post-apply and lint. A new canonical baseline is
derived later from the verified post-apply schema.

## ADR-007 — One commercial selection model

Status: IMPLEMENTED_STATIC_VERIFIED

`gridex_contract_pricing_v6_selection` is the single contract pricing model
from admin authoring through public feed, website quote, internal customer
selection, signed snapshot and billing. Selection is server-resolved from
stable references. V6 paths may not reduce to compatibility scalars.

## ADR-008 — Quote/contract snapshot identity

Status: IMPLEMENTED_STATIC_VERIFIED

The immutable identity includes product/price-plan version, price option,
SE-area row when fixed, invoice delivery method, selected/mandatory/conditional
component references and exact resolved base/price component arrays.

## ADR-009 — Publication-bound price-option identity

Status: IMPLEMENTED_STATIC_VERIFIED

Every public price option is bound to one immutable publication version.
Templates may remain unbound, but publication materializes exact copies.
Customer type, default and selection-required are canonical columns, and array
position is never a selection rule. Quote, validate and application must assert
the same stable option, area, invoice, component and site-count identity.

## ADR-010 — Explicit public-contract serialization boundary

Status: IMPLEMENTED_STATIC_VERIFIED

Website and API Public Contracts responses use one explicit canonical DTO mapper. Public legal and price-option fields are rebuilt field by field; generic recursive database-object spreads/sanitizers may not decide the public contract. `is_default` is canonical and `default` is compatibility-only.

## ADR-011 — Exact locked legal bundle relation

Status: IMPLEMENTED_STATIC_VERIFIED

Published legal data and historical backfill may use only the exact company-owned locked `contract_publication_versions.legal_bundle_version_id`. First/latest/min/max inference is forbidden. Every module bundle ID must equal the top-level legal bundle version.

## 2026-08-05 — Group presentation, canonical module evidence

Customer-facing legal documents are grouped into agreement, POA and withdrawal.
Canonical module rows are never merged or deleted; they remain the immutable
version/hash evidence. A grouped acceptance is expanded to all covered modules.
POA scope and legal identity are immutable and may never be widened on reuse.
