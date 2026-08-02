# Ändrade och tillagda filer – runtime consistency 2026-08-02

## Databas och verifiering

- `supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql` – canonical access, multitenant role identity, platform access atomik, delivery uncertainty, active test environment identity och actor-test pass guards.
- `scripts/migration-history-manifest.json` – SHA-256 för den nya migrationen.
- `scripts/canonical-runtime-consistency-regression.cjs` – statisk regression för den nya härdningen.
- `scripts/sql/06_canonical_runtime_consistency_verification.sql` – post-apply verifiering mot PostgreSQL/Supabase.
- `package.json` – kommando `ops:canonical-runtime-consistency`.

## Canonical access och RBAC

- `lib/admin/platformUserAccess.ts` – gemensam klient för atomisk platform access RPC.
- `lib/auth/companyUserAccess.ts` – tenant access och invitation acceptance via canonical RPC.
- `lib/auth/companyInvitationFlow.ts` – tar bort direkta membership/role-writes och kompensation.
- `lib/tenant/companyUserRoles.ts` – canonical mapping mellan systemroll och membershiproll.
- `app/admin/users/actions.ts` – plattformsroller och overrides genom atomisk RPC.
- `app/admin/users/[id]/actions.ts` – användardetaljens roller och overrides genom atomisk RPC.
- `app/admin/companies/actions.ts` – canonical tenant role mapping och removal.
- `app/admin/company-settings/actions.ts` – canonical tenant access vid responsible-user update.
- `components/admin/companies/CompanyUserInviteForm.tsx` – tar bort temp password och separat membershiproll.

## Actor testing och evidens

- `lib/ediel/actorTestProjection.ts` – service wrapper för icke-auktoritativ canonical projection.
- `lib/ediel/actorTestingEngine.ts` – explicit tenant, canonical evidence för pass och canonical projection för andra statusar.
- `app/admin/platform/actor-testing/actions.ts` – inga direkta writes till legacyresultat.
- `lib/ediel/testing/selftest.ts` – self-test använder `completed`, inte authoritative `passed`.

## Route-, profil- och tenantresolution

- `lib/ediel/testing/agtRuntime.ts`
- `lib/customer-operations/z01Finalizer.ts`
- `lib/ediel/testing/testRunTransportMetadata.ts`
- `lib/ediel/config.ts`
- `lib/ediel/systemTestSettings.ts`
- `app/admin/companies/[id]/ediel-actions.ts`
- `app/admin/platform/go-live/[companyId]/route-wizard/actions.ts`
- `app/admin/ediel/agt/actions.ts`

Filerna ovan använder explicit tenantprioritet och failar stängt vid tvetydiga routes/profiler i stället för senaste-rad-vinner.

## Externa transporter och köer

- `lib/ediel/outbox/claimOutboxItems.ts` – canonical block/release RPC efter claim.
- `lib/ediel/outbox/sendOutboxItem.ts` – resend suppression, pretransport guard och delivery uncertainty.
- `lib/ediel/orchestrator.ts` – tar bort tyst best-effort reconciliation efter direkt SMTP.
- `lib/email/manualEmailOutbox.ts` – claim/pretransport guards och osäker leveransstatus.
- `lib/integrations/webhooks.ts` – deterministic delivery ID/body hash och osäker leveransstatus.
- `app/admin/webhooks/actions.ts` – dispatchfel loggas i stället för att sväljas.

## Dokumentation och verifieringsloggar

- `docs/canonical-hardening/IMPLEMENTATION_2026-08-02_RUNTIME_CONSISTENCY.md`
- `docs/canonical-hardening/VERIFICATION_2026-08-02_RUNTIME_CONSISTENCY.md`
- `docs/canonical-hardening/CHANGED_FILES_2026-08-02_RUNTIME_CONSISTENCY.md`
- `test-runs/canonical-runtime-consistency-2026-08-02/*`
