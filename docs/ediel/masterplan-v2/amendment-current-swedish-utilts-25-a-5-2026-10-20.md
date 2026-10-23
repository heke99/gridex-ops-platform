# Aktuell svensk UTILTS 25-A-5 — tillägg 2026-10-20, version1

Detta tillägg preciserar dagens källstyrning efter den frysta v2-baslinjen.
Frysta huvudplanen, bilagorna A–E, registren, paketmanifestet och coverage 352
behålls oförändrade. Befintliga VERIFIED/PASSED-statusar är historik mot
den baslinjen, inte ett nytt godkännande av senare källor.

Svenska kraftnäts [svenska original 25-A-5](https://www.ediel.se/Portal/Document/3364)
har 135 sidor och SHA256
`b76a61b9aa6f136771e5db4948296d1b632b8d775314eb6c93783595ae419db2`.
Omslagets revision 5, publicering 2026-10-01 och giltighet 2026-10-01 gäller.
En äldre uppgift om en felaktig U5-footer i ett annat U4-original beskriver
inte detta original. Engelska UTILTS är inte normkälla för tillägget.
[Källmanifest](../utilts-25a5/source-manifest.json) och
[krav-/verifieringsmatris](../utilts-25a5/requirements.json) hör till version1.

GOV-01/04/05/06 och U-reglernas versionsingång preciseras så här:

- Välj aktuell svensk U5 för nya beslut från 2026-10-01; UTILTS och dess
  APERAK har fortsatt E5SE5A. Håll PRODAT-origin APERAK separat.
- U4 behåller sin namngivna identitet och befintliga ursprungsvittnen.
  Supersession av dagens selektion är skild från historisk giltighet.
  U3 är den föregående faktiskt giltiga mottagarutgåvan under 1–14 oktober.
- Ett svar som äger ett skyddat U3/U4-original ärver hela originalets policy.
  Att gå tillbaka till dess datum och slå upp dagens korrigerade guide skulle
  kunna byta samma-dag-U4 till U5 och är därför otillräckligt.
- Profil, processbarhet och ERR-lista ska använda samma kvalificerade guide.
  Ny U5-registerevidens måste bära det svenska originalets riktiga hash som
  teknisk källa. Packdigest, wireidentifierare eller gammal U4-rad räcker inte.

U5 §1.8 p6 bekräftar U4-ändringarnas processbarhet: ingen E19 eller Z03,
inga S08-fält 535–538, ingen jämförelse mellan mätarställningar och energi,
inga motsvarande individuella energivärdeskontroller utöver E30. Källstyrd
strukturjämförelse och aktuella användningsbegränsningar behålls. Samtliga 38
retinerade tabeller/471 rader har jämförts direkt med svenska U5, utan
cellskillnader efter blankstegs-/None-normalisering. Detta belägger delat
tabellunderlag; det är inte fullständig U4/U5-prosaekvivalens.

U5 §3.6.13 pp41–43 kräver att all energi rapporteras, även kända nollor.
Byte E66-S/T hålls i separata meddelanden; en månad kan ha delperioder.
Vid högupplösta värden på båda sidor om enbart avräkningsmetodsbyte skickas
ingen PRODAT-referens. En daglig från-/tillkopplingsrapport omfattar ett
dygn. Frånkopplingsdygnets ställning registreras 00.00 nästa dygn och
tillkopplingsdygnets 00.00 samma dygn. De uttryckliga rekommendationerna om
transaktionsdelning behåller sin rekommendationsgrad. Gridex som mottagare
behöver inte därmed bli producent av nätägarens frånkopplingshändelser.

Mottagarens prov täcker känd nollobservation, det mellanliggande dygnet18–19
april med 96 nollkvartar och en tillåten delmånad. De prövar verklig parser
och runtime. Full verklig Z06F-/struktur-/lagrings-/outbox-kedja påstås inte.
Övriga uppgifter om avisering, fortsättningsvillkor, NULL och källtryckfel
preciseras i [källrättningstillägget](amendment-source-corrections-2026-10-20.md).

Revisionsnotens DGI-roll för energidelning är en mottagarprofil, inget nytt
rättsligt tillstånd eller aktiveringsbeslut. Befintlig framtidsgrind förblir
spärrad. PRODAT27-A:s april2027-wire och juli2027-processer är en separat
framtida kvalificering och aktiveras inte av detta tillägg.

Det nya källvalet berör genererade/native-projektioner. De måste levereras
som nya kvalificerade editioner av befintlig producent, enligt
[exakt handoff](../utilts-25a5/README.md). Käll- och vanliga mockprov i detta
paket ersätter inte sådan leverans eller organisations-/kundgodkännanden.


## Avgränsad mottagarrättning 2026-10-23

R/D/O/X-tabeller måste kopplas till det mottagna fältets egen fysiska
transaktion och observation. Att läsa en rå tabellrad som en redan körbar
validator får inte innebära att ett obligatoriskt eller förbjudet fält hoppas
över. Den genomförda projektionen är avgränsad till uttryckligen stödda
transaktionsläsare. Den redovisar fortsatt `complete: false`; kvarvarande
beroende villkor, observationsgrenar och andra semantiska ägare måste
kvalificeras separat. Detta tillägg intygar inte att alla fält är implementerade.

U3:s svenska original har SHA-256
`a4ae498e5231df22e043ec24b93f97563095bb9880ee296683acf7a0f6973fff`.
Dess gemensamma fysiska R/X-krav får inte försvinna när ett helt meddelande
prövas mot U3 under den registrerade övergångsperioden. Bland annat är S01
fält209 förbjudet och fält511 obligatoriskt i båda originalen. De avgränsade
läsarna använder U3:s eget källvittne vid U3-prövning; U5:s produkt- och
villkorsregler överförs inte till U3. Avsiktliga utgåveskillnader och den
ordinarie datumgränsen för mottagning behålls.

S01 är inte generellt ett individuellt punktmeddelande. Det tekniska stöd
som införs här omfattar endast den exakt kvalificerade L359-profilen i
aktuella Tidsserieprodukter, rad21: fullständig ordnad PC/PT/OT/LOD/BAP,
områdesidentitet LOC239, månadsperiod, fast +0100 och profilens övriga
uttryckliga fysiska begränsningar. L359 avser andelstal och får inte bära
observationsstatus enligt U5 fält520. Okänd produkt eller en profil utanför
lagringsägarens representerbara område hålls lokalt för granskning; det
skapar ingen nationell felkod. Reglerobjekt får inte låna denna områdesväg.

Mottagningens kvalificering, kontraktsberedning och databas ska godta samma
avgränsade profil. Det faktiska kontraktets guidevärde är `25-A-5`.
Områdesvägen innebär ingen individuell mätvärdes- eller faktureringsrätt;
organisation, avsändare, mottagare, miljö, källa och behörig anropare måste
fortsatt verifieras av sina ordinarie skyddade ägare. Befintliga punktkontrakt
behåller sina oföränderliga original och får inte nytolkas som nya godkännanden.

Negativ APERAK ska återge värdet från det felaktiga fältets egen fysiska
förekomst. En källsökväg som RFF+MG|SE anger alternativa kvalificerare;
den är inte en bokstavlig kvalificerare. Ett saknat eller tvetydigt värde
får inte ersättas med påhittad feltext. Positiva E30-testmeddelanden måste
också följa E30:s egna fältkrav och får inte ärva förbjudna E66-fält.

Lokala prov och källgranskning ersätter inte ordinarie migrationsåterspelning,
native-prov, genererad schemaparitet eller verifierad installation i produktion.
Inte heller utgör den tekniska L359-profilen ett marknads- eller eSett-godkännande.
