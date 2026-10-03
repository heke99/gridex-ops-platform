# Additiv sammansättning av AI-listans kundhistorikägare

Den nya framåtmigrationen bevarar 21408:s exakta 22-fälts-, käll-, period-, struktur- och kontinuitetskontroll och 03642/10758:s skyddade bekräftade/bilaterala kundversioner med `customerSourceMessageId`. Den ändrar inga publicerade migrationsbytes och skapar inget nytt godkännande för kund-, issuer-, nät- eller ändamålsfakta.

Datumgränser kommer från samma kvalificerade original och samma exportcutoff. En full kundversion ersätter tidigare deltan, senare separat kvalificerade deltan bygger vidare på den, och två olika källor vid samma gräns hålls. Den femte referensen måste motsvara den aktuella fulla versionen även efter ett senare delta. Saknade referenser eller perioddelar, felaktiga celler, tvetydighet, annan punkt/miljö, otillåten identitetsövergång och aktuell källåterkallelse hålls. Befintligt oföränderligt original återspelas enligt tidigare ägares ordning.

JavaScript-projektionen och lagrad delta-proveniens begränsas till den faktiska fysiska objektkällan, kodlistan, originalhashen, juridiska parterna och giltighetsdatumet. En kunds ändring blir därmed inte automatiskt en annan mätpunkts historik.

Verifiering:

- Tidigare JavaScript-bytes från `52040420`: det nya provet för annan punkt blev rött, eftersom `Foreign Name` ersatte `Person Estate`.
- Utan framåtmigrationen: samma fulla kundkälla blev röd med `ai_list_original_dated_source_owner_missing`.
- Med framåtmigrationen: den deklarerat syntetiska SQL-kompositionskontrollen och hela tidigare origination-kontrollen passerade. Faktiska tidigare SQL-ägare, struktur-/helradsmatchning och oföränderligt ursprung används. Aktör, legal källa, nät och initial leveransbehörighet samt det fulla kundversionsportet är uttryckligen syntetiska fixturegränser.
- Fyra relevanta enhetssviter: 39/39 passerade. Avgränsad ESLint och `git diff --check` passerade.

Autentisk ren/ancestor-replay, native samtidighet, HTTP, interaktiv browser, build och exakt-head CI för den slutliga gemensamma kandidaten är inte kvalificerade av dessa prov. De måste verifieras på samma frysta kandidat. Paketet godkänner inget helt ursprungligt masterplankriterium. Autentiska externa issuer-/representation-/ändamålsfakta måste fortfarande kvalificeras separat; interna producent- och konsumentluckor får inte döpas om till externa blockerare.
