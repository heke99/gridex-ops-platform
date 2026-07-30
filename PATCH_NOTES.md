# Gridex Ops canonical production repair

Datum: 2026-07-30  
Kontraktsversion: `2026-07-30.2`  
Releasebeslut: **NO-GO tills blockerarna i VERIFICATION.md är lösta**

## Levererat

- Inför ett enda strikt `/customer/sync`-kontrakt för profil,
  anläggningsdata, dokument, juridiska accepter, fullmakt och metadata.
- Normaliserar portalidentitet tenant-säkert och skiljer utelämnade värden från
  tomma eller otillåtna `null`-värden.
- Ersätter interna UUID:n i publika portal-, faktura-, dokument-, avtals-,
  anläggnings- och ansökningssvar med stabila tenantbundna referenser.
- Inför extern referensbaserad och atomisk utflyttning med strikt datumkontroll,
  idempotency-konflikt, case, domänevent, outbox och audit i samma transaktion.
- Gör portallistor paginerbara och markerar inte portal bundle som komplett när
  en kritisk del saknas eller inte kan valideras.
- Reparar quote/application-mismatchen så den atomiska onboardingfunktionen
  accepterar både `v2_full_quote` och `v3_commercial_selection`.
- Lägger till två explicita releasegrindar:
  `scripts/check-api-compatibility.cjs` och
  `scripts/verify-openapi-release.cjs`.
- Höjer Website Integration och Customer Portal-kontrakten till
  `2026-07-30.2` och synkroniserar runtime, OpenAPI, exempel och
  utvecklardokumentation.
- Återställer den immutable historiska migrationen
  `20260728170000_live_schema_code_canonical_sync.sql` byte-för-byte till den
  registrerade SHA-256-summan `881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482`.
- Flyttar den felaktigt inlagda ändringen till den nya framåtriktade
  migrationen `20260730130000_historical_sync_forward_repair.sql`.
- Hashar exakt samma pretty-printade OpenAPI-bytes i release-manifestet som
  routes faktiskt serverar, och gör manifestet `no-store`.
- Normaliserar alla svar som går genom `customerPortalJson` till en enda
  canonical fel-envelope utan parallella `code`, `error_code`, `message`,
  `request_id` eller `correlation_id` på flera nivåer.
- Tar bort dubblerad `meta` från integration context och dubblerad `quote` från
  quote-svaret.
- Projicerar webhooks till opaka, tenantbundna `event_id`, `delivery_id`,
  `customer_reference` och aggregate `reference`.
- Filtrerar råa databasfält `id` och `*_id` rekursivt från webhookdata.
- Återprojicerar äldre redan köade webhookrader från deras tenantbundna
  domänevent innan signering, så en uppgradering inte skickar legacy-UUID:n.
- Regenererar Website och Customer Portal OpenAPI med slutna canonicala error-
  och publication-webhook-scheman.
- Exkluderar `.patch-backups/**` från aktiv lintning; katalogen innehåller
  historiska leveranssnapshots, inte körbar källkod.

## Exakta lokala OpenAPI-hashar

- Website: `920a774c10ee8cc32ea5db62a8d898119f7ca59aa50896041d9d14a734a5bcd1`
- Customer Portal: `0371233929e6bafff463d7171e18a39712cb98577830aaff0669822f9184e315`

## Ny migration

`supabase/migrations/20260730153000_customer_portal_api_production_completion.sql`
ska appliceras efter `20260730130000_historical_sync_forward_repair.sql`.
Registrerad SHA-256:
`b5a9f323400a4e3592f3e392bf94695161969c1d5b0ba8d99cace9821338d740`.

## Viktig avgränsning

Det bifogade underlaget innehöll endast Gridex Ops. Gridex Web har därför inte
ändrats, byggts eller verifierats. Skapa inte en Web-release från denna patch;
synkronisera Web först när det aktuella Web-repot har levererats och den
driftsatta OPS-manifestkontrollen är grön.
