# Gridex Ops canonical production repair

Datum: 2026-07-30  
Kontraktsversion: `2026-07-30.1`  
Releasebeslut: **NO-GO tills blockerarna i VERIFICATION.md är lösta**

## Levererat

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

- Website: `9ad3fc518d9aadb687141af2df7d3068df8f7daca530cc01b525d4b94c816b7b`
- Customer Portal: `a3e3f475f3822f30efab4e9a792d714585bacc98773d52790adf12072ed3251e`

## Viktig avgränsning

Det bifogade underlaget innehöll endast Gridex Ops. Gridex Web har därför inte
ändrats, byggts eller verifierats. Skapa inte en Web-release från denna patch;
synkronisera Web först när det aktuella Web-repot har levererats och den
driftsatta OPS-manifestkontrollen är grön.
