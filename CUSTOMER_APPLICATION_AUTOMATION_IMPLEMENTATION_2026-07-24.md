# Gridex OPS – automatiserat kundintag

Datum: 2026-07-24

## Resultat

Kundansökan har byggts om från ett request-bundet efterflöde till ett persistent, idempotent och återstartningsbart OPS-workflow.

När tenantens `POST /api/v1/website/customer-applications` accepterats gäller nu:

1. canonical kund-, anläggnings-, mätpunkts-, avtals-, juridik- och fullmaktsdata skapas/länkas;
2. provisionerings-RPC:n committar workflow och exakt ett `customer_application_continuation`-jobb i samma PostgreSQL-transaktion;
3. API:t returnerar `accepted` + `automatic_processing` och utför inte längre nätägar-, Z01-, Z03-, mail- eller webhookarbete i requestens återstående livstid;
4. customer-operation-workern köar initiala juridiska mail sekventiellt och väljer exakt ett nästa huvudsteg;
5. inkommande nätägarsvar, APERAK/Z04 och supplier-switch-händelser korreleras tillbaka till samma application workflow;
6. lifecycle-mail skapas först som ett persistent `dispatch_lifecycle_notification`-jobb och därefter via canonical `communication_logs`/`tenant_email_outbox`;
7. reconciliation hittar commit-/worker-fönster där continuation saknas eller har stannat;
8. tenant kan läsa en liten, tenant-skopad ansökningsstatus via `GET /api/v1/website/customer-applications/{application_id}`;
9. operationsvyn visar workflow, immutable övergångar, jobb och fel samt kan återköa samma continuation-jobb utan att skapa ett parallellt flöde.

## Rotorsaker som rättats

- Externa fortsättningssteg kördes direkt i API-requesten efter commit.
- Mail kunde skapas innan hela workflow-handoff var färdig.
- Provisionerings-RPC:n skapade inget garanterat fortsättningsjobb.
- Z01 och supplier switch kunde initieras från konkurrerande inline-logik.
- Senare switch-/aktiveringsmail var best-effort efter affärshändelsen; om outboxskapandet misslyckades fanns ingen persistent retryidentitet.
- Reconciliation kunde inte särskilja aktiva steg från legitim väntan på Z02, nätägarsvar eller Z04.
- Defaultmallar och regler seedades per ansökan och kunde återaktivera tenantens avstängda regler.
- Tenantguiden visade inte tillräcklig strukturerad fullmakt.
- Go-live readiness täckte inte hela kundautomationen.
- Operationsvyn saknade workflow-/jobbkedjan och säker replay.
- En första version av den nya RPC:n använde fel POA-kolumn (`valid_until`); detta rättades till canonical `valid_to` innan leverans.

## Canonical nästa steg

Continuation-workern använder ett enda beslut:

```text
saknad/ej externt användbar fullmakt
→ begär fullmaktskomplettering

saknad anläggnings-/mätpunktsidentitet
→ manuell nätägarbegäran
→ invänta verifierat svar

anläggning finns men kundmasterdata behöver hämtas
→ Z01
→ invänta Z02/ACK

alla obligatoriska uppgifter finns
→ readiness
→ Z03/supplier switch

osäker eller blockerad data
→ manual_review / switch_blocked
```

Z01 och Z03 startas inte längre parallellt från website API-routen.

## Workflow och idempotens

Ny migration:

`supabase/migrations/20260724210000_customer_application_continuation_orchestrator.sql`

Den lägger till:

- utökade canonical workflowstates;
- `next_action`, `workflow_version`, `last_transition_at`, `last_job_id`;
- immutable `customer_application_workflow_events`;
- workflowkorrelation och typed error fields på `customer_operation_jobs`;
- permanent unik continuation per workflow;
- permanent unik lifecycle-notifiering per event/idempotensnyckel;
- explicit transition-RPC med optimistic version och idempotent replay;
- atomisk provisioneringscommit + continuation-jobb;
- säker backfill av ofärdiga workflowrader.

Väntelägena `waiting_for_facility_response`, `waiting_for_customer_data_response` och `waiting_for_switch_response` återköas inte av generell reconciliation. Respektive inboundpipeline äger fortsättningen.

## Mail

Initiala mail köas efter commit och i ordning:

1. `contract.application_received`
2. `contract.confirmation_sent` när juridiska bevis och signerad PDF är klara
3. `contract.cooling_off_sent` när juridiska bevis är klara

Om skapandet av communication log/outbox misslyckas kastar workern ett fel och continuation-jobbet återförsöks.

Följande lifecycle-events har durable notification jobs:

- `supplier_switch.requested` → `switch.started`
- `supplier_switch.accepted` / `supplier_switch.confirmed` → `switch.confirmed`
- `supplier_switch.rejected` / `supplier_switch.manual_review_required` → `switch.action_required`
- `supply_period.activated` / `supply_period.active` → `customer.welcome_active`

Defaultmallar och regler skapas nu endast när de saknas. Befintlig tenantkonfiguration skrivs inte över vid ny kundansökan.

## Fullmakt

Den externa integrationsguiden och OpenAPI beskriver nu strukturerad `powerOfAttorney` med:

- `accepted`;
- signerande namn och identitet;
- metod;
- publicerat `textVersionId`;
- scope `supplier_switch` och `facility_information_lookup`;
- signeringstid och audit metadata.

Legacy `consents.power_of_attorney=true` kan registrera intern acceptans men är inte ensam `externally_sendable`.

Provisionerings-RPC:n verifierar canonical POA-kolumner/status:

- `revoked_at is null`;
- `valid_from`;
- `valid_to`;
- status `signed`, `accepted`, `active` eller `completed`.

## Readiness

Ny modul:

`lib/website/customerApplicationAutomationReadiness.ts`

Den kontrollerar bland annat:

- giltig automation user i `auth.users`;
- cron secret;
- service/worker readiness;
- verifierad kundavsändare;
- obligatoriska mailmallar och regler;
- production manual mailbox;
- nätägarkontakter;
- Ediel/platform readiness genom befintlig go-live-kedja.

Verifierad kundavsändare och obligatoriska automationsberoenden är blockerare, inte enbart varningar.

## Status- och operationsgränssnitt

Ny endpoint:

`GET /api/v1/website/customer-applications/{applicationId}`

Scope:

`website_switch_status.read`

Endpointen skopar strikt på API-nyckelns `company_id` och exponerar endast extern status, stage, nästa steg, switch-/supplystatus och tidsstämplar.

Adminvyn visar:

- aktuellt workflow;
- nästa åtgärd och version;
- immutable workflowevents;
- continuation-/notification-jobs;
- attempts och senaste typed error;
- befintlig kund-, site-, mätpunkts-, avtal-, fullmakts- och nätägarkedja.

`Återkö automation` återanvänder samma continuation-row. Den blockerar parallell replay när jobbet redan körs och blockerar terminala workflow.

## Backfill och drift

Läsande dry-run:

`scripts/customer-application-continuation-backfill-readiness.sql`

Kategorier:

- `completed`
- `ready_to_continue`
- `missing_notification`
- `missing_facility_request`
- `missing_switch_request`
- `manual_review_required`
- `unsafe_to_replay`
- `in_progress_or_waiting`

Runbook:

`docs/customer-application-automation-runbook.md`

## Ändrade filer

- `app/admin/website-applications/[id]/page.tsx`
- `app/admin/website-applications/actions.ts`
- `app/api/internal/customer-operations/cron/route.ts`
- `app/developers/customer-portal-api/page.tsx`
- `docs/external-website-api-integration-guide.md`
- `docs/openapi/website-integration-v1.json`
- `lib/api/publicRouteRegistry.ts`
- `lib/customer-operations/automation.ts`
- `lib/customer-operations/facilityResponseOrchestrator.ts`
- `lib/customers/customerOperationEvents.ts`
- `lib/ediel/flows/inboundBusinessStateMachine.ts`
- `lib/ediel/platformGoLive.ts`
- `lib/email/emailEvents.ts`
- `lib/email/emailTemplates.ts`
- `lib/website/applicationWorkflow.ts`
- `lib/website/customerApplications.ts`
- `lib/website/provisioningSaga.ts`
- `package.json`
- `scripts/gridex-communication-source-of-truth-regression.cjs`
- `scripts/gridex-ops-continuation-hardening-regression.cjs`
- `scripts/gridex-website-api-power-of-attorney-regression.cjs`
- `scripts/gridex-website-application-canonical-dispatch-regression.cjs`
- `scripts/gridex-website-supplier-switch-automation-regression.cjs`
- `scripts/migration-history-manifest.json`

## Nya filer

- `app/api/v1/website/customer-applications/[applicationId]/route.ts`
- `docs/customer-application-automation-runbook.md`
- `lib/customer-notifications/notificationOrchestrator.ts`
- `lib/website/customerApplicationAutomationReadiness.ts`
- `lib/website/customerApplicationReconciliation.ts`
- `lib/website/customerApplicationStatus.ts`
- `lib/website/customerApplicationWorkflowBridge.ts`
- `scripts/customer-application-continuation-backfill-readiness.sql`
- `scripts/gridex-customer-application-continuation-regression.cjs`
- `supabase/migrations/20260724210000_customer_application_continuation_orchestrator.sql`
- `CUSTOMER_APPLICATION_AUTOMATION_IMPLEMENTATION_2026-07-24.md`

## Verifiering genomförd

Följande gick grönt:

- automatic customer intake foundation regression;
- customer intake completion hardening regression;
- website application OPS chain regression;
- customer process next-step regression;
- website supplier-switch automation regression;
- website application canonical dispatch regression;
- website API power-of-attorney regression;
- OPS continuation hardening regression;
- new customer application continuation regression;
- customer operation events regression;
- communication source-of-truth regression;
- website API webhook launch regression;
- route readiness launch regression;
- public API contract: 33 routefiler;
- single API-key tenant integration: 115 kontroller;
- migration integrity: 297 filer, 202 versionsgrupper, checksums verifierade;
- OpenAPI JSON parse;
- TypeScript parserkontroll på samtliga ändrade/new `.ts`/`.tsx`: 0 parserfel.

## Begränsad verifiering

Full `npm ci` fastnade i denna körmiljö och skapade inget `node_modules`. Därför har följande inte kunnat slutföras här:

- full `npm run typecheck`;
- full `npm run lint`;
- Vitest-sviten;
- full `npm run build`;
- verkligt stagingtest mot Resend, IMAP, Ediel och Supabase.

Det är en releaseblocker tills dessa kommandon går grönt i projektets normala lokala/CI-miljö.

## Kvarvarande arbete utanför denna patch

- Kör ett verkligt providerbaserat stagingflöde genom nätägarsvar, Z01/Z02, Z03, APERAK/Z04 och aktiv leverans.
- Bekräfta att varje produktionstenant har verifierad sender, mailbox, nätägarkontakter och produktionsroute.
- Koppla befintliga metrics/health-vyer till en dedikerad dashboard för throughput/SLA; patchen tillhandahåller workflow- och jobbdatan men bygger inte en full metricsdashboard.
- Filkarantän/virusskanning för inkommande bilagor har inte införts i denna patch.
- Verifiera befintlig adminfunktion för webhook-resend mot de nya application-events; ingen ny separat webhook-resend-vy byggdes.

## Lokala kommandon

Antaget projektmål:

`/Users/hekmath/Projects/gridex-ops-platform`

Efter att patchzippen packats upp i Downloads:

```bash
rsync -av --delete-excluded \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.next/' \
  "$HOME/Downloads/gridex-ops-customer-intake-patch/" \
  "/Users/hekmath/Projects/gridex-ops-platform/"
```

Kör sedan:

```bash
cd /Users/hekmath/Projects/gridex-ops-platform
npm ci
npm run db:migrations:check
npm run gridex:customer-application-continuation-regression
node scripts/check-public-api-contract.cjs
node scripts/gridex-single-api-key-tenant-integration-regression.cjs
npm run typecheck
npm run lint
npm test
npm run build
```

Databasordning:

1. kör `scripts/customer-application-continuation-backfill-readiness.sql` som dry-run;
2. granska `unsafe_to_replay` och `manual_review_required`;
3. applicera `20260724210000_customer_application_continuation_orchestrator.sql` via ordinarie Supabase migration pipeline;
4. deploya applikationen;
5. verifiera readiness;
6. återaktivera cron och följ runbooken.
