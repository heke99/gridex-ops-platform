# Lokal katalogverifiering för rad 478

Köraren `scripts/catalog-draft-local.mjs` verifierar
`KONS-CATALOG-DRIVER-MISSING-DRAFT-VIEW`. Det historiska K13-provet stannade i
**Aktiva** och hittade aldrig utkastformuläret.

Kör med Node 22 från ett lokalt Git-arkiv med installerade projektberoenden
och Chromium för Playwright. Köraren behöver Git och tar samt en lokal POSIX-miljö.
Chromium använder en separat arbetskatalog under systemets temporärkatalog för
att hålla sökvägen till dess Unix-socket kort.

```sh
node scripts/catalog-draft-local.mjs
```

**Aktiva** ska ge noll POST och inget skrivkvitto. Drivaren följer den ordinarie
länken **Utkast** och **Redigera utkast** till samma bolag och avtal. Före
hydrering är sparknappen inaktiv. Efter hydrering ska ett klick ge exakt en
ordinarie Next-action-POST. Det syntetiska utkastets ändrade namn läses tillbaka
med samma avtals-ID och utkaststatus. Det lokala rotskalet och de syntetiska
läs- och skrivportarna finns under `scripts/fixtures/catalog-draft-local`.
Katalogsidan, formuläret och serveråtgärden läses direkt från vald Git-revision.
Provet använder syntetisk identitet och ett lokalt skrivkvitto.

| Inställning | Användning |
| --- | --- |
| `GRIDEX_CATALOG_REVISION` | Git-revision att läsa lokalt. Standard är `HEAD`. |
| `GRIDEX_CATALOG_NODE_MODULES` | Redan installerade projektberoenden. Standard är arkivets `node_modules`. |
| `GRIDEX_CATALOG_CHROMIUM` | Egen Chromium-binär. Standard är Playwrights installerade Chromium. |
| `GRIDEX_CATALOG_WORKDIR` | Katalog för provets egna arbetsfiler och bevis. Standard är systemets temporärkatalog. |
| `GRIDEX_CATALOG_PORT` | Lokal port 1024–65535 när ett fast värde behövs. Köraren väljer annars en ledig loopback-port. |

`--prepare-only` materialiserar samma exakta källor och skriver ut
beviskatalogen utan att starta Next eller Chromium. Vid en full körning finns
`evidence.json`, `browser.log`, `next.log` och ett lokalt skrivkvitto i samma
katalog. `evidence.json` binder fynd-ID, Git-revision, produktblobbarnas
identiteter och utfall. Nästa registeravstämning använder detta kvitto och
den exakta körarens revision för rad 478. Gridex OPS-kvalificeringen använder
den namngivna köraren som ersättare för det historiska K13-provet i den lokala
releaseverifieringen. Staging och produktion verifieras genom sina ordinarie
arbetsflöden.
