# Bilaga B — PRODAT-fält och sammansatta villkor

74 numeriska fält,3parentgrupper och110villkorliga basceller. R/D/O är nationell användning; syntaxklasser och parent-/registervillkor måste fortfarande tillämpas.

## B1. Användningsmatris per funktion
| Fält | Svenskt namn | Z01 | Z02 | Z03 | Z04 | Z05 | Z06 | Z08 | Z09 | Z10 | Z13 | Z14 | Z15 | Z18 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 311 | Application Reference | R | R | R | R | R | R | R | R | R | R | R | R | R |
| 312 | Version | R | R | R | R | R | R | R | R | R | R | R | R | R |
| 202 | Meddelandenamn | R | R | R | R | R | R | R | R | R | R | R | R | R |
| 203 | Meddelandeidentifikation | R | R | R | R | R | R | R | R | R | R | R | R | R |
| 204 | Meddelandefunktion | O | O | O | O | O | O | O | O | O | O | O | O | O |
| 313 | Kvittensbegäran | O | R | R | R | R | R | R | R | R | R | R | R | R |
| 205 | Meddelandedatum | R | R | R | R | R | R | R | R | R | R | R | R | R |
| 206 | Tidszon | R | R | R | R | R | R | R | R | R | R | R | R | R |
| 301 | Fritext (huvud) | O | O | O | O | O | O | O | O | O | O | O | O | O |
| 207 | Avsändare (Ediel-ID) | R | R | R | R | R | R | R | R | R | R | R | R | R |
| 315 | Avsändarens org.nr | - | - | O | - | - | - | - | - | - | - | - | - | - |
| 208 | Mottagare (Ediel-ID) | R | R | R | R | R | R | R | R | R | R | R | R | R |
| 314 | Sekvensnummer | R | R | R | R | R | R | R | R | R | R | R | R | R |
| 209 | Anläggnings-id | R | R | R | R | R | R | R | R | R | - | D | R | R |
| 258 | Sekvensnummer | - | - | - | D | - | D | - | - | D | - | - | - | - |
| 210 | Avtal, startdatum | R | - | R | R | - | D | - | D | D | - | - | - | - |
| 211 | Avtal, slutdatum | - | - | - | - | R | O | R | D | - | - | - | - | - |
| 302 | Rapportstartdatum | - | - | - | O | - | - | - | - | - | R | D | - | - |
| 321 | Rapportslutdatum | - | - | - | - | - | - | - | - | - | D | D | - | - |
| 216 | Giltighetsdatum – giltig from | - | - | - | - | - | R | - | D | R | - | - | - | - |
| 212 | Datum för första mätaravläsning | - | - | - | O | - | - | - | - | - | - | - | - | - |
| 249 | Födelsedatum | O | O | O | O | O | O | O | - | - | - | - | - | - |
| 508 | Tidslängd (tidsperiod) | - | - | - | R | - | D | - | - | R | - | D | - | - |
| 326 | Tillståndets tidstämpel | - | - | - | - | - | - | - | - | - | - | D | O | O |
| 327 | Tjänsten/rapporteringen upphör | - | - | - | - | - | - | - | - | - | - | - | R | R |
| 303 | Fritext (per anläggning) | O | O | O | O | O | O | O | - | O | - | - | - | - |
| 213 | Uppskattad årsenergi | - | - | O | R | - | O | - | - | O | - | - | - | - |
| 214 | Konstant för mätare | - | - | - | D | - | D | - | - | D | - | - | - | - |
| 215 | Konstant, gammal mätare | - | - | - | - | - | - | - | - | O | - | - | - | - |
| 217 | Mätmetod | - | R | R | R | - | D | - | D | R | R | D | - | - |
| 218 | Antal siffror, mätare | - | - | - | D | - | D | - | - | D | - | - | - | - |
| 219 | Antal siffror, gammal mätare | - | - | - | - | - | - | - | - | O | - | - | - | - |
| 306 | Installationsstatus | - | - | - | R | - | D | - | - | - | - | - | - | - |
| 307 | Tariffkod | - | - | - | O | - | O | - | - | - | - | - | - | - |
| 220 | Prioritet | - | - | - | O | - | O | - | - | - | - | - | - | - |
| 222 | Rapporteringsfrekvens | - | - | - | R | - | R | - | - | R | R | D | - | - |
| 223 | Transaktionstyp (undertyp) | R | R | R | R | R | R | R | R | R | R | R | R | R |
| 259 | Mätare, tidsintervall (räkneverkskod) | - | - | - | D | - | D | - | - | D | - | - | - | - |
| 254 | Avräkningsmetod (dygns/månads) | - | - | - | R | - | D | - | - | D | - | - | - | - |
| 242 | Produktkod | - | - | - | R | - | D | - | - | D | - | - | - | - |
| 506 | Produkt id (Energiprodukt) | - | - | - | - | - | - | - | - | - | R | D | - | - |
| 310 | Kundstatus | - | - | - | - | D | D | - | D | - | - | - | - | - |
| 513 | Riktning (Typ av anläggning) | - | - | - | - | - | - | - | - | - | R | D | - | - |
| 322 | Tillståndets status | - | - | - | - | - | - | - | - | - | - | R | R | - |
| 323 | Tillståndets syfte | - | - | - | - | - | - | - | - | - | D | D | - | - |
| 324 | Orsak till tillståndets upphörande | - | - | - | - | - | - | - | - | - | - | - | R | R |
| 224 | Mätarnummer | - | - | - | R | O | O | O | - | R | - | - | - | - |
| 225 | Gammalt mätarnummer | - | - | - | - | - | - | - | - | R | - | - | - | - |
| 308 | Leverantörens avtalsnr | - | - | O | - | O | O | O | - | - | - | - | - | - |
| 260 | Nätområdesid | R | R | R | R | R | R | R | R | R | - | D | R | R |
| 320 | Värmevärdesområde | - | - | - | D | - | D | - | - | - | - | - | - | - |
| 240 | Serie-id | - | - | - | D | O | D | - | - | D | - | - | - | - |
| 319 | Referens till anläggning | - | - | - | D | - | - | - | - | - | - | - | - | - |
| 261 | Referens till avtal/fullmakt | R | - | R | - | - | - | - | - | - | R | - | - | - |
| 226 | Ärendereferens | R | R | R | R | R | R | R | R | R | R | R | R | R |
| 325 | Tillståndets id | - | - | - | - | - | - | - | - | - | - | D | R | R |
| 227 | Kund-id | R | R | R | R | R | D | R | D | - | R | D | R | R |
| 228 | Namn-elanvändare | R | R | R | R | R | D | R | D | - | R | D | R | R |
| 229 | Adress-elanvändare | D | D | D | D | D | D | D | D | - | - | - | - | - |
| 231 | Postnr-elanvändare | R | R | R | R | R | D | R | D | - | - | - | - | - |
| 232 | Postort-elanvändare | R | R | R | R | R | D | R | D | - | - | - | - | - |
| 316 | Land-elanvändare | R | R | R | R | R | D | R | D | - | R | R | R | R |
| 233 | Anläggnings-id | D | R | D | R | R | R | D | - | - | - | R | - | - |
| 234 | Adress-anläggning | D | R | D | R | R | R | D | - | - | - | R | - | - |
| 235 | Postnr-anläggning | O | O | O | O | O | O | O | - | - | - | O | - | - |
| 236 | Postort-anläggning | O | O | O | O | O | O | O | - | - | - | O | - | - |
| 237 | Land-anläggning | O | O | O | O | O | O | O | - | - | - | O | - | - |
| 250 | Fakturamottagare ID | - | - | D | D | D | D | D | D | - | - | - | - | - |
| 251 | Namn-fakturamottagare | - | - | D | D | D | D | D | D | - | - | - | - | - |
| 252 | Adress-fakturamottagare | - | - | D | D | D | D | D | D | - | - | - | - | - |
| 253 | Postnr-fakturamottgare | - | - | D | D | D | D | D | D | - | - | - | - | - |
| 317 | Postort-fakturamottagare | - | - | D | D | D | D | D | D | - | - | - | - | - |
| 318 | Land-fakturamottagare | - | - | D | D | D | D | D | D | - | - | - | - | - |
| 262 | Balansansvarig | - | - | R | R | R | R | R | R | R | - | - | - | - |

## B2. Parentgrupper
| Grupp | Tillämplighet | Effekt | Källa |
| --- | --- | --- | --- |
| SG17/NAD+UD | message IN (Z01,Z02,Z03,Z04,Z05,Z08,Z13,Z15,Z18) OR (message IN (Z06,Z09) AND subtype == E) OR (message == Z14 AND subtype != N) | Använd gruppen och dess tillämpliga barn; annars ej använd. Z14N kräver därför inte 316 trots basmatrisens R. | P §2.2 s.20–21 |
| SG17/NAD+IT | message IN (Z02,Z04,Z05,Z06) OR (message == Z14 AND subtype != N); frivilligt val i Z01,Z03,Z08 | 233=209 och 234 krävs när gruppen används; ingen IT i Z14N. Postnr/ort enligt bilaga3. | P §2.2 s.21; bilaga3 |
| SG17/NAD+IV | message IN (Z03,Z04,Z05,Z06,Z08) OR (message == Z09 AND subtype == E); dessutom invoicee_address_differs_from_end_user | Identifiering, namn, postnr, ort, land samt tillämplig adress när gruppen används. | P §2.2 s.22 |

## B3. Exakta fältlocators och användningsvillkor

### Fält 311 · Application Reference
**Locator:** `UNB/0026`  
**Scope/parent:** interchange / ingen särskild NAD-parent  
**Värdekontrakt:** an..14; marknad-roll-familj  
**Källtabellens avlästa trådtyper:** Se kuvert-/segmenttabellen. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Anges i UNB, ska vara 23-DDQ-PRODAT eller 23-DGI-PRODAT för PRODAT i elmarknaden och 27-DDQ-PRODAT i naturgasmarknaden.

**Källa:** T §4.2,5.2; P s.16; T §4.2 och §2.2

### Fält 312 · Version
**Locator:** `UNH/S009/0057`  
**Scope/parent:** message / ingen särskild NAD-parent  
**Värdekontrakt:** E2SE6A för EL/26.A; inte den äldre bilaga-4-koden  
**Källtabellens avlästa trådtyper:** an..2; an..3; an..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Nationell version av Ediel-meddelandet.

**Källa:** P §2.6 s.41; §2.2 s.16; T §4.2 och §2.2

### Fält 202 · Meddelandenamn
**Locator:** `BGM/C002/1001`  
**Scope/parent:** message / ingen särskild NAD-parent  
**Värdekontrakt:** Z01,Z02,Z03,Z04,Z05,Z06,Z08,Z09,Z10,Z13,Z14,Z15,Z18  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** PRODAT funktion: Z01, Z02, Z03, Z04, Z05, Z06, Z08, Z09, Z10, Z13, Z14, Z15, Z18

**Källa:** P §2.6 s.42; §2.2 s.16

### Fält 203 · Meddelandeidentifikation
**Locator:** `BGM/1004`  
**Scope/parent:** message / ingen särskild NAD-parent  
**Värdekontrakt:** PRODAT D97A: platt 1004; unik meddelandeidentitet, inte UNH/0062  
**Källtabellens avlästa trådtyper:** an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Unik identitet på meddelandet.

**Källa:** P §2.6 s.42; §2.2 s.16

### Fält 204 · Meddelandefunktion
**Locator:** `BGM/1225`  
**Scope/parent:** message / ingen särskild NAD-parent  
**Värdekontrakt:** 9 original, 5 ersättningsmeddelande; användningsklass O  
**Källtabellens avlästa trådtyper:** an..3. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Kod 9 anger originalmeddelande och kod 5 anger ersättningsmeddelande

**Källa:** P §2.6 s.42; §2.2 s.16

### Fält 313 · Kvittensbegäran
**Locator:** `BGM/4343`  
**Scope/parent:** message / ingen särskild NAD-parent  
**Värdekontrakt:** AB eller NA; Z01 O, övriga R; NA ensam är inte avvisningsskäl  
**Källtabellens avlästa trådtyper:** an..3. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Begäran om APERAK

**Källa:** P §2.6 s.42; §2.2 s.16

### Fält 205 · Meddelandedatum
**Locator:** `DTM[2005=137]/C507/2380`  
**Scope/parent:** message / ingen särskild NAD-parent  
**Värdekontrakt:** 203 CCYYMMDDHHmm; applikationens skapandetid  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Datum då PRODAT-meddelandet skapades i applikationen (ej EDI-systemet)

**Källa:** P §2.6 s.43; §2.2 s.16

### Fält 206 · Tidszon
**Locator:** `DTM[2005=ZZZ]/C507/2380`  
**Scope/parent:** message / ingen särskild NAD-parent  
**Värdekontrakt:** 1 med format 805; fast svensk normaltid  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Tidzon anges som "offset" till UTC, alltid "1" för både normaltid och sommartid i Sverige. Se handboken.

**Källa:** P §2.6 s.43; §2.2 s.16

### Fält 301 · Fritext (huvud)
**Locator:** `FTX[4451=AAI]/C108/4440[1..5]`  
**Scope/parent:** message / ingen särskild NAD-parent  
**Värdekontrakt:** Fritext i huvudet; längd/status per P segmenttabell  
**Källtabellens avlästa trådtyper:** an..70. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Fritext rekommenderas EJ, anv. endast i undantagsfall

**Källa:** P §2.6 s.44; §2.2 s.16

### Fält 207 · Avsändare (Ediel-ID)
**Locator:** `SG4/NAD[3035=FR]/C082/3039 + 3207`  
**Scope/parent:** message / ingen särskild NAD-parent  
**Värdekontrakt:** Juridisk avsändare; 160:SVK; landskod; inte UNB-teknisk part  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Giltigt Ediel-id enligt Ediel-register i Edielportalen samt landskod.

**Källa:** P §2.6 s.45; §2.2 s.16

### Fält 315 · Avsändarens org.nr
**Locator:** `SG6/RFF[1153=XA]/C506/1154`  
**Scope/parent:** message / ingen särskild NAD-parent  
**Värdekontrakt:** Avsändarens organisationsnummer när angivet i Z03  
**Källtabellens avlästa trådtyper:** an..3; an..35; an..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avsändarens organisationsnummer

**Källa:** P §2.6 s.46; §2.2 s.16

### Fält 208 · Mottagare (Ediel-ID)
**Locator:** `SG4/NAD[3035=DO]/C082/3039 + 3207`  
**Scope/parent:** message / ingen särskild NAD-parent  
**Värdekontrakt:** Juridisk mottagare; 160:SVK; landskod  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Giltigt Ediel-id enligt Ediel-register i Edielportalen samt landskod.

**Källa:** P §2.6 s.46; §2.2 s.16

### Fält 314 · Sekvensnummer
**Locator:** `SG8/LIN/1082`  
**Scope/parent:** line / ingen särskild NAD-parent  
**Värdekontrakt:** 1..n i obruten stigande följd över hela meddelandet  
**Källtabellens avlästa trådtyper:** n..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Sekvensnummer

**Källa:** P §2.6 s.47; §2.2 s.16

### Fält 209 · Anläggnings-id
**Locator:** `SG8/LIN/C212/7140`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Nationellt högst 25 tecken; identitetskodlista/ansvarig 9 eller 89 enligt källprofil  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Nätägarens identifikation av anläggningen. Skickas i Z14, utom i Z14N.

**Källa:** P §2.6 s.47; §2.2 s.16

### Fält 258 · Sekvensnummer
**Locator:** `SG8/LIN/C829/1082`  
**Scope/parent:** register / ingen särskild NAD-parent  
**Värdekontrakt:** C829/5495=1; registerindex 1..m per objekt; inte samma som 314  
**Källtabellens avlästa trådtyper:** an..3; n..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Sekvensnummer för varje register för aktuell anläggning/mätare. Obligatorisk för anläggningar (mätare) med fler register. Anges ej för anläggningar med endast ett register. För detaljerad information om uppgifter för register 2 och högre, se bilaga 2.

**Källa:** P §2.6 s.47; §2.2 s.16

### Fält 210 · Avtal, startdatum
**Locator:** `SG8/DTM[2005=92]/C507/2380`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** 203 CCYYMMDDHHmm; leverans-/avtalsstart  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avser det datum som leverans startar. Giltigt startdatum, se Handboken. Z06/Z10: Om ändring gäller en ändring som sker före leveransstart är ”avtal startdatum” obligatoriskt och meddelande ska skickas till den framtida leverantören. Z09: Används enbart i Z09D och då endast i anslutning till att avtal om produktion tecknas.

**Källa:** P §2.6 s.50; §2.2 s.16, 17

### Fält 211 · Avtal, slutdatum
**Locator:** `SG8/DTM[2005=93]/C507/2380`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** 203; leverans-/avtalsslut  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avser det datum som leverans slutar. Z09: Används enbart i Z09D och då endast i anslutning till att avtal om produktion avslutas. Får ej anges samtidigt som Avtal, startdatum i Z09D, vid fel används kod 109 i APERAK fält A903. Giltigt slutdatum, se Handboken.

**Källa:** P §2.6 s.50; §2.2 s.17

### Fält 302 · Rapportstartdatum
**Locator:** `SG8/DTM[2005=90]/C507/2380`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** 203; rapportstart, inte avtalsstart och inte 163  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avser det datum som första mätaravläsning kommer att sändas in (i MSCONS/UTILTS). Anges i Z04 endast om timserier/kvartserier skickas i MSCONS/UTILTS och om datumet avviker från startdatum för avtalet. Anges i Z13 och Z14 som ”tidstämpel för påbörjande av rapportering”. Skickas i Z14 utom i Z14N.

**Källa:** P §2.6 s.49; §2.2 s.17

### Fält 321 · Rapportslutdatum
**Locator:** `SG8/DTM[2005=91]/C507/2380`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** 203; rapportens sluttid, inte 164  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avser ”tidstämpel för avslutande av rapportering”. Anges i Z13 och Z14 såvida inte rapporteringen avses ske tills vidare. Skickas ej heller i Z14N.

**Källa:** P §2.6 s.49; §2.2 s.17

### Fält 216 · Giltighetsdatum – giltig from
**Locator:** `SG8/DTM[2005=157]/C507/2380`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** 203; strukturändringens giltighet  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avser det datum när aktuell ändring börjar gälla. Z09: Obligatoriskt i Z09 utom i Z09D, då används istället fält 210 eller 211. Giltigt datum, se Handboken.

**Källa:** P §2.6 s.50; §2.2 s.17

### Fält 212 · Datum för första mätaravläsning
**Locator:** `SG8/DTM[2005=51]/C507/2380`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Första mätaravläsning; separat från 210/302  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avser det datum när avläsning startar.

**Källa:** P §2.6 s.49; §2.2 s.17

### Fält 249 · Födelsedatum
**Locator:** `SG8/DTM[2005=329]/C507/2380`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** 102 CCYYMMDD; frivilligt födelsedatum, inte Z13-kund-id  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Om avsändaren känner till elanvändarens födelsedatum och använder ett annat kund-id än födelsedatum/personnummer för Elanvändaren (fält 227), bör Födelsedatum anges. Födelsedatum underlättar identifieringen hos mottagaren. Avser elanvändarens födelsedatum.

**Källa:** P §2.6 s.51, 80; §2.2 s.17

### Fält 508 · Tidslängd (tidsperiod)
**Locator:** `SG8/DTM[2005=354]/C507/2380 + 2379`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Tidslängd och formatkod tillsammans; t.ex. 15:806,1:802,1:801 enligt aktuell profil  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Anger om nätägaren skickar kvartsvärden, timvärden, månadsvärden eller årsvärden. Z06: Obligatorisk i Z06F (transaktionstyp=E64), frivillig i Z06E och Z06G. Skickas i Z14, utom i Z14N.

**Källa:** P §2.6 s.51; §2.2 s.18

### Fält 326 · Tillståndets tidstämpel
**Locator:** `SG8/DTM[2005=693]/C507/2380`  
**Scope/parent:** permission / ingen särskild NAD-parent  
**Värdekontrakt:** 203; skapandetid för tillstånd  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Anger tidstämpel för skapande av tillståndet. Skickas i Z14, utom i Z14N. Kan anges i Z15 och Z18.

**Källa:** P §2.6 s.52; §2.2 s.18

### Fält 327 · Tjänsten/rapporteringen upphör
**Locator:** `SG8/DTM[2005=164]/C507/2380`  
**Scope/parent:** permission / ingen särskild NAD-parent  
**Värdekontrakt:** 203; upphörandetidpunkt, inte 273  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Anger tidpunkt när rapporteringen upphör (Z18) eller tjänsten upphör (Z15).

**Källa:** P §2.6 s.52; §2.2 s.18

### Fält 303 · Fritext (per anläggning)
**Locator:** `SG8/FTX[4451=ACB]/C108/4440`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Fritext på objektnivå; inte generell tillståndsmetadata  
**Källtabellens avlästa trådtyper:** an..70. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Fritext rekommenderas EJ, används endast i undantagsfall

**Källa:** P §2.6 s.53; §2.2 s.18

### Fält 213 · Uppskattad årsenergi
**Locator:** `SG12/QTY[6063=31]/C186/6060`  
**Scope/parent:** register / ingen särskild NAD-parent  
**Värdekontrakt:** Uppskattad årsenergi i hela kWh för EL  
**Källtabellens avlästa trådtyper:** an..3; n..15. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Uppskattad årsenergi, anges i kWh (el) eller i kubikmeter (gas) utan decimaler.

**Källa:** P §2.6 s.54; §2.2 s.18

### Fält 214 · Konstant för mätare
**Locator:** `SG14/CCI[C502/6313=Z02] → CAV/C889/7110[1]`  
**Scope/parent:** register / ingen särskild NAD-parent  
**Värdekontrakt:** Konstant för mätare; fjärde komponenten i C889  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Tal som uppgiven mätarställning skall multipliceras med för att få värdet i rätt måttenhet, vanligen kWh. Z04, Z10: Obligatorisk om mätarställningar skickas i MSCONS/UTILTS. Z06: Obligatorisk i Z06F (transaktionstyp=E64) då mätarställningar skickas i MSCONS/UTILTS. Frivillig i Z06E och Z06G.

**Källa:** P §2.6 s.55; §2.2 s.18

### Fält 215 · Konstant, gammal mätare
**Locator:** `SG14/CCI[C502/6313=Z03] → CAV/C889/7110[1]`  
**Scope/parent:** register / ingen särskild NAD-parent  
**Värdekontrakt:** Gammal konstant; fjärde komponenten  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Användningsklassen och parent-/segmentvillkoren gäller.

**Källa:** P §2.6 s.56; §2.2 s.18

### Fält 217 · Mätmetod
**Locator:** `SG14/CCI[C502/6313=Z04] → CAV/C889/7111`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Mätmetod; detaljerat meddelande-/datumstyrt urval av Z01,Z03,Z04  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Anger om anläggningen har eller kommer få kvartsvis/timvis/månadsvis/årsvis mätning. Z03: Anger antingen om elleverantören har avtal med elanvändaren om kvartsvis mätning (kod för kvart används), eller att elleverantören låter nätägaren avgöra mätmetoden. Z06: Obligatorisk i Z06F (transaktionstyp=E64). Frivillig i Z06E och Z06G. Anger om anläggningen har timvis mätning, eller kvartsvis mätning eller ej. Z09: Obligatorisk i Z09F (kvartsvis mätning) och Z09G (nätägaren avgör). Används ej i Z09B, Z09D eller Z09E. Z13: Anger antingen om energitjänsteföretaget har avtal med elanvändaren om kvartsvis mätning eller att nätägaren får avgöra mätmetoden. Z14: Skickas i Z14 utom i Z14N.

**Källa:** P §2.6 s.57; §2.2 s.18, 19

### Fält 218 · Antal siffror, mätare
**Locator:** `SG14/CCI[C502/6313=Z05] → CAV/C889/7110[1]`  
**Scope/parent:** register / ingen särskild NAD-parent  
**Värdekontrakt:** Antal heltalssiffror i mätaren; fjärde komponenten  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Antalet heltalssiffror på mätaren. Z04, Z10: Obligatorisk om mätarställningar skickas i MSCONS/UTILTS. Z06: Obligatorisk i Z06F (transaktionstyp=E64) då mätarställningar skickas i MSCONS/UTILTS. Frivillig i Z06E och Z06G.

**Källa:** P §2.6 s.58; §2.2 s.19

### Fält 219 · Antal siffror, gammal mätare
**Locator:** `SG14/CCI[C502/6313=Z06] → CAV/C889/7110[1]`  
**Scope/parent:** register / ingen särskild NAD-parent  
**Värdekontrakt:** Antal heltalssiffror gammal mätare; fjärde komponenten  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Användningsklassen och parent-/segmentvillkoren gäller.

**Källa:** P §2.6 s.59; §2.2 s.19

### Fält 306 · Installationsstatus
**Locator:** `SG14/CCI[C502/6313=Z07] → CAV/C889/7111`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Z11 ej inkopplad, Z12 aktiv; inte kundens avtalsstatus  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Anger om anläggningen är aktiv eller ej inkopplad. Z06: Obligatoriskt i Z06F (transaktionstyp=E64) och Z06G (transaktionstyp=E32). Frivillig i Z06E.

**Källa:** P §2.6 s.60; §2.2 s.19

### Fält 307 · Tariffkod
**Locator:** `SG14/CCI[C502/6313=Z08] → CAV/C889/7111`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Tariffkod endast enligt aktuell överenskommen användning  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** T ex nättariff vid samfakturering.

**Källa:** P §2.6 s.61; §2.2 s.19

### Fält 220 · Prioritet
**Locator:** `SG14/CCI[C502/6313=Z09] → CAV/C889/7111`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Prioritet; använd segmentets egen kodlista  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Anger om anläggningen är prioriterad eller avkopplingsbar.

**Källa:** P §2.6 s.62; §2.2 s.19

### Fält 222 · Rapporteringsfrekvens
**Locator:** `SG14/CCI[C502/6313=Z12] → CAV/C889/7110[1]`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** D,W,M,Q,Y enligt användning; inte mätmetod  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Hur ofta rapportering sker (dagligen, månatligen) enligt kod. Z13, Z14: avser tidsplan för överföring. Skickas i Z14 utom i Z14N.

**Källa:** P §2.6 s.63; §2.2 s.19

### Fält 223 · Transaktionstyp (undertyp)
**Locator:** `SG14/CCI[C502/6313=Z13] → CAV/C889/7111`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Kombination med funktion enligt meddelandefallen; E34, inte översiktens Z34  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Transaktionstyp (undertyp) enligt kod. (Giltiga koder, se SG14/CCI+Z13-CAV)

**Källa:** P §2.6 s.65; §2.2 s.19

### Fält 259 · Mätare, tidsintervall (räkneverkskod)
**Locator:** `SG14/CCI[C502/6313=Z16] → CAV/C889/7110[1]`  
**Scope/parent:** register / ingen särskild NAD-parent  
**Värdekontrakt:** Räkneverkskod; endast EL när mätarställningar rapporteras  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Kod som anger typ av tidstariff, enkeltariff eller typ av dubbeltariff. För mätare med flera register ska kod för respektive register anges. Använd Svenska kraftnäts kodlista för räkneverkskoder. Z04, Z10: Obligatorisk om mätarställningar skickas i MSCONS/UTILTS. Z06: Obligatorisk i Z06F (transaktionstyp=E64) då mätarställningar skickas i MSCONS/UTILTS. Frivillig i Z06E och Z06G. Får enbart skickas i elmarknaden då även mätarställningar skickas i UTILTS. Därmed vet mottagaren att endast om räkneverkskod anges i PRODAT så kommer mätarställningar skickas i UTILTS. För naturgasmarknaden gäller andra regler, se kapitel 2.4.5.

**Källa:** P §2.6 s.66; §2.2 s.19, 20

### Fält 254 · Avräkningsmetod (dygns/månads)
**Locator:** `SG14/CCI[C502/6313=Z15] → CAV/C889/7111`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Z31 månadsavräkning, Z32 dygnsavräkning  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Anger om dygnsavräkning (balansavräkning) eller månadsavräkning skall användas. Z10: Obligatorisk om avräkningsmetod har ändrats för ny mätare och/eller nya mätare är under gränsen för schablon. Z06: Obligatorisk i Z06F (transaktionstyp=E64) och Z06G (transaktionstyp=E32). Frivillig i Z06E.

**Källa:** P §2.6 s.67; §2.2 s.20

### Fält 242 · Produktkod
**Locator:** `SG14/CCI[C502/6313=Z14] → CAV/C889/7110[1]`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** L-tidsserieprodukt för aggregat, fjärde komponenten; inte generiskt energi-id  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** För anläggningar i elmarknaden anges här den tidsserieprodukt vilken används när anläggningens mätvärden aggregeras på elhandelsföretagsnivå, se vidare Handboken. Z10: Endast elmarknaden. Obligatorisk om produktkoden har ändrats i samband med mätarbyte. Z06: Endast elmarknaden. Obligatorisk i Z06F (transaktionstyp=E64) och Z06G (transaktionstyp=E32). Frivillig i Z06E. För naturgasmarknaden används en av följande två koder - 6109 (för dygnsavlästa anläggningar) - 6113 (för månads- eller årsavlästa anläggningar)

**Källa:** P §2.6 s.68; §2.2 s.20

### Fält 506 · Produkt id (Energiprodukt)
**Locator:** `SG14/CCI[C502/6313=Z14] → CAV/C889/7110[2]`  
**Scope/parent:** permission / ingen särskild NAD-parent  
**Värdekontrakt:** Generiskt energi-id, femte komponenten; CAV+::::värde  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avser ”Energiprodukt”. Anges i Z13 och Z14, utom i Z14N.

**Källa:** P §2.6 s.68; §2.2 s.20

### Fält 310 · Kundstatus
**Locator:** `SG14/CCI[C502/6313=Z17] → CAV/C889/7111`  
**Scope/parent:** customer / ingen särskild NAD-parent  
**Värdekontrakt:** Kundstatus endast enligt dödsfallsregeln; inte allmän konkursstatus  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Fältet används endast i anslutning till dödsfall. Z05: Obligatorisk då i Z05LK (transaktionstyp Z23) Z06: Obligatorisk i Z06E (transaktionstyp E34) Z09: Obligatorisk i Z09E (transaktionstyp E34)

**Källa:** P §2.6 s.71; §2.2 s.20, 21

### Fält 513 · Riktning (Typ av anläggning)
**Locator:** `SG14/CCI[C502/6313=Z22] → CAV/C889/7111`  
**Scope/parent:** permission / ingen särskild NAD-parent  
**Värdekontrakt:** E17 förbrukning, E18 produktion, E19 båda; separat framtida energidelning  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avser flödesriktning vid mätpunkten. Anges i Z13 och i Z14 (utom i Z14N).

**Källa:** P §2.6 s.72; §2.2 s.21

### Fält 322 · Tillståndets status
**Locator:** `SG14/CCI[C502/6313=Z23] → CAV/C889/7111`  
**Scope/parent:** permission / ingen särskild NAD-parent  
**Värdekontrakt:** Z14 V/VH A74; Z14N A13/A76; Z15 A74/A75 enligt händelsen  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avser tillståndets status. Anges i Z14 och Z15

**Källa:** P §2.6 s.73; §2.2 s.21

### Fält 323 · Tillståndets syfte
**Locator:** `SG14/CCI[C502/6313=Z24] → CAV/C889/7111`  
**Scope/parent:** permission / ingen särskild NAD-parent  
**Värdekontrakt:** B71–B76; privatkundsvillkor; exempel med A02 får inte bli kodlista  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avser tillståndets syfte. Ska anges för privatkunder i Z13 och Z14, utom i Z14N.

**Källa:** P §2.6 s.74; §2.2 s.21

### Fält 324 · Orsak till tillståndets upphörande
**Locator:** `SG14/CCI[C502/6313=Z25] → CAV/C889/7111`  
**Scope/parent:** permission / ingen särskild NAD-parent  
**Värdekontrakt:** B77,B78,B79,B80,E37 enligt orsaken  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avser varför tillståndet upphör. Anges i Z15 och Z18,

**Källa:** P §2.6 s.75; §2.2 s.21

### Fält 224 · Mätarnummer
**Locator:** `SG16/RFF[1153=MG]/C506/1154`  
**Scope/parent:** meter / ingen särskild NAD-parent  
**Värdekontrakt:** Mätarnummer; ingen påhittad UUID-ersättning  
**Källtabellens avlästa trådtyper:** an..3; an..35; an..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Mätarnummer.

**Källa:** P §2.6 s.76; §2.2 s.21

### Fält 225 · Gammalt mätarnummer
**Locator:** `SG16/RFF[1153=Z02]/C506/1154`  
**Scope/parent:** meter / ingen särskild NAD-parent  
**Värdekontrakt:** Gammalt mätarnummer, ska skilja sig från nytt i Z10  
**Källtabellens avlästa trådtyper:** an..3; an..35; an..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Används vid mätarbyte.

**Källa:** P §2.6 s.76; §2.2 s.21

### Fält 308 · Leverantörens avtalsnr
**Locator:** `SG16/RFF[1153=VC]/C506/1154`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Leverantörens kundavtalsnummer  
**Källtabellens avlästa trådtyper:** an..3; an..35; an..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avtalsnummer med elanvändaren.

**Källa:** P §2.6 s.76; §2.2 s.21

### Fält 260 · Nätområdesid
**Locator:** `SG16/RFF[1153=Z05]/C506/1154`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Nätområdes-id; 3 tecken; inte prisområde SE1–SE4  
**Källtabellens avlästa trådtyper:** an..3; an..35; an..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** 3-ställig nätområdeskod. Nätområdetsid skickas i Z14, utom i Z14N.

**Källa:** P §2.6 s.77; §2.2 s.21

### Fält 320 · Värmevärdesområde
**Locator:** `SG16/RFF[1153=Z08]/C506/1154`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Endast GAS; ej produktionsaktiverat i denna EL-specifikation  
**Källtabellens avlästa trådtyper:** an..3; an..35; an..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Värmevärdesområde. Används enbart i naturgasmarknaden och då med följande regler: Z04: Ska anges. Z06: Ska anges i Z06F och Z06G (ändras via Z06G). Anges ej i Z06E.

**Källa:** P §2.6 s.77; §2.2 s.21

### Fält 240 · Serie-id
**Locator:** `SG16/RFF[1153=Z06]/C506/1154`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Endast GAS; ej produktionsaktiverat i denna EL-specifikation  
**Källtabellens avlästa trådtyper:** an..3; an..35; an..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Fältet används endast i naturgasmarknaden och då med följande regler: Z04: Ska anges. Z06: Obligatoriskt om serie-id har ändrats pga ändringen. Obligatoriet gäller Z06F och Z06G. Frivillig i Z06E. Z10: Obligatoriskt om serie-id har ändrats pga mätarbytet.

**Källa:** P §2.6 s.77; §2.2 s.21

### Fält 319 · Referens till anläggning
**Locator:** `SG16/RFF[1153=Z07]/C506/1154`  
**Scope/parent:** object / ingen särskild NAD-parent  
**Värdekontrakt:** Förbrukningsanläggning kopplad till Z04D-produktionsanläggningen  
**Källtabellens avlästa trådtyper:** an..3; an..35; an..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Nätägarens identitet på förbrukningsanläggningen knuten till produktionsanläggningen angiven i fält 209. Z04: Obligatorisk i Z04D (transaktionstyp Z70)

**Källa:** P §2.6 s.78; §2.2 s.21

### Fält 261 · Referens till avtal/fullmakt
**Locator:** `SG16/RFF[1153=ANJ]/C506/1154`  
**Scope/parent:** object_or_request / ingen särskild NAD-parent  
**Värdekontrakt:** Referens till slutkundens avtal/fullmakt  
**Källtabellens avlästa trådtyper:** an..3; an..35; an..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Avser referens till avtal/fullmakt med elanvändaren (slutkunden).

**Källa:** P §2.6 s.78; §2.2 s.22

### Fält 226 · Ärendereferens
**Locator:** `SG16/RFF[1153=LI]/C506/1154`  
**Scope/parent:** object_or_request / ingen särskild NAD-parent  
**Värdekontrakt:** Ärendereferens; inte global tenantnyckel; korrelation enligt tabellen  
**Källtabellens avlästa trådtyper:** an..3; an..35; an..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Unik referens mellan ärenden, t ex Z03 - Z04.

**Källa:** P §2.6 s.78; §2.2 s.22

### Fält 325 · Tillståndets id
**Locator:** `SG16/RFF[1153=Z09]/C506/1154`  
**Scope/parent:** permission / ingen särskild NAD-parent  
**Värdekontrakt:** Tillstånds-id; känt för Z15/Z18, tilldelas genom Z14  
**Källtabellens avlästa trådtyper:** an..3; an..35; an..6. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Identifieringskod för tillståndet. Tillståndets id skickas ej i Z14N.

**Källa:** P §2.6 s.78; §2.2 s.22

### Fält 227 · Kund-id
**Locator:** `SG17/NAD[3035=UD]/C082/3039`  
**Scope/parent:** customer / UD  
**Värdekontrakt:** SE1 organisationsnummer/SE2 personnummer; ansvarig 260; födelsedatum som id ej Z13  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Användningsklassen och parent-/segmentvillkoren gäller.

**Källa:** P §2.6 s.79; §2.2 s.22

### Fält 228 · Namn-elanvändare
**Locator:** `SG17/NAD[3035=UD]/C080/3036[1..2]`  
**Scope/parent:** customer / UD  
**Värdekontrakt:** Namn i separata komponenter, 1–2 rader  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** 1-2 rader.

**Källa:** P §2.6 s.79; §2.2 s.22

### Fält 229 · Adress-elanvändare
**Locator:** `SG17/NAD[3035=UD]/C059/3042[1..3]`  
**Scope/parent:** customer / UD  
**Värdekontrakt:** Gatuadress 1–3 komponenter; ej Z13/Z14/Z15/Z18  
**Källtabellens avlästa trådtyper:** an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** 1-3 rader. När elanvändaren anges ska adressen fyllas i om den finns. Adressuppgifter anges ej i Z13, Z14, Z15 och Z18.

**Källa:** P §2.6 s.79; §2.2 s.22

### Fält 231 · Postnr-elanvändare
**Locator:** `SG17/NAD[3035=UD]/3251`  
**Scope/parent:** customer / UD  
**Värdekontrakt:** Postnummer, behåll inledande nollor  
**Källtabellens avlästa trådtyper:** an..9. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Användningsklassen och parent-/segmentvillkoren gäller.

**Källa:** P §2.6 s.79; §2.2 s.22

### Fält 232 · Postort-elanvändare
**Locator:** `SG17/NAD[3035=UD]/3164`  
**Scope/parent:** customer / UD  
**Värdekontrakt:** Postort; inte samma fält som anläggningsort  
**Källtabellens avlästa trådtyper:** an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Användningsklassen och parent-/segmentvillkoren gäller.

**Källa:** P §2.6 s.79; §2.2 s.22

### Fält 316 · Land-elanvändare
**Locator:** `SG17/NAD[3035=UD]/3207`  
**Scope/parent:** customer / UD  
**Värdekontrakt:** Landskod; krav är underordnat NAD+UD-gruppens tillämplighet  
**Källtabellens avlästa trådtyper:** an..3. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Användningsklassen och parent-/segmentvillkoren gäller.

**Källa:** P §2.6 s.79; §2.2 s.22

### Fält 233 · Anläggnings-id
**Locator:** `SG17/NAD[3035=IT]/C082/3039`  
**Scope/parent:** installation / IT  
**Värdekontrakt:** Samma faktiska identitet som 209 när IT anges  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** När anläggning skickas, anges alltid samma värde som 209.

**Källa:** P §2.6 s.81; §2.2 s.22

### Fält 234 · Adress-anläggning
**Locator:** `SG17/NAD[3035=IT]/C059/3042[1..3]`  
**Scope/parent:** installation / IT  
**Värdekontrakt:** Anläggningsadress i 1–3 komponenter  
**Källtabellens avlästa trådtyper:** an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** 1-3 rader. När anläggning skickas så anges alltid dess adress.

**Källa:** P §2.6 s.81; §2.2 s.22

### Fält 235 · Postnr-anläggning
**Locator:** `SG17/NAD[3035=IT]/3251`  
**Scope/parent:** installation / IT  
**Värdekontrakt:** Postnummer, skicka om möjligt enligt bilaga 3  
**Källtabellens avlästa trådtyper:** an..9. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Användningsklassen och parent-/segmentvillkoren gäller.

**Källa:** P §2.6 s.81; §2.2 s.22

### Fält 236 · Postort-anläggning
**Locator:** `SG17/NAD[3035=IT]/3164`  
**Scope/parent:** installation / IT  
**Värdekontrakt:** Ort, skicka om möjligt enligt bilaga 3  
**Källtabellens avlästa trådtyper:** an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Användningsklassen och parent-/segmentvillkoren gäller.

**Källa:** P §2.6 s.81; §2.2 s.22

### Fält 237 · Land-anläggning
**Locator:** `SG17/NAD[3035=IT]/3207`  
**Scope/parent:** installation / IT  
**Värdekontrakt:** Landskod när angiven enligt profil  
**Källtabellens avlästa trådtyper:** an..3. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Användningsklassen och parent-/segmentvillkoren gäller.

**Källa:** P §2.6 s.81; §2.2 s.23

### Fält 250 · Fakturamottagare ID
**Locator:** `SG17/NAD[3035=IV]/C082/3039`  
**Scope/parent:** invoicee / IV  
**Värdekontrakt:** Identifiering av fakturamottagare; endast när gruppen tillämplig  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** När fakturamottagare skickas så anges alltid dess id.

**Källa:** P §2.6 s.82; §2.2 s.23

### Fält 251 · Namn-fakturamottagare
**Locator:** `SG17/NAD[3035=IV]/C080/3036[1..2]`  
**Scope/parent:** invoicee / IV  
**Värdekontrakt:** Fakturamottagarens namn  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** 1-2 rader. När fakturamottagare skickas så anges alltid dess namn.

**Källa:** P §2.6 s.82; §2.2 s.23

### Fält 252 · Adress-fakturamottagare
**Locator:** `SG17/NAD[3035=IV]/C059/3042[1..3]`  
**Scope/parent:** invoicee / IV  
**Värdekontrakt:** Fakturamottagarens adress om tillämplig/finns  
**Källtabellens avlästa trådtyper:** an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** 1-3 rader. När fakturamottagare skickas så anges alltid, i förekommande fall, dess adress.

**Källa:** P §2.6 s.82; §2.2 s.23

### Fält 253 · Postnr-fakturamottgare
**Locator:** `SG17/NAD[3035=IV]/3251`  
**Scope/parent:** invoicee / IV  
**Värdekontrakt:** Fakturamottagarens postnummer  
**Källtabellens avlästa trådtyper:** an..9. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** När fakturamottagare skickas så anges alltid dess postnr.

**Källa:** P §2.6 s.82; §2.2 s.23

### Fält 317 · Postort-fakturamottagare
**Locator:** `SG17/NAD[3035=IV]/3164`  
**Scope/parent:** invoicee / IV  
**Värdekontrakt:** Fakturamottagarens postort  
**Källtabellens avlästa trådtyper:** an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** När fakturamottagare skickas så anges alltid dess postort.

**Källa:** P §2.6 s.82; §2.2 s.23

### Fält 318 · Land-fakturamottagare
**Locator:** `SG17/NAD[3035=IV]/3207`  
**Scope/parent:** invoicee / IV  
**Värdekontrakt:** Fakturamottagarens land  
**Källtabellens avlästa trådtyper:** an..3. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** När fakturamottagare skickas så anges alltid dess land.

**Källa:** P §2.6 s.82; §2.2 s.23

### Fält 262 · Balansansvarig
**Locator:** `SG17/NAD[3035=Z02]/C082/3039`  
**Scope/parent:** balance_responsible / ingen särskild NAD-parent  
**Värdekontrakt:** 160:SVK; BRP; i Z05 gammal BRP, inte automatiskt tenantens nuvarande  
**Källtabellens avlästa trådtyper:** an..3; an..35. Typen gäller rätt element; nationell begränsning och komponentposition kan vara snävare.

**Samlat källvillkor:** Giltigt Ediel-id för balansansvarig enligt Ediel- register i Edielportalen. Z05: uppgiften avser gammal balansansvarig.

**Källa:** P §2.6 s.83; §2.2 s.23

## B4. Samtliga D-celler
Uttrycken är logiska specifikationspredikat. De är inte eval-kod. Sant/falskt/okänt måste behandlas uttryckligt. Inaktiv parent gör barnkravet ej tillämpligt.
| ID/fält/funktion | Predikat | Sant | Falskt | Notering |
| --- | --- | --- | --- | --- |
| PC-209-Z14 | subtype != N | R | X |  |
| PC-258-Z04 | register_count > 1 | R | X |  |
| PC-258-Z06 | register_count > 1 | R | X |  |
| PC-258-Z10 | register_count > 1 | R | X |  |
| PC-210-Z06 | change_effective_at < supply_start_at | R | X |  |
| PC-210-Z09 | subtype == D AND production_contract_event == start | R | X |  |
| PC-210-Z10 | change_effective_at < supply_start_at | R | X |  |
| PC-211-Z09 | subtype == D AND production_contract_event == end | R | X | Z09D: 210 XOR 211. Båda ger APERAK 40/109 vid mottagning. |
| PC-302-Z14 | subtype != N | R | X |  |
| PC-321-Z13 | reporting_end_is_bounded | R | X | VH kräver slut; V tills vidare har inget slut. |
| PC-321-Z14 | subtype != N AND reporting_end_is_bounded | R | X |  |
| PC-216-Z09 | subtype != D | R | X |  |
| PC-508-Z06 | subtype == F | R | O |  |
| PC-508-Z14 | subtype != N | R | X |  |
| PC-326-Z14 | subtype != N | R | X |  |
| PC-214-Z04 | meter_stands_expected | R | X |  |
| PC-214-Z06 | subtype == F AND meter_stands_expected | R | O if subtype IN (E,G) else X |  |
| PC-214-Z10 | meter_stands_expected | R | X |  |
| PC-217-Z06 | subtype == F | R | O |  |
| PC-217-Z09 | subtype IN (F,G) | R | X | F => Z04; G => Z03, inte kod Z02. |
| PC-217-Z14 | subtype != N | R | X |  |
| PC-218-Z04 | meter_stands_expected | R | X |  |
| PC-218-Z06 | subtype == F AND meter_stands_expected | R | O if subtype IN (E,G) else X |  |
| PC-218-Z10 | meter_stands_expected | R | X |  |
| PC-306-Z06 | subtype IN (F,G) | R | O |  |
| PC-222-Z14 | subtype != N | R | X |  |
| PC-259-Z04 | meter_stands_expected | R | X |  |
| PC-259-Z06 | subtype == F AND meter_stands_expected | R | O if subtype IN (E,G) AND meter_stands_expected else X | Ytterligare EL-villkor: utan rapportering av mätarställningar får 259 inte skickas alls; då X, inte O. |
| PC-259-Z10 | meter_stands_expected | R | X |  |
| PC-254-Z06 | subtype IN (F,G) | R | O |  |
| PC-254-Z10 | settlement_method_changed OR new_meter_below_profile_threshold | R | O |  |
| PC-242-Z06 | subtype IN (F,G) | R | O |  |
| PC-242-Z10 | market == EL AND aggregation_product_changed | R | O |  |
| PC-506-Z14 | subtype != N | R | X |  |
| PC-310-Z05 | customer_event == death AND ((message == Z05 AND subtype == LK) OR (message IN (Z06,Z09) AND subtype == E)) | R | X | Inte generell status för konkurs. |
| PC-310-Z06 | customer_event == death AND ((message == Z05 AND subtype == LK) OR (message IN (Z06,Z09) AND subtype == E)) | R | X | Inte generell status för konkurs. |
| PC-310-Z09 | customer_event == death AND ((message == Z05 AND subtype == LK) OR (message IN (Z06,Z09) AND subtype == E)) | R | X | Inte generell status för konkurs. |
| PC-513-Z14 | subtype != N | R | X |  |
| PC-323-Z13 | customer_kind == private | R | X |  |
| PC-323-Z14 | subtype != N AND customer_kind == private | R | X |  |
| PC-260-Z14 | subtype != N | R | X |  |
| PC-320-Z04 | market == GAS AND (message == Z04 OR subtype IN (F,G)) | R | X |  |
| PC-320-Z06 | market == GAS AND (message == Z04 OR subtype IN (F,G)) | R | X |  |
| PC-240-Z04 | market == GAS AND (message == Z04 OR series_id_changed) | R | X | EL: alltid X. Nationella gasregler ska inte tillämpas som elregler. |
| PC-240-Z06 | market == GAS AND (message == Z04 OR series_id_changed) | R | O | EL: alltid X. Nationella gasregler ska inte tillämpas som elregler. |
| PC-240-Z10 | market == GAS AND (message == Z04 OR series_id_changed) | R | O | EL: alltid X. Nationella gasregler ska inte tillämpas som elregler. |
| PC-319-Z04 | subtype == D | R | X |  |
| PC-325-Z14 | subtype != N | R | X |  |
| PC-227-Z06 | subtype == E | R | X |  |
| PC-227-Z09 | subtype == E | R | X |  |
| PC-227-Z14 | subtype != N | R | X |  |
| PC-228-Z06 | subtype == E | R | X |  |
| PC-228-Z09 | subtype == E | R | X |  |
| PC-228-Z14 | subtype != N | R | X |  |
| PC-229-Z01 | parent_UD_active AND end_user_address_available | R | X | Barnkrav gäller endast när elanvändargruppen används. |
| PC-229-Z02 | parent_UD_active AND end_user_address_available | R | X | Barnkrav gäller endast när elanvändargruppen används. |
| PC-229-Z03 | parent_UD_active AND end_user_address_available | R | X | Barnkrav gäller endast när elanvändargruppen används. |
| PC-229-Z04 | parent_UD_active AND end_user_address_available | R | X | Barnkrav gäller endast när elanvändargruppen används. |
| PC-229-Z05 | parent_UD_active AND end_user_address_available | R | X | Barnkrav gäller endast när elanvändargruppen används. |
| PC-229-Z06 | parent_UD_active AND end_user_address_available | R | X | Barnkrav gäller endast när elanvändargruppen används. |
| PC-229-Z08 | parent_UD_active AND end_user_address_available | R | X | Barnkrav gäller endast när elanvändargruppen används. |
| PC-229-Z09 | parent_UD_active AND end_user_address_available | R | X | Barnkrav gäller endast när elanvändargruppen används. |
| PC-231-Z06 | subtype == E | R | X |  |
| PC-231-Z09 | subtype == E | R | X |  |
| PC-232-Z06 | subtype == E | R | X |  |
| PC-232-Z09 | subtype == E | R | X |  |
| PC-316-Z06 | subtype == E | R | X |  |
| PC-316-Z09 | subtype == E | R | X |  |
| PC-233-Z01 | parent_IT_selected_or_required | R | X |  |
| PC-233-Z03 | parent_IT_selected_or_required | R | X |  |
| PC-233-Z08 | parent_IT_selected_or_required | R | X |  |
| PC-234-Z01 | parent_IT_selected_or_required | R | X |  |
| PC-234-Z03 | parent_IT_selected_or_required | R | X |  |
| PC-234-Z08 | parent_IT_selected_or_required | R | X |  |
| PC-250-Z03 | parent_IV_active | R | X |  |
| PC-250-Z04 | parent_IV_active | R | X |  |
| PC-250-Z05 | parent_IV_active | R | X |  |
| PC-250-Z06 | parent_IV_active | R | X |  |
| PC-250-Z08 | parent_IV_active | R | X |  |
| PC-250-Z09 | parent_IV_active | R | X |  |
| PC-251-Z03 | parent_IV_active | R | X |  |
| PC-251-Z04 | parent_IV_active | R | X |  |
| PC-251-Z05 | parent_IV_active | R | X |  |
| PC-251-Z06 | parent_IV_active | R | X |  |
| PC-251-Z08 | parent_IV_active | R | X |  |
| PC-251-Z09 | parent_IV_active | R | X |  |
| PC-252-Z03 | parent_IV_active AND invoicee_address_applicable | R | X |  |
| PC-252-Z04 | parent_IV_active AND invoicee_address_applicable | R | X |  |
| PC-252-Z05 | parent_IV_active AND invoicee_address_applicable | R | X |  |
| PC-252-Z06 | parent_IV_active AND invoicee_address_applicable | R | X |  |
| PC-252-Z08 | parent_IV_active AND invoicee_address_applicable | R | X |  |
| PC-252-Z09 | parent_IV_active AND invoicee_address_applicable | R | X |  |
| PC-253-Z03 | parent_IV_active | R | X |  |
| PC-253-Z04 | parent_IV_active | R | X |  |
| PC-253-Z05 | parent_IV_active | R | X |  |
| PC-253-Z06 | parent_IV_active | R | X |  |
| PC-253-Z08 | parent_IV_active | R | X |  |
| PC-253-Z09 | parent_IV_active | R | X |  |
| PC-317-Z03 | parent_IV_active | R | X |  |
| PC-317-Z04 | parent_IV_active | R | X |  |
| PC-317-Z05 | parent_IV_active | R | X |  |
| PC-317-Z06 | parent_IV_active | R | X |  |
| PC-317-Z08 | parent_IV_active | R | X |  |
| PC-317-Z09 | parent_IV_active | R | X |  |
| PC-318-Z03 | parent_IV_active | R | X |  |
| PC-318-Z04 | parent_IV_active | R | X |  |
| PC-318-Z05 | parent_IV_active | R | X |  |
| PC-318-Z06 | parent_IV_active | R | X |  |
| PC-318-Z08 | parent_IV_active | R | X |  |
| PC-318-Z09 | parent_IV_active | R | X |  |

## B5. Registeroverlay
Första registret följer den tillämpliga basprofilen. Register2+ följer Pbilaga 2:s egen tabell. Global sekvens314 ökar för varjeLIN;258 börjar om för varje objekt.209och258 är kärnuppgifter. Registerspecifika årsenergi-/konstant-/siffer-/räkneverksuppgifter följer bilaga 2 och när de finns i första registret. Övriga tillämpliga uppgifter hämtas från första registret; extra upprepning ska hanteras enligt guiden, inte ges en ny grunddataauktoritet.

Det får inte räcka att kontrollera första träffen av ett fält i råfilen. Feldiagnosen ska kunna peka på objekt, register, segmentindex och fältnummer. Reglerna får inte kopieras över till andra meddelandefamiljers repetitionsmodeller.

## B6. Kopplade originalsegmenttabeller
`source_tables.json` innehåller positionsbevarade rader från P§2.6 och övriga angivna sidor. Varje fält i `prodat_fields.json` har kopplade segmenttabellrader med datatyp/längd och råklassificering. Tabellen måste läsas med rätt schemaelement; flera datatyper i en rad är inte ett nytt sammanfogat fälttypkrav. Fält311 hämtas frånT/UNB ochP-användningsmatrisen.
