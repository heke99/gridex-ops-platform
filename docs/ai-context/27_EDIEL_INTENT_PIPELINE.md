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

## Scope / follow-up

- Z03 supplier switch records an intent and stamps `intent_id`; full send-window /
  legal-basis / duplicate-active-switch gating is Batch 5 (`SupplierSwitchScheduler`).
- UTILTS, ESETT_XML, AcknowledgementEngine hardening, PRODAT support registry and
  AI/BI reconciliation are Batches 4–9 (subsequent commits).

## Commands

- `npm run build`
- `npm run typecheck`
- `npm run gridex:ediel-intent-pipeline-regression`
- Migration: `supabase/migrations/20260625110000_ediel_message_intents_foundation.sql`
  (applied to `gridex-ops-dev`; idempotent + additive).
