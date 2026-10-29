# Gemensam startprompt för Codex och Claude

Använd samma instruktioner oavsett modell. Ersätt arbetar-ID och spår med en unik session. Fyra spår betyder inte krav på fyra tunga Next-/Dockerstarter på en maskin utan kapacitetskontroll.

> Läs AGENTS.md, den här kampanjens README, REPORTING.sv.md, campaign.json, scenarios.safe.json och senaste #840. Verifiera din egen repositoryåtkomst och exakt bascommit. Starta i en egen ren worktree/gren. Välj ett ledigt scenario inom ditt föreslagna spår, kontrollera befintliga ID-, fil- och producentclaims och reservera korrekt enligt repositoryprotokollet. En issuekommentar ensam ger inte filcustody. Respektera befintliga EVENT01-ägaren och andra aktuella ägare; historiska slotnamn ger ingen ny tilldelning.
>
> Använd egen isolerad DB/Auth/Storage/kö/mailmotpart och syntetiska kunder. Kör normala ingångar och verifiera verkligt utfall genom API, databas och fysiska filer. Bind bevis till kod-/migrationsversion och redovisa ersättningar. Skriv alla fel och prestandaobservationer i din FINDINGS.md och uppdatera status.json samt säkra kvittoreferenser efter varje atomiskt steg. Dela inga credentials eller råa privata loggar i GitHub.
>
> Skriv endast i egna tilldelade filer. Du pushar din arbetsgren efter relevanta kontroller; integratören uppdaterar den gemensamma PR-grenen seriellt. Begär befintlig ägares adoption eller exakt handoff för ändringar i delad kod. Applicera inga globala migreringar och starta inte en andra gemensam GEN/native-producent. Nya lokala testfixturer dokumenteras som ersättningar.
>
> Samla och styrk fynd först. Rättningsarbete binds till findings-ID och exakt scope; behåll ursprungligt felkvitto. Efter omtest lämnar du paketets ändringar, verkliga resultat, begränsningar och nästa steg. Välj sedan nästa lediga scenario inom samma spår. Vid blockerare dokumenterar du vad som saknas och fortsätter oberoende tillåtet arbete. Inga påhittade PASS, inga blinda återspelningar och ingen störning av andra körningar.

## Spårval

- Finance: MAIN03–06, BILLNEG01, QA01–02. QA är gemensamma slutgrindar. Bekräfta befintlig billingägare före appkodändring.
- Kund/avtal: SITE01, TERM01–03, DELIVERY01. Samordna prislogik med Finance och följ faktisk native kontrakts-/signeringsväg.
- Ediel/custody: EDIEL01–03, CUSTODY01, EVENT01. EVENT01.01–05 behåller befintlig CODEX-EVENTS-ägare; börja med lediga uppgifter och adoption av tillämpliga sparade resultat.
- Access/API/UI: AUTH01, API01, UI01. Samordna gemensam kunddomän med kundspåret; håll genuin Auth och syntetiska identiteter åtskilda från simulerad affärstid.

## Första meddelande i #840

Ange campaign-id, worker/session-id, modell, föreslaget ID-set, bas/arbetsgren, miljönamn, exakta avsedda filer och verifierade claim/handoffrefs. Markera PENDING om claims eller miljö inte är klara. Ange befintlig ägare vid överlapp. Publicera bara säkra metadata, aldrig credentials. Vid en oklar tidigare mutation: stäm av utfallet innan något nytt försök.
