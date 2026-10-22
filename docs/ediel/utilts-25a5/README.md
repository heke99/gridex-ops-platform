# Svensk UTILTS 25-A-5 — käll- och beteendetillägg 2026-10-20

Den aktuella svenska anvisningen är revision 5 från 2026-10-01. Omslaget anger
UTILTS D02B/E5SE5A och den tillhörande APERAK-profilen behåller D04A/E5SE5A.
Enbart E5SE5A identifierar alltså inte guideutgåvan. Originalets SHA256 är
`b76a61b9aa6f136771e5db4948296d1b632b8d775314eb6c93783595ae419db2`.

[Källmanifestet](source-manifest.json) binder det svenska originalet,
135-sidorsläsningen och den avgränsade jämförelsen av 38 tabeller/471 rader.
[Kravtillägget](requirements.json) anger implementation, prov och bevisgräns.
Engelska UTILTS används inte som normkälla för detta tillägg. Full historisk
U4/U5-prosajämförelse påstås inte: det exakta frysta U4-originalet saknas.

Datumstyrningen använder nu U5 för nya beslut från 2026-10-01. U4 behåller
sin registrerade identitet och sitt tidigare startdatum, med uttrycklig
supersession från samma dag. Ett slutdatum före dess start hittas inte på.
Den faktiskt föregående giltiga guiden U3 behåller mottagargrace 1–14 oktober.
Skyddade, redan registrerade U4-original behåller U4 i senare APERAK/ERR;
denna rätt gör inte U4 valbar för en ny sändning.

Profil, processbarhet, nationella ERR-orsaker och LOC172/175-kontroller
följer samma kvalificerade utgåva. E19/Z03 återinförs inte. S06 får fortsatt
inte användas för ny utgående trafik och S08 återaktiveras inte. Reella
nollvärden och tillåtna delperioder bevaras. §3.6.13 beskriver nätägarens
rapportering; rekommendationer blir inte nya universella mottagaravslag.

De nya vanliga testerna kör faktisk parser/policy/runtime och deklarerade
mockade register-/sändportar. De omfattar bland annat ett helt dygn med 96
nollkvartar, delmånad, eget felaktigt objekt bredvid giltigt syskon,
reglerobjektsid, bevarad U4-ERR och spärr mot ometiketterade U4-pack.
Detta är inte ett verkligt DSO-Z06F→struktur→databas→outbox-marknadsprov.
DGI eller en källtext om energidelning ger ingen operativ aktivering.

En ny U5-aktivering kräver en verklig ny namngiven registerutgåva. Dess
låsta `originalSnapshot.guideSources` ska innehålla `source_type=technical_guide`,
`revision=25-A-5`, exakt primärhash ovan och en icke-tom källlocator.
Aktiveringspackets identitetsdigest förblir ett separat värde. U4-bevis,
enbart versionsetikett eller ett exempel uppfyller inte detta kontrakt.

Kvarvarande leverans till befintlig kvalificerad producent:

1. Skapa en ny framåtriktad U5-registerprojektion och riktiga källwitnesses.
   Bevara U3/U4-pack, skyddade original, deras nycklar och kvitton. Lös det
   överlappande startdatumet i aktuell selektion utan att skriva om historik.
2. Kvalificera det svenska originalet i en separat aktuell manifestingång.
   Det frysta `masterplan-v2/registers/source_manifest.json` ändras inte.
3. Leverera nya editioner av berörda ACK-/response-/readiness-/technical-
   projektioner från slutliga källfilhashar. `guideRegistry.ts`,
   `canonicalEdielPolicy.ts`, `utiltsRulebook.ts`, `utilts25A4.ts`,
   `utilts25A5.ts` och `ackGuidePolicy.ts` påverkar källgrafen. Befintliga
   generatorer som bara läser det frysta U4-manifestet behöver en uttrycklig
   ny U5-källingång; deras gamla `originalSources` får inte bara ometiketteras.
4. Verifiera faktiskt låst U5-registerval och native-konsumenter, positiva och
   negativa egna fall samt sena svar med kvarvarande U3/U4-original. Ett gammalt
   grönt generator-/nativekvitto gäller inte automatiskt ändrad källgraf.
5. Låt saknat eller gammalt register-/projektionsbevis förbli blockerande tills
   leveransen är kvalificerad. Detta paket kör inte GEN, native, DB eller utskick.

Den frysta 352-baslinjen och dess godkännanden ändras inte. Dokumenträttningarna
finns i [det aktuella U5-tillägget](../masterplan-v2/amendment-current-swedish-utilts-25-a-5-2026-10-20.md)
och [de precisa källrättningarna](../masterplan-v2/amendment-source-corrections-2026-10-20.md).
Verkliga organisations-, kund-, avtals- och marknadsgodkännanden prövas inte
genom detta källpaket.
