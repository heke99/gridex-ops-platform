# Kundkort, avtal och portföljpris – implementation 2026-07-10

## Genomfört

- Kundkortet är uppdelat i riktiga arbetsvyer för översikt, kunduppgifter, avtal/fullmakt, anläggning, fakturering, kommunikation, anteckningar och ånger/avbrott.
- Tenantvyn visar sex affärssteg och exakt ett rekommenderat nästa steg. Rå EDIEL-, outbox-, provider- och felsökningsdata ligger i separat plattformsadminvy.
- Ånger, operativt avbrott och avvisning är separata beslut med målobjekt, mottagningsdatum, kanal, orsak, intern anteckning och obligatorisk bekräftelse.
- Webbavtal skapar ett kanoniskt `gridex_contract_pricing_v2`-snapshot som används av prismotorn. Mixandelar, fastprisandelar och avtalsavgifter fryses i samma format som faktureringen läser.
- Publika webbavtal får inte längre falla tillbaka till reducerade kontraktsrader utan prisplan/version/snapshot.
- Ny endpoint: `POST /api/v1/website/quote` med scope `website_contracts.read`.
- Portföljpriser administreras per tenant, månad och SE1–SE4 med status utkast → bekräftat → låst, korrigeringsversioner, historik, täckningskontroll och förhandskalkyl med samma prismotor.
- Portföljprisresolvern väljer senaste aktiva bekräftade/låsta version för rätt tenant, månad och elområde. Saknat pris blir ett explicit beräkningsfel och aldrig noll.

## Databasmigration

Kör migrationen innan nya portföljprisfunktioner används:

`supabase/migrations/20260710190000_customer_card_pricing_portfolio_hardening.sql`

Migrationen lägger till versionering/audit för portföljpriser samt separata lifecycle-typer för ånger, avbrott och avvisning.

## Verifiering

Körda kontroller:

- `npm run typecheck`
- `npm run typecheck:tests`
- `npm run typecheck:scripts`
- `npm test`
- `npm run gridex:pricing-flow-regression`
- `npm run gridex:platform-tenant-contracts-api-mail-regression`
- `npm run gridex:customer-card-workflow-ui-regression`
- `npm run gridex:customer-card-tenant-ux-regression`
- `npm run gridex:tenant-superadmin-status-visibility-regression`
- `npm run db:migrations:check`
- `npm run build`

## Efter deploy

1. Kör migrationen i Supabase.
2. Lägg in bekräftade portföljpriser per tenant, månad och elområde.
3. Testa `GET /api/v1/website/public-contracts` och därefter `POST /api/v1/website/quote` för spot, fast, portfölj och mix.
4. Skapa ett testavtal av varje typ och verifiera `contract_price_snapshot_id` samt snapshotformatet.
5. Öppna kundkortet som tenant och som plattformsadmin för att verifiera informationssepareringen.
