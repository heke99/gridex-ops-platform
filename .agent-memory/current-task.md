# Current task — fortsätt de kvarvarande kedjorna

Läs [current-state](current-state.md), [baslinjen](masterplan-five-agent-baseline-20261012.md), ditt ordagranna frysta krav och senaste [#766](https://github.com/heke99/gridex-ops-platform/issues/766). Återanvänd en aktuell reserverad kedja; skapa ingen andra skrivare eller producent.

- R1: granska/integrera den korrigerade DB05-forwarden #788 genom C2:s GEN-kö; kvalificera sedan samma #779-native, inklusive relevanta låsväntande kontraster. Legal retentiongrund behövs för helgodkännande, inte för oberoende mekanismrättning.
- R2: rätta #785:s provideridentitet och avgränsa tilliten till Authentication-Results; bevara ägarens STRATO-riskbeslut. OPS04 behöver fortfarande verkligt motpartsprov och befintligt LIVE-mandat.
- C1: kvalificera rättad generated-column-forward #787 och C2:s integrerade output, följt av samma Z02-native i #780. #777:s diagnosfix är redan levererad.
- C2: #775/#783 är levererade. Kvalificera #789:s verkliga slutversion; rätta #784:s första tenant-resultat och bind den fysiska UTILTS_ERR-kontrasten efter integration. Sköt sedan granskade #787/#788/ESCO-inputs i en seriell GEN-kö.
- C3: kvalificera aktuell H101-kedja #776. DB05/SC070 konsumerar R1:s samma kedja; starta ingen egen DB05-producent. Externa helhetskriterier kvarstår.

Extra helpers får läsa direkt. Rättning kräver exakta aktuella filrefs/handoff; delad migrationsmanifest är alltid C2:s. Hjälp med kod/test/fixture/GEN gör agenten till medförfattare som ersätts i slutgranskningen. Två oberoende slutpeers, aktuella mandatorygates och ärligt kvalificerat bevis krävs före leverans.
