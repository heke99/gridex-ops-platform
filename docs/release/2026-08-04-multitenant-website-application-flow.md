# Multitenant webbansökan, Mina sidor och återrapportering

**Datum:** 2026-08-04  
**API-kontrakt:** `2026-08-04.1`  
**Databasmigration:** `20260804121000_multitenant_website_application_flow_completion.sql`

## Mål

Samma kodväg ska fungera för varje tenant:

1. API-nyckeln identifierar tenant.
2. Tenantens readiness verifieras fail-closed.
3. Webbansökan skapar canonical kundnummer, kund, anläggning, mätpunkt, avtal och juridiskt snapshot.
4. Mina sidor-identiteten binds beständigt till kunden.
5. E-post, anläggningsuppslag och leverantörsbyte fortsätter i beständiga jobb.
6. Status visar rätt ansökan, avtal, anläggning, jobb, e-post och webhook.
7. Partiella eller terminala fel kan återupptas utan dubbletter.
8. Tenant får status genom polling och, när konfigurerad, webhook.

## Genomförda korrigeringar

- En canonical readiness ersätter scopes-only readiness och förenar båda tidigare capability-vokabulärerna.
- Webbintaget verkställer tenantens operation policy för API, försäljning, automation, facility lookup och e-post.
- `launch_ready` sätts endast efter full tenantkontroll. Äldre scopes-only-flaggor invalidieras av migrationen.
- Provisionering kräver en tenantägd HTTPS-adress till Mina sidor och kan skapa en tenantbunden webhook.
- `auth_user_id` och `customer_portal_user_id` är obligatoriska, måste vara samma UUID och valideras både i API och databas.
- Portal account/identity länkas fail-closed och verifieras genom återläsning.
- Kundmail får aldrig en fallback till OPS-plattformens globala login.
- Ansökningsstatus korrelerar switch och supply period till exakt avtal, site och mätpunkt.
- Status läser verklig avtalsstatus, continuation-jobb, e-postkö, kommunikationslogg, webhook fan-out och webhookleverans.
- Terminala continuation-fel projiceras till workflow och publik ansökan av både worker och databastrigger.
- Domänhändelsens webhook fan-out är beständig, retrybar och återtar stale processing-lås.
- Varje beständig workflowövergång emitterar `customer_application.status_changed`; switch- och supplyövergångar emitterar dessutom `supplier_switch.updated`. Eventen är tenantbundna och idempotenta per övergång.
- Partiellt committade ansökningar kan återupptas med samma idempotency key utan att kundgrafen skapas igen.
- OpenAPI och utvecklarguiden är versionshöjda till `2026-08-04.1`; `accepted` betyder durable canonical commit med asynkron continuation, inte att alla eftersteg redan är klara. Den versionssatta OpenAPI-routen läser en arkiverad immutable releasefil.
- En misslyckad provisionering kan återupptas med säker rotation av en credential som aldrig visades, utan Gridex-specifika namn eller specialfall.

## Säker deploymentordning

1. Deploya inte applikationskoden före databasen. Ny kod stoppar annars intaget med `503 website_application_schema_mismatch`.
2. Exportera `DATABASE_URL` och kör det medföljande synkskriptet. Skriptet klassificerar varje äldre migration som `registered`, `pending`, exakt verifierad `repair` eller `unsafe`. `migration repair` körs endast när liveeffekter, ACL, constraints, trigger, backfill och funktionshashar matchar exakt.
3. Kontrollera det automatiska `supabase db push --dry-run --linked`-resultatet.
4. Skriptet applicerar därefter den nya migrationen med `supabase db push --linked`.
5. Postflight-SQL körs automatiskt och avslutas alltid med `ROLLBACK` efter verifieringen.
6. Deploya OPS-koden.
7. Öppna superadminens API-klientsida och kör canonical provisionering/readiness för Gridex och därefter en andra tenant. Migrationen markerar tidigare tenant-webbklienter som ej launch-ready tills detta görs.
8. Synkronisera tenantwebbens OpenAPI till `2026-08-04.1` och skicka båda obligatoriska portal-ID-fälten.
9. Kör en full webbansökan per tenant och verifiera polling samt webhook separat.

## Godkännandekriterier per tenant

- `complete_tenant_website_ready = true`.
- Minst ett publicerat och teckningsbart webbavtal med komplett juridik.
- Verifierad e-postavsändare, obligatoriska mallar och regler.
- Automation user och cron-secret redo.
- Production mailbox för facility lookup redo.
- Tenantens Mina sidor-URL sparad och HTTPS-validerad.
- API-klientens scopes och allowed origins korrekta.
- Webbansökan returnerar kundnummer och ansökningsnummer utan interna UUID:n.
- Portal bundle visar endast den autentiserade tenantens och kundens data.
- Status går från canonical commit till korrekt slutstatus och visar e-post/job/webhook-evidens.
- Samma idempotency key skapar inte en andra kundgraf.
- Ett terminalt jobb visar `failed` och `resume_customer_application_continuation`.

## Kända deploymentförutsättningar

- Ingen tenant hade aktiv webhook vid den read-only livegranskningen; polling fungerar som fallback.
- Gridex saknade tenantens explicita `customer_portal_url` och måste provisioneras om efter migrationen.
- Full `npm ci`/Next.js-build kräver ett fungerande paketregister. Den aktuella interna mirroren returnerade 404 för `zod-validation-error@4.0.2`; repositoryns dependency-free regressioner och TypeScript-transpilering kördes separat. En global full `tsc` kunde starta men saknade installerade Next/React/Supabase/Node-typer, så den är inte ett giltigt fullständigt buildbevis.
