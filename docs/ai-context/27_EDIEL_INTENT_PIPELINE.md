# Ediel Message Intent Pipeline (Phase 1: Batches 1–3)

This document is the evidence matrix and architecture note for the mandatory
`EdielMessageIntent` pipeline that now sits in front of all outbound Ediel
rendering/sending. It is extended per batch.

## Architecture

Business process → `createEdielMessageIntent` (EdielMessageIntentEngine) →
validation gate (required metadata + no-placeholder + Application Reference
policy + tenant scope) → `RenderGateway` (only sanctioned caller of renderers) →
existing canonical finalize/queue chain → `ediel_messages.intent_id` /
`ediel_outbox.intent_id` → transport.

Business processes (customer-operations) create intents only. They must never call
`renderProdat26A`, `buildEdifactEnvelope`, UTILTS/XML renderers or the outbox
directly.

## Key modules

- `lib/ediel/intent/types.ts` — `EdielMessageIntent` model.
- `lib/ediel/intent/intentEngine.ts` — create/validate/idempotency/lifecycle.
- `lib/ediel/intent/noPlaceholderGuard.ts` — forbidden identifier tokens.
- `lib/ediel/intent/applicationReferencePolicy.ts` — policy-driven Application Reference.
- `lib/ediel/intent/renderGateway.ts` — validated-intent → render → queue bridge.
- `lib/ediel/intent/renderers/facilityLookupZ01.ts` — sanctioned PRODAT Z01 renderer.
- `lib/ediel/intent/tenantStatusTranslator.ts` — plain Swedish tenant status.
- `lib/ediel/core/applicationReferenceResolver.ts` — policy resolver (route may declare, not override).
- `supabase/migrations/20260625110000_ediel_message_intents_foundation.sql` — table + `intent_id` links + RLS.

## Database

- `ediel_message_intents` — tenant-safe (RLS via `gridex_can_read_company` /
  `gridex_can_write_company` / `gridex_user_is_platform_admin`; service role write).
  Unique `(company_id, environment, idempotency_key)`.
- `ediel_messages.intent_id` and `ediel_outbox.intent_id` — nullable FK
  (`on delete set null`), indexed. Legacy/inbound rows keep `null`.

## Evidence matrix (implemented/changed rules)

| Family | Code | Segment/Tag | Qualifier | Status | Rule | Source | Module | Regression |
|--------|------|-------------|-----------|--------|------|--------|--------|------------|
| PRODAT | Z01 | LIN | object id | conditional | Object id omitted (never `UNKNOWN`) when facility/MP unknown; Z01 is address-keyed and does not require LIN | PRODAT 26.A Z01 customer-identity request; `PRODAT_CANONICAL_PROFILES` requiredSignals exclude LIN | `prodat/builders/generic.ts`, `intent/renderers/facilityLookupZ01.ts` | `gridex:z01-facility-no-placeholder-regression` |
| PRODAT | Z01 | NAD+IT | — | conditional | Installation party rendered address-only (no fabricated id/agency) when no object id | PRODAT 26.A | `prodat/render/segments.ts` | `gridex:z01-facility-no-placeholder-regression` |
| ALL | ALL | IDE/LOC/RFF/LIN | identifier | blocking | No `UNKNOWN/MISSING/N/A/PLACEHOLDER` identifiers; block or documented allowed-missing | PART 2.4 / PART 4 | `intent/noPlaceholderGuard.ts`, `intent/intentEngine.ts` | `gridex:z01-facility-no-placeholder-regression` |
| PRODAT | Z03–Z10 | UNB | Application Reference | blocking | `23-DDQ-PRODAT` required; route cannot override | PRODAT 26.A / `APPREF_DDQ_FOR_SUPPLIER` | `intent/applicationReferencePolicy.ts`, `rulebook/canonicalRules.ts` | `gridex:application-reference-policy-regression` |
| PRODAT | Z13/Z14/Z15/Z18 | UNB | Application Reference | blocking | `23-DGI-PRODAT` required; route cannot override | PRODAT 26.A / `APPREF_DGI_FOR_PERMISSION` | `intent/applicationReferencePolicy.ts` | `gridex:application-reference-policy-regression` |
| APERAK/CONTRL | — | UNB | Application Reference | blocking | ACK echoes/correlates original Application Reference | PART 3 | `intent/applicationReferencePolicy.ts` | `gridex:application-reference-policy-regression` |
| ALL | ALL | — | intent_id | blocking | Outbound message + outbox carry `intent_id`; new outbound starts as a validated intent | PART 2.2 / Batch 1 | `db.ts`, `outbox/createOutboxItem.ts`, `flows/shared.ts`, `flows/prodatSwitch.ts` | `gridex:ediel-message-intent-foundation-regression` |

## Allowed-missing rule

`Z01_FACILITY_LOOKUP_ALLOWS_MISSING_IDENTIFIER = true` in
`intent/renderers/facilityLookupZ01.ts`. A facility lookup is the documented
allowed-missing case for the facility/metering identifier: the identifier is
requested from the grid owner, modelled as `null` + `payload.allowedMissing`,
never a placeholder string. If a real identifier exists on the site it is used.

## Phase 2 (Batches 4–5)

### Batch 4 — PRODAT support registry
- `lib/ediel/prodat/prodatMessageSupportRegistry.ts` is the one central truth for
  PRODAT support, derived from `PRODAT_CANONICAL_PROFILES` and reconciled with
  `ACTIVE_PRODAT_ENGINE_CODES` and `SUPPORTED_PRODAT_BUSINESS_CODES`.
- Each code has exactly one `supportStatus`
  (`full|inbound_only|outbound_only|test_only|manual_review|unsupported`),
  `businessProcesses`, `applicationReferencePolicyKey`, `fieldMatrixProfileId`,
  `requiredFields`, allowed sender/receiver roles.
- Z08 (rulebook profile, no engine builder) → `manual_review`. Unknown codes →
  `unsupported`. The intent gate blocks `manual_review`/`unsupported` PRODAT codes.
- `verifyProdatRegistryConsistency()` asserts registry/rulebook/field-rule agreement.
- Regression: `gridex:prodat-support-registry-regression`.

### Batch 5 — SupplierSwitchScheduler (Z03)
- `lib/operations/supplierSwitchScheduler.ts` computes the Z03 send window
  (`sendNotBefore` / `sendWindowOpensAt` / `sendWindowClosesAt`,
  `SUPPLIER_SWITCH_WINDOW_OPEN_LEAD_DAYS`) and the guards: send-window-not-open,
  duplicate-active-switch, unresolved-negative-ACK.
- Integrated as a hard gate in `startSupplierSwitch` (blocks before queueing Z03).
- Regression: `gridex:supplier-switch-scheduler-regression`.

## Phase 3 (Batches 6–7)

### Batch 6 — AcknowledgementEngine + AdminActionEngine
- `lib/ediel/ack/acknowledgementEngine.ts`: deterministic `classifyAcknowledgement`
  (CONTRL/APERAK/UTILTS_ERR/ESETT_XML_ACK) → single business effect
  (`continue|next_step|stop_automation|manual_review|noop`). Positive CONTRL = syntax
  OK (not business final); negative CONTRL/APERAK/UTILTS_ERR stop automation + admin
  action; positive APERAK drives next step; duplicate = no-op; unmatched/unknown =
  manual_review. `isExpectedAckOverdue` enforces the 30-minute ACK SLA.
- `lib/ediel/ack/adminActionEngine.ts`: structured, idempotent admin actions recorded
  on the Ediel message timeline (technical, superadmin-facing).
- Regression: `gridex:acknowledgement-engine-regression`.

### Batch 7 — UTILTS completion
- `lib/ediel/utilts/utiltsMessageSupportRegistry.ts`: one status per code
  (E66/E73/E31/S01–S07/E30/E72/E74/ERR). No partial unknown — unknown → manual_review/
  unsupported. Intent gate blocks unsupported/manual_review UTILTS codes.
- `lib/ediel/utilts/utiltsErrorReason.ts`: UTILTS_ERR reason engine maps the ACTUAL
  reason to a canonical error; identity/object reasons evaluated before
  period/quantity (never a generic fallback that overrides the cause).
- Removed hardcoded `environment: 'test'` / `testFlag: 1` from
  `buildUtiltsOutboundDraft`; environment/test flag now come from the resolved route.
- Regression: `gridex:utilts-completion-regression`.

## Phase 4 (Batches 8–9)

### Batch 8 — AI/BI reconciliation (no masterdata auto-overwrite)
- The AI/BI import engine remains reconciliation-only (writes only `ai_list_imports`
  / `ai_list_import_rows` / `ai_list_discrepancies`), never `customer_sites`,
  `metering_points`, `contracts`, `customer_contracts` or `supplier_switch_requests`.
- `lib/ediel/aiBiReconciliation.ts`: `AI_BI_PROTECTED_MASTERDATA_TABLES`,
  `assertAiBiNeverOverwritesMasterdata`, and `approveAiBiDiscrepancy` (admin approval
  with audit: resolution/resolved_by/resolved_at). Updates happen only after approval.
- Retention/GDPR metadata (`retention_until`, `gdpr_basis`) saved on import.
- Migration `20260625120000_ai_bi_reconciliation_approval_audit.sql` (idempotent,
  `alter ... if exists`). Regression: `gridex:ai-bi-reconciliation-regression`.

### Batch 9 — ESETT_XML family
- `lib/ediel/xml/esett/`: `schemaRegistry.ts`, `parser.ts`, `validator.ts`,
  `renderer.ts`, `acknowledgement.ts`. eSett/NBS XML is a separate family — not parsed
  as EDIFACT — with schema validation before outbox and the shared
  intent/route/outbox/audit/ACK lifecycle (ack family `ESETT_XML_ACK`). Unsupported
  document types go to manual_review. Regression: `gridex:esett-xml-regression`.

## Full regression suite

`npm run gridex:ediel-intent-pipeline-full-regression` runs all Batch 1–9 regressions.

## Known DB drift (informational)

The `ai_list_*` reconciliation tables and the eSett XML lifecycle exist in code +
migrations but the dev project `gridex-ops-dev` had not applied the original AI/BI
migration. The Batch 8 migration is `alter ... if exists` so it is a safe no-op until
the base tables are provisioned. No destructive action is taken.

## Commands

- `npm run build`
- `npm run typecheck`
- `npm run gridex:ediel-intent-pipeline-regression`
- Migration: `supabase/migrations/20260625110000_ediel_message_intents_foundation.sql`
  (applied to `gridex-ops-dev`; idempotent + additive).
