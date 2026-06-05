# Project Snapshot

## System overview

This repository contains Gridex, a production-oriented SaaS/multi-tenant platform for electricity retailers, energy service companies, Ediel operations and customer operations.

The system supports or is intended to support:

- customer onboarding
- company/tenant onboarding
- role-based admin access
- customer cards
- customer sites/anläggningar
- metering points
- powers of attorney/fullmakter
- supplier switching
- grid owner communication
- PRODAT
- UTILTS
- APERAK
- CONTRL
- UTILTS_ERR
- Ediel actor testing
- system testing
- production go-live
- encrypted S/MIME/CMS Ediel traffic
- inbound decryption
- shared mailbox polling
- tenant-safe message routing
- billing export handoff
- meter data collection
- audit logs
- operational dashboards
- Control Tower-style Ediel monitoring
- BRP/eSett/import file upload per tenant
- parsing and normalization of BRP/eSett/grid-owner/billing files
- billing underlay generation from imported data
- tenant usage statistics
- platform billing/pricing against electricity companies
- configurable platform usage prices
- audit trail for billing, imports, exports and manual overrides

The system is not required to be a full invoicing/reskontra/accounting system in phase 1, but it must generate reliable billing underlay that can be handed off to an invoicing partner or external billing system.

## SaaS principle

This system must be built as a reusable SaaS platform, not as a one-off Div3rsa AB system.

Div3rsa AB can be one tenant, one actor and one test subject, but the architecture must support multiple companies/tenants.

All sensitive operational flows must be company/tenant scoped.

## Tenant identity principle

A mailbox is only a transport channel.

Tenant/company identity must be resolved using:

- Ediel ID
- sender/receiver party
- subaddress
- environment
- route profile
- S/MIME/CMS recipient information where relevant
- EDIFACT UNB/UNH/NAD/RFF content
- configured actor settings

Never resolve tenant only from mailbox, UI selection or user-submitted company_id.

## Production principle

All Ediel/PRODAT/UTILTS/APERAK/CONTRL/UTILTS_ERR fixes must be production-safe and engine-based.

Avoid hardcoded:

- inbound IDs
- test run IDs
- message IDs
- metering point IDs
- test-specific timestamps
- one-off references
- actor-specific exceptions unless they are stored as configuration

## Billing domains

The system has two separate billing domains.

### End-customer billing underlay

This is data used by an electricity company to invoice its own end customers.

It may include:

- customer
- agreement
- site
- metering point
- consumption
- BRP/eSett/grid-owner data
- pricing rules
- fees
- VAT
- export to billing partner

### Platform billing against tenant companies

This is data used by Gridex/Div3rsa to invoice electricity companies for platform usage.

It may include:

- API access
- powers of attorney
- supplier switches
- cancellations
- agreement terminations
- billing underlay exports
- usage statistics
- configurable usage pricing

These two billing domains must be separated in code, database naming, UI and exports.

## Runtime / deployment principle

Production runs on Vercel.

Do not build production-critical logic that depends on local machine-only binaries or services.

For crypto, S/MIME, CMS, parsing, polling, routing and scheduled jobs:

- use server-compatible libraries/APIs
- avoid dependencies that require local CLI binaries unless verified on Vercel
- document required environment variables
- make failures visible in admin diagnostics

## Legacy docs to consolidate later

The following existing docs overlap with the new ai-context documentation and should be consolidated later. Do not delete them now:

- `docs/ediel-elbolag-live-runbook.md`
- `docs/ediel-operations-test-flow.md`

When consolidating, move relevant rules/checklists into:

- `docs/ai-context/04_EDIEL_CORE_RULES.md`
- `docs/ai-context/14_VALIDATION_CHECKLIST.md`
- `docs/ai-context/18_SEND_READINESS_AND_ENVIRONMENTS.md`
- `docs/ai-context/20_DEBUGGING_PLAYBOOK.md`

## Current major risk areas

- ACK family mismatch between generated CONTRL/APERAK and selected test suite/message family
- route profile mismatch
- sender/receiver subaddress mismatch
- encryption state mismatch between test run, outbound draft, message opening and SMTP send
- inbound decryption resolving wrong tenant/private certificate
- tenant leakage through shared mailbox
- breaking previously approved Ediel test flows
- UI showing confusing technical/family names instead of actual message types
- stale database assumptions
- missing RLS/tenant guards
- using positive APERAK when negative APERAK/UTILTS_ERR/CONTRL should be used
- sending unencrypted PRODAT when encrypted route is required
- missing billing underlay validation
- duplicate billing exports for same customer/site/period
- lack of audit trail for manual overrides
- technical UI that normal electricity company users cannot understand
- exposing raw Ediel complexity to tenant users
- mixing end-customer billing underlay with platform billing against tenant companies
- importing BRP/eSett files without tenant isolation
- using imported file data without row-level validation
- duplicate billing rows or duplicate platform usage events
- silently overwriting finalized billing exports
- hardcoded platform usage prices
- missing audit for price changes, imports, exports and billing adjustments
- exposing technical file parsing errors to normal tenant users without plain explanation
- relying on local binaries that do not run on Vercel

## Cursor usage

Cursor must not scan or rewrite the full repository by default.

Cursor must first read:

- 00_PROJECT_SNAPSHOT.md
- 01_CURSOR_WORKFLOW.md
- 11_CURRENT_TASK.md
- files relevant to the task

For Ediel-related tasks, also read:

- 04_EDIEL_CORE_RULES.md
- 05_PRODAT_RULES.md
- 06_UTILTS_RULES.md
- 07_ACK_CONTRL_APERAK_UTILTS_ERR_RULES.md
- 08_APPROVED_TEST_FLOWS.md
- 12_KNOWN_RISKS_AND_REGRESSIONS.md
- 13_OVERRIDE_PROTOCOL.md
- 14_VALIDATION_CHECKLIST.md
- 16_SECURITY_SECRETS_CERTIFICATES.md
- 17_MAILBOX_POLLING_AND_DEDUPE.md
- 18_SEND_READINESS_AND_ENVIRONMENTS.md
- 19_DECISION_ENGINE_RULES.md
- 20_DEBUGGING_PLAYBOOK.md

For database/RLS/multi-tenant tasks, also read:

- 03_DATABASE_RLS_TENANT_RULES.md

For UI/UX tasks, also read:

- 09_UI_UX_RULES.md
- 21_UI_OPERATIONS_AND_BILLING_UNDERLAY.md

For BRP/eSett/import/billing tasks, also read:

- 21_UI_OPERATIONS_AND_BILLING_UNDERLAY.md
- 22_BRP_ESETT_FILE_IMPORTS.md
- 23_PLATFORM_BILLING_AND_USAGE_PRICING.md
