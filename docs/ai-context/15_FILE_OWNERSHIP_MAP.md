# File Ownership Map

This file is the repo-specific map Cursor should use before opening broad parts of the codebase.

Use it to avoid scanning the full repo. Start with the smallest relevant section, then expand scope only when needed and document why.

## Ediel / ACK / EDIFACT

Relevant files/directories:

- `lib/ediel/ack.ts`
- `lib/ediel/ack/**`
- `lib/ediel/core/ackDecisionEngine.ts`
- `lib/ediel/core/ackPolicy.ts`
- `lib/ediel/core/ackPreflight.ts`
- `lib/ediel/core/edifactParser.ts`
- `lib/ediel/core/edifactSegments.ts`
- `lib/ediel/core/edifactSerializer.ts`
- `lib/ediel/core/edifactTokenizer.ts`
- `lib/ediel/core/edifactValidation.ts`
- `lib/ediel/core/messageBuilder/**`
- `lib/ediel/core/productionGuards.ts`
- `lib/ediel/core/runtimeDecision.ts`
- `lib/ediel/core/tgtAutoMatcher.ts`
- `lib/ediel/rulebook/**`
- `app/admin/ediel/**`
- `components/admin/ediel/**`

## PRODAT

Relevant files/directories:

- `lib/ediel/prodat/**`
- `lib/ediel/prodat.ts`
- `lib/ediel/prodatEngine.ts`
- `lib/ediel/prodatContext.ts`
- `lib/ediel/prodatPortalReadiness.ts`
- `lib/ediel/permissions/**`
- `lib/ediel/flows/prodatSwitch.ts`
- `lib/ediel/flows/prodatCustomerMasterdata.ts`

## UTILTS

Relevant files/directories:

- `lib/ediel/utilts/**`
- `lib/ediel/utilts.ts`
- `lib/ediel/utiltsEngine.ts`
- `lib/ediel/flows/utiltsDataRequest.ts`
- `lib/ediel/metering/**`

## Ediel transport, S/MIME, certificates, route and send readiness

Relevant files/directories:

- `lib/ediel/security/**`
- `lib/ediel/transport/**`
- `lib/ediel/transport/smime.ts`
- `lib/ediel/transport/encryption.ts`
- `lib/ediel/transport/smtpSender.ts`
- `lib/ediel/transport/mailPoller.ts`
- `lib/ediel/transport/routeResolver.ts`
- `lib/ediel/transportReadiness.ts`
- `lib/ediel/mailReadiness.ts`
- `lib/ediel/sendContextConsistency.ts`
- `lib/ediel/productionReadiness.ts`
- `lib/routes/**`
- `lib/routes/routeDecisionEngine.ts`
- `lib/routes/routeReadiness.ts`
- `app/admin/ediel/certificates/**`
- `app/admin/ediel/mail-readiness/**`
- `app/admin/ediel/routes/**`
- `app/admin/ediel/readiness/**`
- `app/admin/ediel/control-tower/**`

## Inbound mail, shared mailbox, polling and tenant resolution

Relevant files/directories:

- `lib/inbound-mail/**`
- `lib/inbound-mail/edielMailboxPoller.ts`
- `lib/inbound-mail/edielEmailParser.ts`
- `lib/inbound-mail/edielInboundProcessor.ts`
- `lib/inbound-mail/inboundTenantResolver.ts`
- `lib/ediel/tenant/resolveInboundTenant.ts`
- `lib/ediel/transport/inboundProcessor.ts`
- `lib/ediel/transport/dedupe.ts`
- `lib/ediel/transport/deadLetter.ts`
- `app/admin/inbound-mail/**`
- `app/api/internal/inbound-mail/cron/route.ts`

## System tests / AGT / TGT / actor testing

Relevant files/directories:

- `lib/ediel/agtEngine.ts`
- `lib/ediel/agtRegistry.ts`
- `lib/ediel/agtRuntime.ts`
- `lib/ediel/actorTesting.ts`
- `lib/ediel/actorTestingEngine.ts`
- `lib/ediel/systemTestPackages.ts`
- `lib/ediel/systemTestSettings.ts`
- `lib/ediel/testing/**`
- `lib/ediel/tgtAutopilot.ts`
- `lib/ediel/tgtEdifact.ts`
- `lib/ediel/tgtRegistry.ts`
- `lib/ediel/tgtTestData.ts`
- `lib/ediel/tgtTestDataFileImport.ts`
- `lib/ediel/tgtTestDataStore.ts`
- `app/admin/ediel/system-tests/**`
- `app/admin/ediel/agt/**`
- `app/admin/platform/actor-testing/**`

## Customer operations / onboarding / switching / powers of attorney

Relevant files/directories:

- `app/admin/customers/**`
- `app/admin/customers/actions.ts`
- `app/admin/customers/[id]/**`
- `components/admin/customers/**`
- `lib/customers/**`
- `lib/customer-contracts/**`
- `lib/customer-cases/**`
- `lib/onboarding/**`
- `lib/operations/**`
- `app/admin/operations/**`
- `app/admin/customer-info-requests/**`
- `app/admin/customer-cases/**`
- `app/admin/outbound/**`

## Billing underlay, import, export and BRP/eSett-ready areas

Relevant files/directories:

- `lib/billing/**`
- `lib/billing/exportCenter.ts`
- `lib/billing/importParser.ts`
- `lib/billing/meterValueBillingMatcher.ts`
- `lib/billing/partnerAdapter.ts`
- `lib/billing/pricingEngine.ts`
- `lib/billing/xlsx.ts`
- `app/admin/billing/**`
- `app/admin/billing/import/**`
- `app/admin/billing/export-center/**`
- `app/admin/billing/quality/**`
- `app/admin/billing/ai-parser/**`
- `app/admin/partner-exports/**`
- `app/admin/outbound/missing-billing-underlays/**`
- `app/admin/outbound/missing-meter-values/**`

## Platform usage / pricing / SaaS admin

Relevant files/directories:

- `app/admin/platform/usage/page.tsx`
- `app/admin/platform/analytics/**`
- `app/admin/platform/companies/**`
- `app/admin/platform/go-live/**`
- `app/admin/platform/security/**`
- `app/admin/platform/work-queue/**`
- `app/admin/pricing/**`
- `lib/platform/**`
- `app/admin/companies/**`
- `app/admin/company-settings/**`
- `app/admin/users/**`
- `app/admin/roles/**`

## RBAC / tenant / auth

Relevant files/directories:

- `lib/admin/accessModel.ts`
- `lib/auth/**`
- `lib/rbac/**`
- `lib/tenant/**`
- `lib/supabase/**`
- `types/rbac.ts`
- `app/auth/**`
- `proxy.ts`

## Database / migrations / regression scripts

Relevant files/directories:

- `supabase/migrations/**`
- `scripts/ediel-rule-regression.cjs`
- `scripts/ediel-production-readiness-regression.cjs`
- `scripts/ediel-routing-security-regression.cjs`
- `scripts/ediel-inbound-tenant-resolution-regression.cjs`
- `scripts/security-audit-rbac.mjs`

## Existing legacy docs to consolidate later

Do not delete these now:

- `docs/ediel-elbolag-live-runbook.md`
- `docs/ediel-operations-test-flow.md`

These overlap with ai-context and should later be merged into:

- `docs/ai-context/04_EDIEL_CORE_RULES.md`
- `docs/ai-context/14_VALIDATION_CHECKLIST.md`
- `docs/ai-context/18_SEND_READINESS_AND_ENVIRONMENTS.md`
- `docs/ai-context/20_DEBUGGING_PLAYBOOK.md`

## Large files to handle carefully

These files are known to be large and should not be refactored casually. If a task requires editing one of them, keep the change focused. If a split is necessary, preserve behavior, exports/imports, routes/actions and approved Ediel flows.

- `app/admin/customers/actions.ts`
- `app/admin/ediel/actions.ts`
- `lib/ediel/tgtEdifact.ts`
- `app/admin/customers/[id]/actions.ts`
- `lib/ediel/tgtRegistry.ts`
- `app/admin/ediel/system-tests/actions.ts`
- `lib/ediel/tgtTestData.ts`
- `app/admin/customers/[id]/page.tsx`
- `app/admin/customers/page.tsx`
- `lib/inbound-mail/edielMailboxPoller.ts`
- `lib/ediel/transport/index.ts`
- `lib/operations/db.ts`
- `lib/ediel/productionReadiness.ts`
- `components/admin/customers/CustomerEdielOperationsCard.tsx`
- `lib/ediel/utiltsEngine.ts`
- `lib/ediel/core/aperakErrorRuleRegistry.ts`
- `app/admin/ediel/system-tests/page.tsx`
- `lib/billing/exportCenter.ts`
- `lib/routes/routeDecisionEngine.ts`

Additional large files observed in this repo that should also be handled carefully:

- `app/admin/customers/[id]/document-actions.ts`
- `components/admin/ediel/EdielProductionProdatPanel.tsx`
- `lib/ediel/flows/utiltsDataRequest.ts`
- `lib/ediel/db.ts`
- `app/admin/ediel/system-tests/cases/[id]/page.tsx`
- `components/admin/ediel/EdielTgtWorkbenchPanel.tsx`
- `app/admin/ediel/certificates/actions.ts`
- `lib/onboarding/infoRequests.ts`
- `lib/ediel/core/tgtAutoMatcher.ts`
- `lib/ediel/portalTestCustomer.ts`
- `components/admin/customers/CustomerIntakeForm.tsx`
- `app/admin/operations/integrity/page.tsx`
- `lib/cis/db-data.ts`

## Rule

This map is guidance only. Inspect actual code before making changes. Start narrow, expand only when needed, and document why scope expanded.
