# Gridex Ediel — master-masterplan v2.0

Datum: 2026-09-10. Omfattning: svensk elmarknad, multitenant, elhandel/DDQ och energitjänster/DGI, inklusive provider som juridisk ESCO åt andra tenants.

## Börja här

Öppna **MASTERMASTERPLAN_v2.html** i en webbläsare. Den innehåller huvudspecifikationen och alla fem textbilagor i en fristående fil, utan externa typsnitt eller skript.

**MASTERMASTERPLAN_v2.md** är huvudspecifikationen i redigerbart Markdown-format. **Gridex_Ediel_Regel_och_acceptansregister_v2_2026-09-10.xlsx** är arbetsregistret med 19 blad, filter och uttryckliga kör-/bevisstatusar. Textbilagorna finns även separat under `annex/`.

## Detta ingår

121 regelkort; 38 PRODAT-fall; 74 numeriska PRODAT-fält och tre föräldragrupper; 110 villkor för D-celler; 22 UTILTS-kapabiliteter; 152 kontextberoende UTILTS-applikationsrader; 115 nationella kod-/kontrollrader; 20 kontroll-/felregler; 31 tidsregler; 42 tillståndsövergångar; 16 anropskontrakt; 17 datamodellkoncept; 231 planerade acceptanskontrakt; sju öppna käll-/bevisgrindar. De 62 tidigare granskningspunkterna och 26 särskilda mappningsfynden bevaras.

Antal rader är inte ett mått på verifierad överensstämmelse med hela Ediel. Alla 231 systemprov är markerade **Inte körd mot systemet**. Inga repositoryändringar, migrationer, produktionsimporter eller verkliga sändningar har gjorts genom denna leverans.

## Status och återstående bevis

Detta är en konkret utökad byggspecifikation, inte ett färdigt produktionsregelpaket eller certifieringsintyg. Regelkort och fältvillkor är ifyllda för den källbelagda omfattningen. Fullständig äldre UTILTS25-A-3, vissa aggregat-/testunderlag, konkreta uppdragsavtal samt drift- och implementationsbevis behöver fortfarande kompletteras där de påverkar en kapabilitet. Se G01–G07 i huvudtexten och registret.

Egen marknadsaktör per tenant, provider som juridisk ESCO och verkligt tekniskt ombud är skilda modeller. Gemensam brevlåda skapar inget ombudsmandat. Tillgång över tenantgränser kräver både tillåten marknadsrelation, serviceuppdrag och uttryckligt internt åtkomstgrant; planen är inte i sig en rättslig grund för datautlämning.

## Maskinläsbara underlag

`registers/*.json` innehåller specifikationsdata med stabila id:n och källreferenser. Dessa ska inte laddas in som aktiva produktionsregler utan implementation och verifiering. `annex/source_tables.json` är en avläsning av originaltabeller där sammanfogade celler kan representeras med null; den är inte en färdig validator.

`contracts/ediel-execution.ts` beskriver föreslagna interna TypeScript-kontrakt. Den innehåller ingen faktisk affärsmotor eller sändningsimplementation. Typernas namn måste förenas med befintligt schema och verkliga serverkontroller.

## Kontrollera paketets interna integritet

Kör från paketets rot:

```bash
python verification/verify_spec.py
```

Skriptet använder endast standardbiblioteket och gör inga nätanrop eller skrivningar utanför paketets verifieringsresultat. Det kontrollerar unika id:n, regel-/testreferenser, fältmatrisens D-täckning och vissa rollgränser. **Det testar inte Gridex, SMTP, full EDIFACT-syntax eller faktisk Edielöverensstämmelse.** Resultatet finns i `verification/spec_integrity_result.json`.

## Källor

Käll-id P, T, U, UE, AI, OE och AP avser de namngivna originalfilerna i `registers/source_manifest.json`. PDF-originalen ingår inte som nya kopior i detta paket. Handboken har lästs på sin officiella webbplats; någon lokal bytehash för den hävdas inte. REG avser uppladdad registerexport och CODE den historiska kodgranskningsbasen eb9a25b.

För vissa delar finns uttryckliga dokumentkonflikter. Tillämpa anvisningens egen företrädesregel där sådan finns. Gissa inte en regel från ett filnamn, en grön intern flagga eller en positiv kvittens från ett annat testfall.
