# Gridex OPS – quote-fix och förenklat avtalsflöde

Datum: 2026-08-04

## Bekräftat fel

`POST /api/v1/website/quote` returnerade `422 commercial_model_invalid` trots att ett publicerat prisalternativ fanns.

Orsaken låg i `lib/pricing/offerQuote.ts`. Den publika API-representationen av ett prisalternativ spreds direkt in i den interna, strikt validerade v6-modellen. Det publika objektet innehåller visnings- och kompatibilitetsfält som inte finns i den interna `priceOptionSchema`, bland annat:

- `price_type`
- `resolution`
- `currency`
- `unit`
- `fixed_price`
- `markup`
- `monthly_fee`
- `is_default`

Den interna modellen använder `.strict()`. De extra fälten gjorde därför att `commercialModelFromSnapshot()` returnerade `null`, vilket felaktigt gav `commercial_model_invalid` för annars giltiga publicerade avtal.

## Korrigering

En explicit adapter, `internalPriceOptionForQuote()`, konverterar nu den publika DTO:n till exakt den interna v6-strukturen. Endast tillåtna interna fält läggs på toppnivån. Publika visningsfält bevaras som revisionsmetadata och kan inte längre bryta den strikta valideringen.

Områdespriser konverteras samtidigt från:

- `area_price_reference` → `price_row_reference`
- `energy_price_ore_per_kwh` → `amount`

`is_default` mappas uttryckligen till intern `default`.

## Förenklat avtalsflöde

Det normala skapandet är nu tre synliga steg:

1. **Grunduppgifter** – avtalsnamn, avtalstyp och kundtyp.
2. **Pris** – elområden, huvudpåslag eller fasta områdespriser samt månads- och fakturaavgift.
3. **Avtalsvillkor** – bindningstid, uppsägningstid och eventuell automatisk förlängning.

Följande ligger nu bakom valfria eller avancerade sektioner:

- beskrivning och kampanj
- extra energikomponenter
- start-, administrations-, bryt- och miljöavgift
- flera prisalternativ och tekniska referenser
- särskilda kommersiella komponenter/tillval
- rabattvillkor
- juridik, kapacitet och giltighetsdatum
- produktionsavtal

Ett standardavtal skapar automatiskt exakt ett aktivt standardprisalternativ med rätt kundtyp, bindningstid, uppsägningstid och förlängningsregel. För fasta avtal måste pris per valt elområde anges uttryckligen; nya rader börjar på `0` och kan därför inte sparas av misstag som ett positivt låtsaspris.

Avancerat läge kan inte döljas när modellen innehåller flera prisalternativ eller extra komponenter. Detta förhindrar att en avancerad modell ser ut som ett enkelt standardavtal utan att faktiskt ha förenklats.

## Ändrade filer

- `lib/pricing/offerQuote.ts`
- `components/admin/contracts/ContractOfferAdminForm.tsx`
- `components/admin/contracts/CommercialPricingEditor.tsx`
- `__tests__/offer-quote-public-option-adapter.test.ts`

## Verifiering i leveransmiljön

Godkänt:

- TypeScript/TSX-syntaxkontroll av samtliga ändrade filer med TypeScript-kompilatorn.
- Runtime-kontroll av den faktiska adapterfunktionen: inga publika extrafält läcker till den interna modellen, standardflaggan och områdespriset mappas korrekt.
- Statisk kontroll att den tidigare `...option`-spridningen är borttagen från quote-adaptern.

Full `npm ci`, Vitest, typkontroll och Next.js-build kunde inte köras i leveransmiljön eftersom dess interna npm-proxy returnerade 404 för `zod-validation-error@4.0.2`. Kör därför de angivna verifieringskommandona lokalt efter synk. Ingen databasmigration ingår i denna patch.
